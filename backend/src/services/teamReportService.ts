/**
 * Team performance report (M1-T18, F-1054): tiles, call rep table and decline reasons for `GET /api/reports/team`.
 * Rates come from services/kpi/reps.ts; this file only counts calls and orders and lays the numbers out.
 *
 * Counts:
 *  - confirmed (rep row, activity): orders the rep confirmed (Order.confirmedById), placed in the range.
 *  - calls: Call rows created in the range, by Call.salesRepId.
 *  - notReachable: calls with outcome not_reachable or no_answer (no_answer is the old value for the same thing).
 *  - declineReasons: Order.declineReason on orders placed in the range; percent of all declined orders.
 *  - queue: orders waiting for a call right now (pending_confirmation), not tied to the range.
 */
import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { CONFIRMED, ratePercent } from './kpi/rates';
import { repRates, RepRates } from './kpi/reps';

const NOT_REACHABLE = ['not_reachable', 'no_answer'];

export interface TeamRepRow extends RepRates {
  repId: number;
  name: string;
  calls: number;
  confirmed: number;
  notReachable: number;
}

export interface TeamReport {
  from: string;
  to: string;
  asOf: string;
  tiles: {
    ordersConfirmed: number;
    callsMade: number;
    /** Calls made / orders confirmed, 2 decimals. Null when nothing is confirmed. */
    callsPerConfirmation: number | null;
    notReachable: { count: number; percentOfCalls: number | null };
    queue: { pending: number; oldestWaitMinutes: number | null; withoutRep: number };
  };
  reps: TeamRepRow[];
  all: RepRates & { calls: number; confirmed: number; notReachable: number };
  callOutcomes: Array<{ outcome: string; count: number }>;
  declineReasons: Array<{ reason: string; count: number; percent: number | null }>;
}

export async function teamReport(tenantId: string, from: Date, to: Date): Promise<TeamReport> {
  const asOf = new Date();
  const placed = { deletedAt: null, createdAt: { gte: from, lt: to } };

  const [rates, users, callGroups, confirmedGroups, declineGroups, pending, oldest, withoutRep] = await Promise.all([
    repRates(tenantId, from, to),
    runInTenant(tenantId, () => prisma.user.findMany({
      where: { role: 'sales_rep' },
      select: { id: true, firstName: true, lastName: true, isActive: true },
      orderBy: { id: 'asc' },
    })),
    runInTenant(tenantId, () => prisma.call.groupBy({
      by: ['salesRepId', 'outcome'],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    })),
    runInTenant(tenantId, () => prisma.order.groupBy({
      by: ['confirmedById'],
      where: { ...placed, status: { in: CONFIRMED } },
      _count: { _all: true },
    })),
    runInTenant(tenantId, () => prisma.order.groupBy({
      by: ['declineReason'],
      where: { ...placed, declineReason: { not: null } },
      _count: { _all: true },
    })),
    runInTenant(tenantId, () => prisma.order.count({ where: { deletedAt: null, status: 'pending_confirmation' } })),
    runInTenant(tenantId, () => prisma.order.findFirst({
      where: { deletedAt: null, status: 'pending_confirmation' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })),
    runInTenant(tenantId, () => prisma.order.count({
      where: { deletedAt: null, status: 'pending_confirmation', customerRepId: null },
    })),
  ]);

  const bump = <K>(map: Map<K, number>, key: K, n: number) => map.set(key, (map.get(key) ?? 0) + n);
  const callsBy = new Map<number, number>();
  const notReachableBy = new Map<number, number>();
  const outcomes = new Map<string, number>();
  for (const g of callGroups) {
    const n = g._count._all;
    bump(callsBy, g.salesRepId, n);
    if (NOT_REACHABLE.includes(g.outcome)) bump(notReachableBy, g.salesRepId, n);
    bump(outcomes, g.outcome, n);
  }
  const confirmedBy = new Map<number, number>();
  for (const g of confirmedGroups) if (g.confirmedById !== null) confirmedBy.set(g.confirmedById, g._count._all);

  const callsMade = [...callsBy.values()].reduce((a, b) => a + b, 0);
  const notReachable = [...notReachableBy.values()].reduce((a, b) => a + b, 0);
  const ordersConfirmed = rates.all.confirmationRate.detail.confirmed;

  // An inactive rep stays in the table only while the range holds activity for them.
  const reps: TeamRepRow[] = users
    .filter((u) => u.isActive || callsBy.has(u.id) || (confirmedBy.get(u.id) ?? 0) > 0 || rates.rep(u.id).confirmationRate.detail.placed > 0)
    .map((u) => ({
      repId: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      ...rates.rep(u.id),
      calls: callsBy.get(u.id) ?? 0,
      confirmed: confirmedBy.get(u.id) ?? 0,
      notReachable: notReachableBy.get(u.id) ?? 0,
    }));

  const declined = declineGroups.reduce((a, g) => a + g._count._all, 0);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    asOf: asOf.toISOString(),
    tiles: {
      ordersConfirmed,
      callsMade,
      callsPerConfirmation: ordersConfirmed > 0 ? Money.roundHalfUp(Money.div(callsMade, ordersConfirmed), 2).toNumber() : null,
      notReachable: { count: notReachable, percentOfCalls: ratePercent(notReachable, callsMade) },
      queue: {
        pending,
        oldestWaitMinutes: oldest ? Math.floor((asOf.getTime() - oldest.createdAt.getTime()) / 60000) : null,
        withoutRep,
      },
    },
    reps,
    all: { ...rates.all, calls: callsMade, confirmed: ordersConfirmed, notReachable },
    callOutcomes: [...outcomes.entries()].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
    declineReasons: declineGroups
      .map((g) => ({ reason: g.declineReason as string, count: g._count._all, percent: ratePercent(g._count._all, declined) }))
      .sort((a, b) => b.count - a.count),
  };
}
