import { z } from 'zod';
import { resolveTenantId } from '../../utils/tenantContext';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpMoneyJson, mcpError } from '../utils';
import * as Money from '../../utils/money';
import { deliveredRevenue } from '../../services/kpi/revenue';
import { rates } from '../../services/kpi/rates';
import { endOfDay, getStoreTimeZone, localDate, monthRange, parseYmd, shiftYmd, startOfDay } from '../../services/kpi/dates';

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
    'Daily business summary for a store-zone day: orders placed, delivered revenue (2-decimal string) and delivered count (by delivery date), confirmationRate, deliverySuccessRate, orderToCashYield (percents, null when nothing to divide), status counts, top products. Defaults to today.',
    dailySchema.shape,
    wrapHandler(async (args: z.infer<typeof dailySchema>) => {
      try {
        const parsed = dailySchema.parse(args);
        const zone = getStoreTimeZone();
        const day = parsed.date ?? localDate(new Date(), zone);
        const start = startOfDay(day, zone);
        const end = endOfDay(day, zone); // exclusive

        const tenantId = resolveTenantId();

        const [{ stats, statusCounts }, topProducts] = await Promise.all([
          periodStats(tenantId, start, end),
          prisma.orderItem.groupBy({
            by: ['productId'],
            // OrderItem has no tenantId: scope it through the parent order.
            where: { order: { createdAt: { gte: start, lt: end }, deletedAt: null, tenantId } },
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

        return mcpMoneyJson({
          date: day,
          ...stats,
          statusBreakdown: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.id])),
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
    'Weekly business summary (Monday to Sunday, store-zone days) with comparison to prior week: orders placed, delivered revenue (2-decimal string), delivered count, confirmationRate, deliverySuccessRate, orderToCashYield. Changes in the three rates are in percentage points ("pp"), null when either week has no value. Defaults to current week.',
    weeklySchema.shape,
    wrapHandler(async (args: z.infer<typeof weeklySchema>) => {
      try {
        const parsed = weeklySchema.parse(args);
        const zone = getStoreTimeZone();
        const tenantId = resolveTenantId();
        const ref = parsed.weekOf ?? localDate(new Date(), zone);

        // Current week: Mon-Sun, in store-zone days
        const { year, month, day } = parseYmd(ref);
        const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        const thisMonday = shiftYmd(ref, dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
        const thisSunday = shiftYmd(thisMonday, 6);
        const lastMonday = shiftYmd(thisMonday, -7);
        const lastSunday = shiftYmd(thisMonday, -1);

        const [{ stats: thisWeek }, { stats: lastWeek }] = await Promise.all([
          periodStats(tenantId, startOfDay(thisMonday, zone), endOfDay(thisSunday, zone)),
          periodStats(tenantId, startOfDay(lastMonday, zone), endOfDay(lastSunday, zone)),
        ]);

        return mcpMoneyJson({
          currentWeek: { from: thisMonday, to: thisSunday, ...thisWeek },
          priorWeek: { from: lastMonday, to: lastSunday, ...lastWeek },
          change: {
            orders: thisWeek.totalOrders - lastWeek.totalOrders,
            revenue: Money.toApi(Money.sub(thisWeek.revenue, lastWeek.revenue)),
            confirmationRate: pointsChange(thisWeek.confirmationRate, lastWeek.confirmationRate),
            deliverySuccessRate: pointsChange(thisWeek.deliverySuccessRate, lastWeek.deliverySuccessRate),
            orderToCashYield: pointsChange(thisWeek.orderToCashYield, lastWeek.orderToCashYield),
          },
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );

  server.tool(
    'analytics_monthly',
    'Monthly business summary with growth metrics (store-zone calendar month): orders placed, delivered revenue (2-decimal string), delivered count, confirmationRate, deliverySuccessRate, orderToCashYield. Defaults to current month.',
    monthlySchema.shape,
    wrapHandler(async (args: z.infer<typeof monthlySchema>) => {
      try {
        const parsed = monthlySchema.parse(args);
        const zone = getStoreTimeZone();
        const tenantId = resolveTenantId();
        let year: number, month: number;
        if (parsed.month) {
          [year, month] = parsed.month.split('-').map(Number);
        } else {
          ({ year, month } = parseYmd(localDate(new Date(), zone)));
        }

        const { from: start, to: end } = monthRange(year, month, zone);
        const prior = monthRange(year, month - 1, zone); // month 0 rolls back to December

        const [{ stats: current }, { stats: priorStats }, newCustomers] = await Promise.all([
          periodStats(tenantId, start, end),
          periodStats(tenantId, prior.from, prior.to),
          prisma.customer.count({ where: { createdAt: { gte: start, lt: end } } }),
        ]);

        const orderGrowth = priorStats.totalOrders > 0
          ? (((current.totalOrders - priorStats.totalOrders) / priorStats.totalOrders) * 100).toFixed(1)
          : 'N/A';

        return mcpMoneyJson({
          month: `${year}-${String(month).padStart(2, '0')}`,
          ...current,
          newCustomers,
          priorMonth: priorStats,
          growth: {
            orders: `${orderGrowth}%`,
            revenue: Money.gt(priorStats.revenue, 0)
              ? `${Money.percent(Money.sub(current.revenue, priorStats.revenue), priorStats.revenue).toFixed(1)}%`
              : 'N/A',
          },
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}

/**
 * Numbers for one store-zone range [from, to): orders placed, delivered revenue and count, and the three rates (KPI layer).
 * `statusCounts` is the placed-order status groupBy the total is summed from.
 */
async function periodStats(tenantId: string, from: Date, to: Date) {
  const [statusCounts, revenue, rangeRates] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lt: to }, deletedAt: null },
      _count: { id: true },
    }),
    deliveredRevenue(tenantId, from, to),
    rates(tenantId, from, to),
  ]);
  return {
    statusCounts,
    stats: {
      totalOrders: statusCounts.reduce((sum, s) => sum + s._count.id, 0),
      delivered: revenue.deliveredOrders.value,
      revenue: revenue.total.value,
      confirmationRate: rangeRates.confirmationRate.value,
      deliverySuccessRate: rangeRates.deliverySuccessRate.value,
      orderToCashYield: rangeRates.orderToCashYield.value,
    },
  };
}

function pointsChange(current: number | null, prior: number | null): string | null {
  return current === null || prior === null ? null : `${(current - prior).toFixed(1)}pp`;
}
