import { z } from 'zod';
import { defineTool, registerToolDef } from './registry';
import { resolveTenantId } from '../utils/tenantContext';
import { toolQueryService } from '../services/toolQueryService';
import { repRates } from '../services/kpi/reps';
import { deliveredRevenueByRep } from '../services/kpi/revenue';
import { dateRangeOut, periodField, storeRange, withCurrency } from './shared';

/**
 * Customer rep tools. Rates come from the M1 rep service: confirmationRate (confirmed / assigned) and
 * deliveredFromConfirmedRate (delivered / closed among the orders the rep confirmed).
 */

registerToolDef(defineTool({
  name: 'reps_status',
  description: 'Current workload for all customer/sales reps: orders created today, pending orders, total active orders.',
  input: z.object({}),
  handler: async () => {
    const { reps, createdToday, pending, active } = await toolQueryService.repWorkload(storeRange('today').from);

    const repStats = reps.map((rep) => ({
      id: rep.id,
      name: `${rep.firstName} ${rep.lastName}`,
      phone: rep.phoneNumber,
      createdToday: createdToday.get(rep.id) ?? 0,
      pendingOrders: pending.get(rep.id) ?? 0,
      activeOrders: active.get(rep.id) ?? 0,
    }));

    return {
      reps: repStats.sort((a, b) => b.activeOrders - a.activeOrders),
      totalReps: reps.length,
      totalCreatedToday: repStats.reduce((sum, r) => sum + r.createdToday, 0),
      totalPending: repStats.reduce((sum, r) => sum + r.pendingOrders, 0),
    };
  },
}));

registerToolDef(defineTool({
  name: 'reps_performance',
  description: 'Customer rep performance for a period: orders assigned, confirmationRate (confirmed / assigned), deliveredFromConfirmedRate (delivered / closed among the orders the rep confirmed), delivered revenue. Rates are percents, null when there is nothing to divide.',
  input: z.object({
    repId: z.number().int().optional(),
    period: periodField(false),
  }),
  money: true,
  handler: async (input) => {
    const { from, to } = storeRange(input.period);
    const reps = await toolQueryService.salesReps(input.repId);

    // Rates and revenue come from the KPI layer: confirmationRate by customerRepId, deliveredFromConfirmedRate by confirmedById.
    const tenantId = resolveTenantId();
    const [rangeRates, revenueByRep] = await Promise.all([
      repRates(tenantId, from, to),
      deliveredRevenueByRep(tenantId, from, to),
    ]);

    const repPerf = reps.map((rep) => {
      const { confirmationRate, deliveredFromConfirmedRate } = rangeRates.rep(rep.id);
      return {
        id: rep.id,
        name: `${rep.firstName} ${rep.lastName}`,
        ordersCreated: confirmationRate.detail.placed,
        confirmed: confirmationRate.detail.confirmed,
        confirmationRate: confirmationRate.value,
        closed: deliveredFromConfirmedRate.detail.closed,
        delivered: deliveredFromConfirmedRate.detail.delivered,
        deliveredFromConfirmedRate: deliveredFromConfirmedRate.value,
        revenue: revenueByRep.get(rep.id)?.revenue ?? '0.00',
      };
    });

    return withCurrency({
      period: input.period,
      dateRange: dateRangeOut(from, to),
      reps: repPerf.sort((a, b) => b.ordersCreated - a.ordersCreated),
    });
  },
}));
