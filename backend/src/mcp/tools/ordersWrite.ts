import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import orderService from '../../services/orderService';
import { mcpJson, mcpError } from '../utils';

// Mirror of the app's own dashboard whitelist (see utils/validators.ts
// updateOrderStatusValidation): the MCP tool grants exactly the status
// transitions a human admin can make from the UI — no more, no less.
const ordersUpdateStatusSchema = z.object({
  orderId: z.number().int().positive(),
  status: z.enum([
    'pending_confirmation',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'returned',
    'failed_delivery',
  ]),
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

    // Delegate to the shared service so inventory, delivery date,
    // paymentStatus, GL journal reversal, and the OrderHistory audit row are
    // all handled consistently with the normal app flow. No `requester` is
    // passed: the MCP key is tenant-scoped, not user-scoped.
    await orderService.updateOrderStatus(parsed.orderId, {
      status: parsed.status,
      notes: parsed.notes ?? 'Status updated via MCP',
      ...(parsed.deliveryDate ? { deliveryDate: new Date(`${parsed.deliveryDate}T00:00:00.000Z`) } : {}),
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
    'Update an order\'s fulfillment status. Writes an order-history audit row and, via the shared order service, adjusts inventory and (on delivered/returned) payment status and accounting entries. Idempotent: makes no change if the order is already in the requested status. Valid statuses: pending_confirmation, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, cancelled, returned, failed_delivery. Optionally accepts deliveryDate (YYYY-MM-DD) to record when a delivery actually happened — use it when reconciling past deliveries from a 3PL, otherwise the delivery date defaults to now.',
    ordersUpdateStatusSchema.shape,
    wrapHandler(updateOrderStatusTool),
  );
}
