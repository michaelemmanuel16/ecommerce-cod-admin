import { z } from 'zod';
import { defineTool, registerToolDef } from './registry';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { toolQueryService } from '../services/toolQueryService';
import { endOfDay, getStoreTimeZone, localDate, monthRange, parseYmd, shiftYmd, startOfDay, weekRange } from '../services/kpi/dates';
import { withCurrency } from './shared';

/**
 * Analytics tools, on top of the KPI services (delivered revenue by delivery date, the three named rates).
 * The rate keys are confirmationRate, deliverySuccessRate and orderToCashYield.
 */

function pointsChange(current: number | null, prior: number | null): string | null {
  return current === null || prior === null ? null : `${(current - prior).toFixed(1)}pp`;
}

registerToolDef(defineTool({
  name: 'analytics_daily',
  description: 'Daily business summary for a store-zone day: orders placed, delivered revenue (2-decimal string) and delivered count (by delivery date), confirmationRate, deliverySuccessRate, orderToCashYield (percents, null when nothing to divide), status counts, top products. Defaults to today.',
  input: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  money: true,
  handler: async (input) => {
    const zone = getStoreTimeZone();
    const day = input.date ?? localDate(new Date(), zone);
    const start = startOfDay(day, zone);
    const end = endOfDay(day, zone); // exclusive
    const tenantId = resolveTenantId();

    const [{ stats, statusCounts }, topProducts] = await Promise.all([
      toolQueryService.periodStats(tenantId, start, end),
      toolQueryService.topProducts(tenantId, start, end),
    ]);

    return withCurrency({
      date: day,
      ...stats,
      statusBreakdown: Object.fromEntries(statusCounts.map((s) => [s.status, s._count.id])),
      returned: statusCounts.find((s) => s.status === 'returned')?._count.id ?? 0,
      cancelled: statusCounts.find((s) => s.status === 'cancelled')?._count.id ?? 0,
      failedDelivery: statusCounts.find((s) => s.status === 'failed_delivery')?._count.id ?? 0,
      topProducts,
    });
  },
}));

registerToolDef(defineTool({
  name: 'analytics_weekly',
  description: 'Weekly business summary (Monday to Sunday, store-zone days) with comparison to prior week: orders placed, delivered revenue (2-decimal string), delivered count, confirmationRate, deliverySuccessRate, orderToCashYield. Changes in the three rates are in percentage points ("pp"), null when either week has no value. Defaults to current week.',
  input: z.object({
    weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  money: true,
  handler: async (input) => {
    const zone = getStoreTimeZone();
    const tenantId = resolveTenantId();
    const ref = input.weekOf ?? localDate(new Date(), zone);

    // Current week and the one before, Mon-Sun in store-zone days
    const thisWeek = weekRange(ref, zone);
    const lastWeek = weekRange(shiftYmd(thisWeek.monday, -1), zone);

    const [{ stats: thisStats }, { stats: lastStats }] = await Promise.all([
      toolQueryService.periodStats(tenantId, thisWeek.from, thisWeek.to),
      toolQueryService.periodStats(tenantId, lastWeek.from, lastWeek.to),
    ]);

    return withCurrency({
      currentWeek: { from: thisWeek.monday, to: thisWeek.sunday, ...thisStats },
      priorWeek: { from: lastWeek.monday, to: lastWeek.sunday, ...lastStats },
      change: {
        orders: thisStats.totalOrders - lastStats.totalOrders,
        revenue: Money.toApi(Money.sub(thisStats.revenue, lastStats.revenue)),
        confirmationRate: pointsChange(thisStats.confirmationRate, lastStats.confirmationRate),
        deliverySuccessRate: pointsChange(thisStats.deliverySuccessRate, lastStats.deliverySuccessRate),
        orderToCashYield: pointsChange(thisStats.orderToCashYield, lastStats.orderToCashYield),
      },
    });
  },
}));

registerToolDef(defineTool({
  name: 'analytics_monthly',
  description: 'Monthly business summary with growth metrics (store-zone calendar month): orders placed, delivered revenue (2-decimal string), delivered count, confirmationRate, deliverySuccessRate, orderToCashYield. Defaults to current month.',
  input: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  }),
  money: true,
  handler: async (input) => {
    const zone = getStoreTimeZone();
    const tenantId = resolveTenantId();
    let year: number, month: number;
    if (input.month) {
      [year, month] = input.month.split('-').map(Number);
    } else {
      ({ year, month } = parseYmd(localDate(new Date(), zone)));
    }

    const { from: start, to: end } = monthRange(year, month, zone);
    const prior = monthRange(year, month - 1, zone); // month 0 rolls back to December

    const [{ stats: current }, { stats: priorStats }, newCustomers] = await Promise.all([
      toolQueryService.periodStats(tenantId, start, end),
      toolQueryService.periodStats(tenantId, prior.from, prior.to),
      toolQueryService.newCustomers(start, end),
    ]);

    const orderGrowth = priorStats.totalOrders > 0
      ? (((current.totalOrders - priorStats.totalOrders) / priorStats.totalOrders) * 100).toFixed(1)
      : 'N/A';

    return withCurrency({
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
  },
}));
