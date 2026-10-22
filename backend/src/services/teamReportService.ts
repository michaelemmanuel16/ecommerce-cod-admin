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
 *  - timeToFirstCallMinutes: the KPI of services/kpi/timeToFirstCall.ts (median working minutes, orders assigned to the
 *    rep, auto-confirmed orders left out). null when no order was measured.
 *  - upsellRate: confirmed orders (placed in the range, confirmed by the rep) with at least one OrderItem of itemType
 *    'upsell', as a whole percent of the rep's confirmed orders. extraValue: the totalPrice of those upsell items on
 *    delivered orders (mockup: "Extra value on delivered"), a money string.
 *  - targetHit: delivered of the orders the rep confirmed (P7: confirmed orders that get delivered, the delivered count
 *    of deliveredFromConfirmedRate) against the `confirmed_delivered` Target whose period overlaps the range. A rep uses
 *    the person target. The All row uses the role target (the pool the person targets split). null when there is none.
 *  - confirmationPercent and deliveredFromConfirmedPercent: whole percents rounded once from the counts (wholeRate).
 */
import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { CONFIRMED, ratePercent, wholeRate } from './kpi/rates';
import { timeToFirstCall } from './kpi/timeToFirstCall';
import { repRates, RepRates } from './kpi/reps';

const NOT_REACHABLE = ['not_reachable', 'no_answer'];

/** The Target metric for P7. No earlier code names it; the Targets editor (M6) writes it. */
export const CONFIRMED_DELIVERED_METRIC = 'confirmed_delivered';

interface TargetHit { target: number; actual: number; percent: number | null }

/** The figures a rep row and the All row share. */
interface TeamFigures {
  calls: number;
  confirmed: number;
  notReachable: number;
  confirmationPercent: number | null;
  deliveredFromConfirmedPercent: number | null;
  timeToFirstCallMinutes: number | null;
  upsellRate: number | null;
  /** Money string, 2 decimals. */
  extraValue: string;
  targetHit: TargetHit | null;
}

interface TeamRepRow extends RepRates, TeamFigures {
  repId: number;
  name: string;
  /** 'ai_agent' for an AI agent that holds the call rep role, else 'person'. */
  kind: string;
}

interface TeamReport {
  from: string;
  to: string;
  asOf: string;
  tiles: {
    ordersConfirmed: number;
    callsMade: number;
    /** Calls made / orders confirmed, 2 decimals. Null when nothing is confirmed. */
    callsPerConfirmation: number | null;
    notReachable: { count: number; percentOfCalls: number | null };
    /** Orders declined in the range: the base of the decline percents. */
    totalDeclined: number;
    queue: { pending: number; oldestWaitMinutes: number | null; withoutRep: number };
  };
  reps: TeamRepRow[];
  all: RepRates & TeamFigures;
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
      select: { id: true, firstName: true, lastName: true, isActive: true, kind: true },
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

  // Confirmed orders that carry an upsell item (the only orders that can add to the upsell figures)
  const upsellOrders = await runInTenant(tenantId, () => prisma.order.findMany({
    where: { ...placed, status: { in: CONFIRMED }, orderItems: { some: { itemType: 'upsell' } } },
    select: { confirmedById: true, status: true, orderItems: { where: { itemType: 'upsell' }, select: { totalPrice: true } } },
  }));

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

  const base = (repId: number) => ({ calls: callsBy.get(repId) ?? 0, confirmed: confirmedBy.get(repId) ?? 0, notReachable: notReachableBy.get(repId) ?? 0 });
  // An inactive rep stays in the table only while the range holds activity for them.
  const kept = users
    .filter((u) => u.isActive || callsBy.has(u.id) || (confirmedBy.get(u.id) ?? 0) > 0 || rates.rep(u.id).confirmationRate.detail.placed > 0);

  const declined = declineGroups.reduce((a, g) => a + g._count._all, 0);

