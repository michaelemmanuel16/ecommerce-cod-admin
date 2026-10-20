/**
 * Rep rates (M1-T18, F-252, F-767, F-1054). Two named rates per rep, never "success rate":
 *
 * confirmationRate = confirmed / placed among the orders ASSIGNED to the rep (Order.customerRepId), orders placed
 *   (createdAt) in [from, to). Same definition and same statuses as rates.ts confirmationRate (D18). Fixture: Adwoa 73%.
 *
 * deliveredFromConfirmedRate = delivered / (delivered + failed_delivery + returned) among the orders the rep
 *   CONFIRMED (Order.confirmedById), cohort basis (orders placed in the range, outcome read today). Same maths as
 *   rates.ts deliverySuccessRate with a repId, just for every rep in two queries. Fixture: Adwoa 253 / 486 = 52%.
 *
 * Pay state is not read anywhere. The old service counted only delivered orders whose commission was still unpaid,
 * so the number fell after a payout (F-252). `all` is the same two rates over every order, whoever owns it.
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { OrderStatus } from '@prisma/client';
import { CLOSED, CONFIRMED, DIGITAL, closedOutcomeResult, confirmationRateResult } from './rates';
import { kpiMeta, type KpiResult } from './types';

/** A rate that always carries its counts. */
export type CountedRate = KpiResult<number | null> & { detail: Record<string, number> };

export interface RepRates {
  confirmationRate: CountedRate;
  deliveredFromConfirmedRate: CountedRate;
}

export interface RepRatesResult {
  /** Rates of one rep. A rep with no orders gets null values and zero counts. */
  rep: (repId: number) => RepRates;
  /** Rates over every order in the range. */
  all: RepRates;
}

export async function repRates(tenantId: string, from: Date, to: Date): Promise<RepRatesResult> {
  const meta = kpiMeta(from, to);
  const where = { deletedAt: null, createdAt: { gte: from, lt: to } };

  const [placedGroups, closedGroups] = await runInTenant(tenantId, () => Promise.all([
    prisma.order.groupBy({
      by: ['customerRepId', 'status'],
      where: { ...where, status: { notIn: DIGITAL } },
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ['confirmedById', 'status'],
      where: { ...where, status: { in: CLOSED } },
      _count: { _all: true },
    }),
  ]));

  const build = (placed: Map<OrderStatus, number>, closed: Map<OrderStatus, number>): RepRates => {
    const n = (m: Map<OrderStatus, number>, s: OrderStatus) => m.get(s) ?? 0;
    const placedCount = [...placed.values()].reduce((a, b) => a + b, 0);
    const confirmed = CONFIRMED.reduce((a, s) => a + n(placed, s), 0);
    const delivered = n(closed, 'delivered');
    const failed = n(closed, 'failed_delivery');
    const returned = n(closed, 'returned');
    return {
      confirmationRate: confirmationRateResult(confirmed, placedCount, meta),
      deliveredFromConfirmedRate: closedOutcomeResult('Delivered from confirmed rate', 'rate.deliveredFromConfirmed.v1', 'cohort', { delivered, failed, returned }, meta),
    };
  };

  const placedBy = new Map<number | 'all', Map<OrderStatus, number>>();
  const closedBy = new Map<number | 'all', Map<OrderStatus, number>>();
  const add = (m: Map<number | 'all', Map<OrderStatus, number>>, key: number | 'all', status: OrderStatus, count: number) => {
    const inner = m.get(key) ?? new Map<OrderStatus, number>();
    inner.set(status, (inner.get(status) ?? 0) + count);
    m.set(key, inner);
  };
  for (const g of placedGroups) {
    add(placedBy, 'all', g.status, g._count._all);
    if (g.customerRepId !== null) add(placedBy, g.customerRepId, g.status, g._count._all);
  }
  for (const g of closedGroups) {
    add(closedBy, 'all', g.status, g._count._all);
    if (g.confirmedById !== null) add(closedBy, g.confirmedById, g.status, g._count._all);
  }

  const empty = new Map<OrderStatus, number>();
  return {
    rep: (repId) => build(placedBy.get(repId) ?? empty, closedBy.get(repId) ?? empty),
    all: build(placedBy.get('all') ?? empty, closedBy.get('all') ?? empty),
  };
}
