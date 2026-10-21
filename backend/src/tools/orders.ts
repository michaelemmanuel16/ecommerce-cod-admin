import { z } from 'zod';
import { OrderStatus } from '@prisma/client';
import { defineTool, registerToolDef } from './registry';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import orderService from '../services/orderService';
import { deliveredRevenue } from '../services/kpi/revenue';
import { rates } from '../services/kpi/rates';
import { cursorId, dateRangeOut, limitField, nextCursorOf, storeRange, withCurrency } from './shared';

/**
 * Order tools. Query logic lives in orderService; money is a 2-decimal string next to the tenant currency code.
 */

const ORDER_STATUSES = Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]];

registerToolDef(defineTool({
  name: 'orders_search',
  description: 'Search orders by status, date range, customer, delivery agent, or keyword. Returns paginated results with customer and agent info.',
  input: z.object({
    status: z.enum(ORDER_STATUSES).optional(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    customerId: z.number().int().optional(),
    agentId: z.number().int().optional(),
    search: z.string().max(100).optional(),
    limit: limitField,
    cursor: z.string().optional(),
  }),
  money: true,
  handler: async (input) => {
    const { orders, hasMore } = await orderService.search({
      status: input.status,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      customerId: input.customerId,
      agentId: input.agentId,
      search: input.search,
      limit: input.limit,
      cursorId: cursorId(input.cursor),
    });
    return withCurrency({
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        totalAmount: Money.toApi(o.totalAmount),
        // Delivery destination: prefer the order's shipping fields, fall back to the customer record.
        deliveryAddress: o.deliveryAddress ?? o.customer?.address ?? null,
        deliveryState: o.deliveryState ?? o.customer?.state ?? null,
        createdAt: o.createdAt.toISOString(),
        customer: o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : null,
        customerPhone: o.customer?.phoneNumber,
        customerAltPhone: o.customer?.alternatePhone ?? null,
        agent: o.deliveryAgent ? `${o.deliveryAgent.firstName} ${o.deliveryAgent.lastName}` : null,
        // Upsell rows point productId at the parent product; the real add-on name lives in metadata.upsellName.
        items: o.orderItems.map((i) => ({
          product: (i.metadata as { upsellName?: string } | null)?.upsellName ?? i.product?.name,
          qty: i.quantity,
          price: Money.toApi(i.unitPrice),
        })),
      })),
      total: orders.length,
      nextCursor: nextCursorOf(orders, hasMore),
    });
  },
}));

registerToolDef(defineTool({
  name: 'orders_summary',
  description: 'Order statistics for a period: orders placed and count by status (by order date), delivered revenue and delivered count (by delivery date), confirmationRate, deliverySuccessRate and orderToCashYield (percents, null when there is nothing to divide), and confirmedCount (orders placed in the period that were confirmed). Revenue is a 2-decimal string. dateTo is inclusive.',
  input: z.object({
    period: z.enum(['today', 'week', 'month', 'custom']).default('today'),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
  money: true,
  handler: async (input) => {
    const { from, to } = storeRange(input.period, input.dateFrom, input.dateTo);
    const tenantId = resolveTenantId();

    const [statusCounts, revenue, rangeRates] = await Promise.all([
      orderService.statusCounts(from, to),
      deliveredRevenue(tenantId, from, to),
      rates(tenantId, from, to),
    ]);

    return withCurrency({
      period: input.period,
      dateRange: dateRangeOut(from, to),
      totalOrders: statusCounts.reduce((sum, s) => sum + s._count.id, 0),
      statusBreakdown: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.id])),
      revenue: revenue.total.value,
      deliveredCount: revenue.deliveredOrders.value,
      confirmedCount: rangeRates.confirmationRate.detail?.confirmed ?? 0,
      confirmationRate: rangeRates.confirmationRate.value,
      deliverySuccessRate: rangeRates.deliverySuccessRate.value,
      orderToCashYield: rangeRates.orderToCashYield.value,
    });
  },
}));

registerToolDef(defineTool({
  name: 'orders_update_status',
  description: 'Update an order\'s fulfillment status. Writes an order-history audit row and, via the shared order service, adjusts inventory and (on delivered/returned) payment status and accounting entries. Idempotent: makes no change if the order is already in the requested status. Valid statuses: pending_confirmation, payment_pending, payment_failed, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, digital_delivered, failed_delivery, returned, cancelled. The order state machine applies: an invalid move returns an error with the moves that are allowed. Optionally accepts deliveryDate (YYYY-MM-DD) to record when a delivery actually happened — use it when reconciling past deliveries from a 3PL, otherwise the delivery date defaults to now.',
  input: z.object({
    orderId: z.number().int().positive(),
    status: z.enum(ORDER_STATUSES),
    notes: z.string().max(500).optional(),
    // The real delivery date, for 3PL reconciliation where delivery happened days
    // ago. Only meaningful with status "delivered". Omitted => now.
    deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'deliveryDate must be YYYY-MM-DD').optional(),
  }),
  kind: 'write',
  // A write tool is MCP-only by default (defineTool): outside agents sync partner status through it.
  handler: async (input, _ctx, trace) => {
    // Calendar validity check, on top of the schema's digit-shape regex.
    // JS silently rolls impossible calendar days into the next month (e.g.
    // 2026-02-30 -> 2026-03-02, 2026-02-29 -> 2026-03-01 since 2026 isn't a
    // leap year), which would post GL revenue into the wrong accounting
    // period. Round-tripping through toISOString catches both an outright
    // Invalid Date and this silent rollover in one check.
    let deliveryDate: Date | undefined;
    if (input.deliveryDate) {
      const candidate = new Date(`${input.deliveryDate}T00:00:00.000Z`);
      if (candidate.toISOString().slice(0, 10) !== input.deliveryDate) {
        throw new AppError(`deliveryDate "${input.deliveryDate}" is not a valid calendar date`, 400);
      }
      deliveryDate = candidate;
    }

    // Tenant-scoped lookup: an orderId of another tenant is not found, so this tool can never change another store's order.
    const existing = await orderService.findForStatusUpdate(input.orderId);
    if (!existing) throw new AppError(`Order ${input.orderId} not found`, 404);

    const customer = existing.customer ? `${existing.customer.firstName} ${existing.customer.lastName}` : null;
    const customerPhone = existing.customer?.phoneNumber ?? null;
    trace.resourceId = String(input.orderId);
    trace.before = { status: existing.status };

    // Idempotency guard: never re-run the status side effects (inventory movement, GL reversal, payment
    // collection) when the order is already in the requested status.
    if (existing.status === input.status) {
      trace.after = { status: existing.status };
      return {
        updated: false,
        orderId: input.orderId,
        status: existing.status,
        customer,
        customerPhone,
        message: `Order already in status "${input.status}"; no change made.`,
      };
    }

    // The shared service runs transitionOrder (state machine, M1): inventory, delivery date, paymentStatus, GL
    // reversal and the OrderHistory row are handled as in the app. The order history records the actor as
    // `integration` (D1) for now, whatever user the key has (the audit row holds that user). An INVALID_TRANSITION / STALE_ORDER error reaches the caller as the tool error.
    await orderService.updateOrderStatus(input.orderId, {
      status: input.status,
      notes: input.notes ?? 'Status updated via MCP',
      deliveryDate,
      actor: { kind: 'integration' },
    });
    trace.after = { status: input.status };

    return {
      updated: true,
      orderId: input.orderId,
      previousStatus: existing.status,
      newStatus: input.status,
      customer,
      customerPhone,
    };
  },
}));
