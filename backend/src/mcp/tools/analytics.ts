import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpJson, mcpError } from '../utils';

const dailySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const weeklySchema = z.object({
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const monthlySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export function registerAnalyticsTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'analytics_daily',
    'Daily business summary: orders, revenue, deliveries, returns, top products. Defaults to today.',
    dailySchema.shape,
    wrapHandler(async (args: z.infer<typeof dailySchema>) => {
      try {
        const parsed = dailySchema.parse(args);
        const date = parsed.date ? new Date(parsed.date) : new Date();
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        const dateFilter = { createdAt: { gte: start, lte: end } };

        const [orders, revenue, statusCounts, topProducts] = await Promise.all([
          prisma.order.count({ where: { ...dateFilter, deletedAt: null } }),
          prisma.order.aggregate({
            where: { ...dateFilter, deletedAt: null, status: 'delivered' },
            _sum: { totalAmount: true },
          }),
          prisma.order.groupBy({
            by: ['status'],
            where: { ...dateFilter, deletedAt: null },
            _count: { id: true },
          }),
          prisma.orderItem.groupBy({
            by: ['productId'],
            where: { order: { ...dateFilter, deletedAt: null } },
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 5,
          }),
        ]);

        // Resolve product names for top products
        const productIds = topProducts.map((p) => p.productId);
        const products = productIds.length > 0
          ? await prisma.product.findMany({
              where: { id: { in: productIds } },
              select: { id: true, name: true },
            })
          : [];
        const productMap = new Map(products.map((p) => [p.id, p.name]));

        return mcpJson({
          date: start.toISOString().split('T')[0],
          totalOrders: orders,
          revenue: revenue._sum.totalAmount ?? 0,
          statusBreakdown: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.id])),
          delivered: statusCounts.find((s) => s.status === 'delivered')?._count.id ?? 0,
          returned: statusCounts.find((s) => s.status === 'returned')?._count.id ?? 0,
          cancelled: statusCounts.find((s) => s.status === 'cancelled')?._count.id ?? 0,
          failedDelivery: statusCounts.find((s) => s.status === 'failed_delivery')?._count.id ?? 0,
          topProducts: topProducts.map((p) => ({
            name: productMap.get(p.productId) ?? `Product #${p.productId}`,
            unitsSold: p._sum.quantity ?? 0,
          })),
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );

  server.tool(
    'analytics_weekly',
    'Weekly business summary with comparison to prior week. Defaults to current week.',
    weeklySchema.shape,
    wrapHandler(async (args: z.infer<typeof weeklySchema>) => {
      try {
        const parsed = weeklySchema.parse(args);
        const refDate = parsed.weekOf ? new Date(parsed.weekOf) : new Date();

        // Current week: Mon-Sun
        const dayOfWeek = refDate.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const thisWeekStart = new Date(refDate);
        thisWeekStart.setDate(thisWeekStart.getDate() + mondayOffset);
        thisWeekStart.setHours(0, 0, 0, 0);
        const thisWeekEnd = new Date(thisWeekStart);
        thisWeekEnd.setDate(thisWeekEnd.getDate() + 6);
        thisWeekEnd.setHours(23, 59, 59, 999);

        // Prior week
        const lastWeekStart = new Date(thisWeekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekEnd = new Date(thisWeekStart);
        lastWeekEnd.setMilliseconds(-1);

        const [thisWeek, lastWeek] = await Promise.all([
          getWeekStats(thisWeekStart, thisWeekEnd),
          getWeekStats(lastWeekStart, lastWeekEnd),
        ]);

        return mcpJson({
          currentWeek: { from: thisWeekStart.toISOString().split('T')[0], to: thisWeekEnd.toISOString().split('T')[0], ...thisWeek },
          priorWeek: { from: lastWeekStart.toISOString().split('T')[0], to: lastWeekEnd.toISOString().split('T')[0], ...lastWeek },
          change: {
            orders: thisWeek.totalOrders - lastWeek.totalOrders,
            revenue: (thisWeek.revenue as number) - (lastWeek.revenue as number),
            deliveryRate: `${((thisWeek.deliveryRate as number) - (lastWeek.deliveryRate as number)).toFixed(1)}pp`,
          },
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );

  server.tool(
    'analytics_monthly',
    'Monthly business summary with growth metrics. Defaults to current month.',
    monthlySchema.shape,
    wrapHandler(async (args: z.infer<typeof monthlySchema>) => {
      try {
        const parsed = monthlySchema.parse(args);
        let year: number, month: number;
        if (parsed.month) {
          [year, month] = parsed.month.split('-').map(Number);
        } else {
          const now = new Date();
          year = now.getFullYear();
          month = now.getMonth() + 1;
        }

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0, 23, 59, 59, 999);

        // Prior month
        const priorStart = new Date(year, month - 2, 1);
        const priorEnd = new Date(year, month - 1, 0, 23, 59, 59, 999);

        const [current, prior, newCustomers] = await Promise.all([
          getWeekStats(start, end),
          getWeekStats(priorStart, priorEnd),
          prisma.customer.count({ where: { createdAt: { gte: start, lte: end } } }),
        ]);

        const orderGrowth = prior.totalOrders > 0
          ? (((current.totalOrders - prior.totalOrders) / prior.totalOrders) * 100).toFixed(1)
          : 'N/A';

        return mcpJson({
          month: `${year}-${String(month).padStart(2, '0')}`,
          ...current,
          newCustomers,
          priorMonth: prior,
          growth: {
            orders: `${orderGrowth}%`,
            revenue: prior.revenue
              ? `${((((current.revenue as number) - (prior.revenue as number)) / (prior.revenue as number)) * 100).toFixed(1)}%`
              : 'N/A',
          },
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}

async function getWeekStats(start: Date, end: Date) {
  const dateFilter = { createdAt: { gte: start, lte: end } };

  const [total, delivered, revenue] = await Promise.all([
    prisma.order.count({ where: { ...dateFilter, deletedAt: null } }),
    prisma.order.count({ where: { ...dateFilter, deletedAt: null, status: 'delivered' } }),
    prisma.order.aggregate({
      where: { ...dateFilter, deletedAt: null, status: 'delivered' },
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    totalOrders: total,
    delivered,
    revenue: revenue._sum.totalAmount ?? 0,
    deliveryRate: total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0,
  };
}
