import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import orderService from '../../services/orderService';
import { mcpJson, mcpError } from '../utils';

// All statuses of the OrderStatus enum (same list as utils/validators.ts updateOrderStatusValidation).
// The caller is an `integration` actor (D1): the state machine allows its normal moves and the
// F-302 jumps, and refuses anything else with an error message the tool returns.
const ordersUpdateStatusSchema = z.object({
  orderId: z.number().int().positive(),
  status: z.enum(Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]]),
  notes: z.string().max(500).optional(),
  // The real delivery date, for 3PL reconciliation where delivery happened days
  // ago. Only meaningful with status "delivered". Omitted => now.
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'deliveryDate must be YYYY-MM-DD').optional(),
});

/**
 * Handler for the `orders_update_status` tool. Exported for direct testing.
 * MUST run inside a tenant context (set by the MCP server's wrapHandler), so
 * that the tenant-isolation Prisma extension scopes every query.
 */
export async function updateOrderStatusTool(args: z.infer<typeof ordersUpdateStatusSchema>) {
  try {
    const parsed = ordersUpdateStatusSchema.parse(args);

    // Calendar validity check, on top of the schema's digit-shape regex.
    // JS silently rolls impossible calendar days into the next month (e.g.
    // 2026-02-30 -> 2026-03-02, 2026-02-29 -> 2026-03-01 since 2026 isn't a
    // leap year), which would post GL revenue into the wrong accounting
    // period. Round-tripping through toISOString catches both an outright
    // Invalid Date and this silent rollover in one check.
    let deliveryDate: Date | undefined;
    if (parsed.deliveryDate) {
      const candidate = new Date(`${parsed.deliveryDate}T00:00:00.000Z`);
      if (candidate.toISOString().slice(0, 10) !== parsed.deliveryDate) {
        return mcpError(`deliveryDate "${parsed.deliveryDate}" is not a valid calendar date`);
      }
      deliveryDate = candidate;
    }

    // Tenant-scoped lookup. findFirst passes through the tenant-isolation
    // Prisma extension, so an orderId belonging to another tenant simply
    // returns null — this tool can never mutate another store's order.
    const existing = await prisma.order.findFirst({
      where: { id: parsed.orderId, deletedAt: null },
      include: {
        customer: { select: { firstName: true, lastName: true, phoneNumber: true } },
      },
    });

    if (!existing) {
      return mcpError(`Order ${parsed.orderId} not found`);
    }

    const customerName = existing.customer
      ? `${existing.customer.firstName} ${existing.customer.lastName}`
      : null;
    const customerPhone = existing.customer?.phoneNumber ?? null;

    // Idempotency guard: never re-run the status side effects (inventory
    // movement, GL reversal, payment collection) when the order is already
    // in the requested status. Safe to call the tool repeatedly.
    if (existing.status === parsed.status) {
      return mcpJson({
        updated: false,
        orderId: parsed.orderId,
        status: existing.status,
        customer: customerName,
        customerPhone,
        message: `Order already in status "${parsed.status}"; no change made.`,
      });
    }

    const previousStatus = existing.status;

    // Delegate to the shared service (state machine) so inventory, delivery date,
    // paymentStatus, GL journal reversal, and the OrderHistory audit row are
    // all handled consistently with the normal app flow. The MCP key is
    // tenant-scoped, not user-scoped: the actor is `integration` (D1). An
    // INVALID_TRANSITION / STALE_ORDER error reaches the caller as the tool error.
    await orderService.updateOrderStatus(parsed.orderId, {
      status: parsed.status,
      notes: parsed.notes ?? 'Status updated via MCP',
      deliveryDate,
      actor: { kind: 'integration' },
    });

    return mcpJson({
      updated: true,
      orderId: parsed.orderId,
      previousStatus,
      newStatus: parsed.status,
      customer: customerName,
      customerPhone,
    });
  } catch (err) {
    return mcpError((err as Error).message);
  }
}

export function registerOrderWriteTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'orders_update_status',
    'Update an order\'s fulfillment status. Writes an order-history audit row and, via the shared order service, adjusts inventory and (on delivered/returned) payment status and accounting entries. Idempotent: makes no change if the order is already in the requested status. Valid statuses: pending_confirmation, payment_pending, payment_failed, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, digital_delivered, failed_delivery, returned, cancelled. The order state machine applies: an invalid move returns an error with the moves that are allowed. Optionally accepts deliveryDate (YYYY-MM-DD) to record when a delivery actually happened — use it when reconciling past deliveries from a 3PL, otherwise the delivery date defaults to now.',
    ordersUpdateStatusSchema.shape,
    wrapHandler(updateOrderStatusTool),
  );
}