  // upsell figures: per confirming rep and over every order
  const upsellBy = new Map<number | 'all', { orders: number; extra: Money.Money }>();
  for (const o of upsellOrders) {
    const extra = o.status === 'delivered' ? Money.sum(o.orderItems.map((i) => i.totalPrice)) : Money.ZERO;
    for (const key of o.confirmedById === null ? (['all'] as const) : ([o.confirmedById, 'all'] as const)) {
      const cur = upsellBy.get(key) ?? { orders: 0, extra: Money.ZERO };
      upsellBy.set(key, { orders: cur.orders + 1, extra: Money.add(cur.extra, extra) });
    }
  }

  // time to first call (the KPI service, one run per rep and one for every order) and the confirmed-delivered targets
  const repIds = kept.map((u) => u.id);
  const overlaps = { metric: CONFIRMED_DELIVERED_METRIC, periodStart: { lt: to }, periodEnd: { gte: from } };
  const [firstCalls, allFirstCall, personTargets, roleTarget] = await Promise.all([
    Promise.all(repIds.map((repId) => timeToFirstCall(tenantId, from, to, { repId }))),
    timeToFirstCall(tenantId, from, to),
    runInTenant(tenantId, () => prisma.target.findMany({
      where: { ...overlaps, scope: 'person', userId: { in: repIds } },
      orderBy: { periodStart: 'desc' },
      select: { userId: true, value: true },
    })),
    runInTenant(tenantId, async () => {
      const held = await prisma.roleAssignment.findMany({ where: { holderId: { in: repIds } }, select: { roleId: true } });
      return prisma.target.findFirst({
        where: { ...overlaps, scope: 'role', roleId: { in: held.map((h) => h.roleId) } },
        orderBy: { periodStart: 'desc' },
        select: { value: true },
      });
    }),
  ]);
  const firstCallBy = new Map(repIds.map((id, i) => [id, firstCalls[i].value]));
  const personTargetBy = new Map<number, number>();
  for (const t of personTargets) if (t.userId !== null && !personTargetBy.has(t.userId)) personTargetBy.set(t.userId, t.value.toNumber());

  const figures = (key: number | 'all', rate: RepRates, base: { calls: number; confirmed: number; notReachable: number }, minutes: number | null, target: number | null): TeamFigures => {
    const up = upsellBy.get(key);
    const delivered = rate.deliveredFromConfirmedRate.detail.delivered ?? 0;
    return {
      ...base,
      confirmationPercent: wholeRate(rate.confirmationRate.detail.confirmed ?? 0, rate.confirmationRate.detail.placed ?? 0),
      deliveredFromConfirmedPercent: wholeRate(delivered, rate.deliveredFromConfirmedRate.detail.closed ?? 0),
      timeToFirstCallMinutes: minutes,
      upsellRate: wholeRate(up?.orders ?? 0, base.confirmed),
      extraValue: Money.toApi(up?.extra ?? Money.ZERO),
      targetHit: target === null ? null : { target, actual: delivered, percent: wholeRate(delivered, target) },
    };
  };

  const reps: TeamRepRow[] = kept.map((u) => ({
    repId: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    kind: u.kind,
    ...rates.rep(u.id),
    ...figures(u.id, rates.rep(u.id), base(u.id), firstCallBy.get(u.id) ?? null, personTargetBy.get(u.id) ?? null),
  }));
  const all = {
    ...rates.all,
    ...figures('all', rates.all, { calls: callsMade, confirmed: ordersConfirmed, notReachable }, allFirstCall.value, roleTarget ? roleTarget.value.toNumber() : null),
  };

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    asOf: asOf.toISOString(),
    tiles: {
      ordersConfirmed,
      callsMade,
      callsPerConfirmation: ordersConfirmed > 0 ? Money.roundHalfUp(Money.div(callsMade, ordersConfirmed), 2).toNumber() : null,
      notReachable: { count: notReachable, percentOfCalls: ratePercent(notReachable, callsMade) },
      totalDeclined: declined,
      queue: {
        pending,
        oldestWaitMinutes: oldest ? Math.floor((asOf.getTime() - oldest.createdAt.getTime()) / 60000) : null,
        withoutRep,
      },
    },
    reps,
    all,
    callOutcomes: [...outcomes.entries()].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
    declineReasons: declineGroups
      .map((g) => ({ reason: g.declineReason as string, count: g._count._all, percent: ratePercent(g._count._all, declined) }))
      .sort((a, b) => b.count - a.count),
  };
}
