/**
 * Partner rates and timings (M1-T21, F-702 formula half; the page is M4).
 *
 * One row per delivery partner (Order.deliveryAgentId) that has orders placed in [from, to) (cohort basis:
 * orders placed in the range, outcome by current status). Orders in scope: not deleted, not digital.
 *
 * deliverySuccessRate = delivered / (delivered + failed_delivery + returned), closed orders only (F-251). Null when
 *   the partner has no closed order ("no closed orders").
 * confirmedToDispatched = median of dispatchedAt - confirmedAt, in days (1 decimal), over the partner's orders that have both.
 * dispatchedToDelivered = median of deliveryDate - dispatchedAt, in days, over delivered orders that have both.
 * Jump orders (D1: any history row with metadata.jump = true, an integration/ai move outside the F-301 table)
 * are left out of both timings: their timestamps come from a 3PL report, not from our flow. They still count in the rate.
 * A negative gap (clock error) is left out of the timing.
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { Prisma, OrderStatus } from '@prisma/client';
import { DAY_MS } from './dates';
import { medianRounded } from './median';
import { closedOutcomeResult, DIGITAL } from './rates';
import { kpiMeta, type KpiResult } from './types';

export interface PartnerRow {
  partnerId: number;
  name: string;
  /** Orders placed in the range and assigned to the partner, any status. */
  assigned: number;
  deliverySuccessRate: KpiResult<number | null>;
  confirmedToDispatchedDays: KpiResult<number | null>;
  dispatchedToDeliveredDays: KpiResult<number | null>;
}

/** Median of gaps in ms, as days to 1 decimal. Null for an empty list. */
function medianDays(gapsMs: number[]): number | null {
  return medianRounded(gapsMs.filter((g) => g >= 0).map((g) => g / DAY_MS), 1);
}

export async function partnerRates(tenantId: string, from: Date, to: Date): Promise<PartnerRow[]> {
  const meta = kpiMeta(from, to);

  return runInTenant(tenantId, async () => {
    const scope: Prisma.OrderWhereInput = {
      deletedAt: null,
      status: { notIn: DIGITAL },
      deliveryAgentId: { not: null },
      createdAt: { gte: from, lt: to },
    };
    const notJump: Prisma.OrderWhereInput = {
      NOT: { orderHistory: { some: { metadata: { path: ['jump'], equals: true } } } },
    };

    const [byStatus, timing, partners] = await Promise.all([
      prisma.order.groupBy({ by: ['deliveryAgentId', 'status'], where: scope, _count: { _all: true } }),
      prisma.order.findMany({
        where: { ...scope, ...notJump, dispatchedAt: { not: null } },
        select: { deliveryAgentId: true, status: true, confirmedAt: true, dispatchedAt: true, deliveryDate: true },
      }),
      prisma.user.findMany({
        where: { role: 'delivery_agent' },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    const names = new Map(partners.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
    const statusBy = new Map<number, Map<OrderStatus, number>>();
    for (const g of byStatus) {
      const id = g.deliveryAgentId!;
      const counts = statusBy.get(id) ?? new Map<OrderStatus, number>();
      counts.set(g.status, g._count._all);
      statusBy.set(id, counts);
    }
    const timingBy = new Map<number, typeof timing>();
    for (const o of timing) {
      const id = o.deliveryAgentId!;
      const rows = timingBy.get(id);
      if (rows) rows.push(o); else timingBy.set(id, [o]);
    }
    const ids = [...statusBy.keys()].sort((a, b) => a - b);

    return ids.map((id) => {
      const counts = statusBy.get(id)!;
      const n = (s: OrderStatus) => counts.get(s) ?? 0;
      const delivered = n('delivered');
      const failed = n('failed_delivery');
      const returned = n('returned');
      const assigned = [...counts.values()].reduce((sum, c) => sum + c, 0);

      const toDispatch: number[] = [];
      const toDeliver: number[] = [];
      for (const o of timingBy.get(id) ?? []) {
        if (o.confirmedAt && o.dispatchedAt) toDispatch.push(o.dispatchedAt.getTime() - o.confirmedAt.getTime());
        if (o.status === 'delivered' && o.deliveryDate && o.dispatchedAt) toDeliver.push(o.deliveryDate.getTime() - o.dispatchedAt.getTime());
      }

      return {
        partnerId: id,
        name: names.get(id) ?? `Partner ${id}`,
        assigned,
        deliverySuccessRate: closedOutcomeResult('Delivery success rate', 'partner.deliverySuccess.cohort.v1', 'cohort', { delivered, failed, returned }, meta),
        confirmedToDispatchedDays: {
          name: 'Confirmed to dispatched (median)', value: medianDays(toDispatch), unit: 'days',
          dateBasis: 'cohort', formulaId: 'partner.confirmedToDispatched.v1', ...meta,
          detail: { measured: toDispatch.length },
        },
        dispatchedToDeliveredDays: {
          name: 'Dispatched to delivered (median)', value: medianDays(toDeliver), unit: 'days',
          dateBasis: 'cohort', formulaId: 'partner.dispatchedToDelivered.v1', ...meta,
          detail: { measured: toDeliver.length },
        },
      };
    });
  });
}
