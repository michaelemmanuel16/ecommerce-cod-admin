import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { encodeCursor, decodeCursor, mcpMoneyJson, mcpError, getStoreRange, dateRangeOut } from '../utils';
import { resolveTenantId } from '../../utils/tenantContext';
import { deliveredRevenue } from '../../services/kpi/revenue';
import { rates } from '../../services/kpi/rates';
import { customerPhoneSearch } from '../../utils/phone';

const ordersSearchSchema = z.object({
  status: z.enum([
    'pending_confirmation', 'payment_pending', 'confirmed', 'preparing',
    'ready_for_pickup', 'out_for_delivery', 'delivered', 'digital_delivered',
    'cancelled', 'returned', 'failed_delivery', 'payment_failed',
  ]).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customerId: z.number().int().optional(),
  agentId: z.number().int().optional(),
  search: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(25).optional(),
  cursor: z.string().optional(),
});

const ordersSummarySchema = z.object({
  period: z.enum(['today', 'week', 'month', 'custom']).default('today'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export function registerOrderTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'orders_search',
    'Search orders by status, date range, customer, delivery agent, or keyword. Returns paginated results with customer and agent info.',
    ordersSearchSchema.shape,
    wrapHandler(async (args: z.infer<typeof ordersSearchSchema>) => {
      try {
        const parsed = ordersSearchSchema.parse(args);
        const limit = parsed.limit ?? 25;
        const where: any = { deletedAt: null };

        if (parsed.status) where.status = parsed.status;
        if (parsed.customerId) where.customerId = parsed.customerId;
        if (parsed.agentId) where.deliveryAgentId = parsed.agentId;
        if (parsed.dateFrom || parsed.dateTo) {
          where.createdAt = {};
          if (parsed.dateFrom) where.createdAt.gte = new Date(parsed.dateFrom);
          if (parsed.dateTo) where.createdAt.lte = new Date(parsed.dateTo);
        }
        if (parsed.search) {
          const searchNum = parseInt(parsed.search);
          const phoneSearch = customerPhoneSearch(parsed.search);
          where.OR = [
            ...(isNaN(searchNum) ? [] : [{ id: searchNum }]),
            ...(phoneSearch ? [phoneSearch] : []),
            { customer: { firstName: { contains: parsed.search, mode: 'insensitive' } } },
          ];
        }

        const cursorOption = parsed.cursor
          ? { cursor: { id: decodeCursor(parsed.cursor) }, skip: 1 }
          : {};

        const orders = await prisma.order.findMany({
          where,
          ...cursorOption,
          take: limit + 1, // Fetch one extra to check if there's a next page
          orderBy: { id: 'desc' },
          include: {
            customer: {
              select: {
                id: true, firstName: true, lastName: true, phoneNumber: true,
                alternatePhone: true, address: true, state: true,
              },
            },
            deliveryAgent: { select: { id: true, firstName: true, lastName: true } },
            orderItems: { include: { product: { select: { id: true, name: true } } } },
          },
        });

        const hasMore = orders.length > limit;
        const results = hasMore ? orders.slice(0, limit) : orders;
        const nextCursor = hasMore ? encodeCursor(results[results.length - 1].id) : undefined;

        return mcpMoneyJson({
          orders: results.map((o) => ({
            id: o.id,
            status: o.status,
            totalAmount: o.totalAmount,
            // Delivery destination: prefer the order's shipping fields, fall back to the customer record.
            deliveryAddress: o.deliveryAddress ?? o.customer?.address ?? null,
            deliveryState: o.deliveryState ?? o.customer?.state ?? null,
            createdAt: o.createdAt,
            customer: o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : null,
            customerPhone: o.customer?.phoneNumber,
            customerAltPhone: o.customer?.alternatePhone ?? null,
            agent: o.deliveryAgent ? `${o.deliveryAgent.firstName} ${o.deliveryAgent.lastName}` : null,
            // Upsell rows point productId at the parent product; the real add-on name lives in metadata.upsellName.
            items: o.orderItems.map((i) => ({
              product: (i.metadata as any)?.upsellName ?? i.product?.name,
              qty: i.quantity,
              price: i.unitPrice,
            })),
          })),
          total: results.length,
          nextCursor,
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );

  server.tool(
    'orders_summary',
    'Order statistics for a period: orders placed and count by status (by order date), delivered revenue and delivered count (by delivery date), confirmationRate, deliverySuccessRate and orderToCashYield (percents, null when there is nothing to divide). Revenue is a 2-decimal string. dateTo is inclusive.',
    ordersSummarySchema.shape,
    wrapHandler(async (args: z.infer<typeof ordersSummarySchema>) => {
      try {
        const parsed = ordersSummarySchema.parse(args);
        const { from, to } = getStoreRange(parsed.period, parsed.dateFrom, parsed.dateTo);
        const tenantId = resolveTenantId();

        const [statusCounts, revenue, rangeRates] = await Promise.all([
          prisma.order.groupBy({
            by: ['status'],
            where: { createdAt: { gte: from, lt: to }, deletedAt: null },
            _count: { id: true },
          }),
          deliveredRevenue(tenantId, from, to),
          rates(tenantId, from, to),
        ]);

        return mcpMoneyJson({
          period: parsed.period,
          dateRange: dateRangeOut(from, to),
          totalOrders: statusCounts.reduce((sum, s) => sum + s._count.id, 0),
          statusBreakdown: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.id])),
          revenue: revenue.total.value,
          deliveredCount: revenue.deliveredOrders.value,
          confirmationRate: rangeRates.confirmationRate.value,
          deliverySuccessRate: rangeRates.deliverySuccessRate.value,
          orderToCashYield: rangeRates.orderToCashYield.value,
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}
