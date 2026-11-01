import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { Requester, isManagerUp } from '../utils/authUtils';
import { getCurrency } from '../utils/currency';
import { fullName } from '../utils/nameUtils';
import * as Money from '../utils/money';
import { deliveredByRep, outcomesByPartner } from './kpi/rates';
import { repRates } from './kpi/reps';
import {
  MONTH_RE, endOfDay, getStoreTimeZone, localDate, monthRange, shiftYmd, startOfDay, utcDateOfYmd, weekRange,
} from './kpi/dates';
import { NO_DATA_FOR_METRIC, SET_A_TARGET, isMonthClosed, monthPersonTargets } from './targetService';
import { basisOf, distanceTo, measure, type Measure } from './rewardService';
import { getRewardFeatures } from './tenantFeatures';
import { NO_PAYOUT, displayPercent, nextTier, rewardMessage, tierReached, type Tier } from './rewardMath';
import {
  TOO_EARLY, averageDaysToPay, contractReviewFlag, daysByMonth, periodNote, rankByPercent, windowTarget,
} from './leaderboardMath';
import type { MeasureBasis } from '../config/targetMetrics';

/**
 * M6-T11 (F-1104, F-1105, F-1107): the leaderboard of the call reps and of the delivery role, for a day, a week, a month or a
 * year. Call inside the tenant context.
 *
 * Rank is by percent of the person's own target (never by raw count), highest first; a tie shares a rank (1, 1, 3). The target of
 * a window comes from the person's monthly targets, by straight days (a week is 7 days of the month target; a year is the sum
 * of its months; a success-rate target stays the same rate). No target: listed, not ranked. A delivery holder with no closed
 * orders in the window reads "Too early" and is not ranked. AI agents rank under the role they hold; companies are listed, and
 * only people can be paid. The numbers are the T09 ones: call rep = confirmed orders that got delivered (by delivery date),
 * delivery = success rate on closed orders only.
 *
 * Tiers, distance to the next tier, the contract review flag and badges show for a month or a year only (F-1107).
 */

export type Family = 'call_rep' | 'delivery';
const PRESET: Record<Family, UserRole> = { call_rep: 'sales_rep', delivery: 'delivery_agent' };

export type PeriodKind = 'today' | 'week' | 'month' | 'year';
export interface PeriodSpec { key: string; kind: PeriodKind; label: string; first: string; last: string; from: Date; to: Date; month: string | null }

const monthName = (year: number, month: number, withYear: boolean) =>
  new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-GB', { month: 'long', ...(withYear && { year: 'numeric' }), timeZone: 'UTC' });

/** today | week | month | year | YYYY-MM, in the store's time zone. "month" is the current month, "year" the current year. */
export function resolvePeriod(input: string, zone: string, now: Date = new Date()): PeriodSpec {
  const today = localDate(now, zone);
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const monthSpec = (y: number, m: number, withYear: boolean): PeriodSpec => {
    const { from, to } = monthRange(y, m, zone);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    return {
      key, kind: 'month', label: monthName(y, m, withYear), month: key, from, to,
      first: `${key}-01`, last: shiftYmd(`${y}-${String(m).padStart(2, '0')}-01`, new Date(Date.UTC(y, m, 0)).getUTCDate() - 1),
    };
  };
  if (input === 'today') return { key: 'today', kind: 'today', label: 'Today', first: today, last: today, from: startOfDay(today, zone), to: endOfDay(today, zone), month: null };
  if (input === 'week') {
    const w = weekRange(today, zone);
    return { key: 'week', kind: 'week', label: 'This week', first: w.monday, last: w.sunday, from: w.from, to: w.to, month: null };
  }
  if (input === 'month') return monthSpec(year, month, false);
  if (input === 'year') {
    return { key: 'year', kind: 'year', label: String(year), first: `${year}-01-01`, last: `${year}-12-31`, from: monthRange(year, 1, zone).from, to: monthRange(year, 12, zone).to, month: null };
  }
  const m = MONTH_RE.exec(input);
  if (!m) throw new AppError('Period must be today, week, month, year or a month like 2026-10', 400, 'INVALID_PERIOD');
  return monthSpec(Number(m[1]), Number(m[2]), true);
}

interface Pair { userId: number; roleId: number }
const pairKey = (p: Pair) => `${p.userId}:${p.roleId}`;

/** One row before ranking and the extras: everything the number side gives. */
interface Base {
  userId: number; name: string; kind: string; roleId: number; roleName: string;
  basis: MeasureBasis | null; target: Money.Money | null; m: Measure | null;
  delivered: number; closed: number;
  confirmed: number | null; confirmationRate: number | null; deliveredFromConfirmed: number | null; confirmedClosed: number | null;
  daysToPay: number | null;
  tooEarly: boolean;
  percent: Money.Money | null;
  /** The reason a row is not ranked, if it is not. */
  reason: string | null;
}

/** Average days from delivery to cash for the delivered orders of each partner in the window; a partner with none paid is absent. */
async function daysToPayOf(partnerIds: number[], from: Date, to: Date): Promise<Map<number, number>> {
  if (!partnerIds.length) return new Map();
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null, status: 'delivered', deliveryAgentId: { in: partnerIds }, deliveryDate: { gte: from, lt: to },
      agentCollection: { status: { in: ['deposited', 'reconciled'] } },
    },
    select: {
      deliveryAgentId: true, deliveryDate: true,
      agentCollection: { select: { approvedAt: true, verifiedAt: true, updatedAt: true, settlementLine: { select: { settlement: { select: { payoutDate: true } } } } } },
    },
  });
  const gaps = new Map<number, number[]>();
  for (const o of orders) {
    const c = o.agentCollection;
    if (!c || !o.deliveryDate || o.deliveryAgentId === null) continue;
    const paidAt = c.settlementLine?.settlement.payoutDate ?? c.approvedAt ?? c.verifiedAt ?? c.updatedAt;
    gaps.set(o.deliveryAgentId, [...(gaps.get(o.deliveryAgentId) ?? []), paidAt.getTime() - o.deliveryDate.getTime()]);
  }
  return new Map([...gaps].map(([id, g]) => [id, averageDaysToPay(g)!]));
}

/**
 * The numbers of one family for a window, one entry per person and role, unranked. The one read behind the leaderboard and the
 * badges. A past or running window both work; nothing here depends on today.
 */
export async function boardBase(family: Family, spec: PeriodSpec): Promise<Base[]> {
  const tenantId = resolveTenantId();
  const preset = PRESET[family];
  const roles = await prisma.role.findMany({ where: { presetRole: preset, isSystem: false }, select: { id: true, name: true } });
  if (!roles.length) return [];
  const roleIds = roles.map((r) => r.id);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const days = daysByMonth(spec.first, spec.last);
  const months = [...days.keys()];

  const [perMonth, holders] = await Promise.all([
    Promise.all(months.map(async (month) => [month, await monthPersonTargets(month)] as const)),
    prisma.roleAssignment.findMany({
      where: { roleId: { in: roleIds }, fromDate: { lte: utcDateOfYmd(spec.last) }, OR: [{ toDate: null }, { toDate: { gte: utcDateOfYmd(spec.first) } }] },
      select: { holderId: true, roleId: true },
    }),
  ]);

  // Targets of the people: value per month, and the metric of the latest month that has one.
  const targets = new Map<string, { metric: string; byMonth: Map<string, Money.Money> }>();
  const pairs = new Map<string, Pair>();
  for (const [month, rows] of perMonth) {
    for (const t of rows) {
      if (!roleIds.includes(t.roleId!)) continue;
      const pair = { userId: t.userId!, roleId: t.roleId! };
      pairs.set(pairKey(pair), pair);
      const cur = targets.get(pairKey(pair)) ?? { metric: t.metric, byMonth: new Map<string, Money.Money>() };
      cur.metric = t.metric;
      cur.byMonth.set(month, Money.parse(t.value));
      targets.set(pairKey(pair), cur);
    }
  }
  for (const h of holders) pairs.set(pairKey({ userId: h.holderId, roleId: h.roleId }), { userId: h.holderId, roleId: h.roleId });
  const list = [...pairs.values()];
  if (!list.length) return [];

  const userIds = [...new Set(list.map((p) => p.userId))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, kind: true } });
  const userById = new Map(users.map((u) => [u.id, u]));
  const activeIds = userIds.filter((id) => userById.has(id));

  const [deliveredBy, reps, outcomeBy, daysBy] = family === 'call_rep'
    ? await Promise.all([deliveredByRep(tenantId, spec.from, spec.to, activeIds), repRates(tenantId, spec.from, spec.to), null, null] as const)
    : await Promise.all([null, null, outcomesByPartner(tenantId, spec.from, spec.to, activeIds), daysToPayOf(activeIds, spec.from, spec.to)] as const);

  const out: Base[] = [];
  for (const pair of list) {
    const user = userById.get(pair.userId);
    if (!user) continue; // deactivated or deleted: not on the board
    const t = targets.get(pairKey(pair)) ?? null;
    const basis: MeasureBasis | null = t ? basisOf(t.metric, preset) : (family === 'call_rep' ? 'count' : 'rate');
    const target = t && basis ? windowTarget(basis, t.byMonth, days) : null;
    const base: Base = {
      userId: user.id, name: user.kind === 'person' ? fullName(user) : user.firstName, kind: user.kind, roleId: pair.roleId, roleName: roleName.get(pair.roleId)!,
      basis, target, m: null, delivered: 0, closed: 0,
      confirmed: null, confirmationRate: null, deliveredFromConfirmed: null, confirmedClosed: null, daysToPay: null,
      tooEarly: false, percent: null, reason: null,
    };
    if (family === 'call_rep') {
      const rr = reps!.rep(user.id);
      base.delivered = deliveredBy!.get(user.id) ?? 0;
      base.confirmed = rr.confirmationRate.detail.confirmed;
      base.confirmationRate = rr.confirmationRate.value;
      base.deliveredFromConfirmed = rr.deliveredFromConfirmedRate.value;
      base.confirmedClosed = rr.deliveredFromConfirmedRate.detail.closed;
    } else {
      const o = outcomeBy!.get(user.id);
      base.delivered = o?.delivered ?? 0;
      base.closed = o ? o.delivered + o.failed + o.returned : 0;
      base.daysToPay = daysBy!.get(user.id) ?? null;
      base.tooEarly = base.closed === 0;
    }
    if (!t || !target) base.reason = SET_A_TARGET;
    else if (!basis) base.reason = NO_DATA_FOR_METRIC;
    else {
      base.m = measure(basis, target, family === 'call_rep' ? base.delivered : 0, family === 'delivery' ? outcomeBy!.get(user.id) : undefined);
      base.percent = base.m.percent;
      if (base.tooEarly) { base.reason = TOO_EARLY; base.percent = null; }
    }
    out.push(base);
  }
  return out;
}

/** The ranks of a family's rows: by percent of own target as the screen shows it (one decimal). */
export function rankRows(rows: ReadonlyArray<{ userId: number; roleId: number; percent: Money.Money | null }>): Map<string, number | null> {
  return rankByPercent(rows.map((r) => ({ id: `${r.userId}:${r.roleId}`, percent: r.percent === null ? null : displayPercent(r.percent) })));
}

type TierRow = { amount: Money.Money; dayOff: boolean; payout: boolean };

/**
 * GET /api/leaderboard. `role`: call_rep or delivery. `period`: today, week, month (default), year, or YYYY-MM. The Owner,
 * Admin and Manager see every row; anyone else sees their own row only, with their rank among everyone.
 */
export async function leaderboard(actor: Requester, query: { role: Family; period?: string }) {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);
  const spec = resolvePeriod(query.period ?? 'month', zone);
  const withRewards = spec.kind === 'month' || spec.kind === 'year';

  const [base, currency, features] = await Promise.all([boardBase(query.role, spec), getCurrency(), getRewardFeatures()]);
  const ranks = rankRows(base);
  const roleIds = [...new Set(base.map((b) => b.roleId))];

  const [tierRows, badgeRows, closed] = withRewards
    ? await Promise.all([
      prisma.rewardTier.findMany({ where: { roleId: { in: roleIds } } }),
      features.badgesDisplay === false || !base.length
        ? []
        : prisma.badgeAward.findMany({
          where: { userId: { in: base.map((b) => b.userId) }, period: spec.month ? spec.month : { startsWith: `${spec.first.slice(0, 4)}-` } },
          select: { userId: true, key: true, period: true }, orderBy: [{ period: 'asc' }, { id: 'asc' }],
        }),
      spec.month ? isMonthClosed(spec.month) : false,
    ])
    : [[], [], false];
  const tiersOf = new Map<number, Partial<Record<Tier, TierRow>>>();
  for (const t of tierRows) tiersOf.set(t.roleId, { ...tiersOf.get(t.roleId), [t.threshold as Tier]: { amount: Money.parse(t.amount), dayOff: t.dayOff, payout: t.payout } });
  const money = (v: Money.MoneyInput) => Money.formatWithSign(v, currency);

  const rows = base.map((b) => {
    const rank = ranks.get(`${b.userId}:${b.roleId}`) ?? null;
    const percent = b.percent === null ? null : displayPercent(b.percent);
    const human = b.kind === 'person';
    const row: Record<string, unknown> = {
      rank, userId: b.userId, name: b.name, kind: b.kind, roleId: b.roleId, roleName: b.roleName, payout: human,
      ranked: rank !== null, reason: b.reason,
      target: b.target ? Money.toApi(b.target) : null,
      actual: b.m?.actual ?? (query.role === 'call_rep' ? b.delivered : null),
      percent,
      ...(query.role === 'call_rep'
        ? { confirmed: b.confirmed, confirmationRate: b.confirmationRate, deliveredFromConfirmed: b.deliveredFromConfirmed, confirmedClosed: b.confirmedClosed, delivered: b.delivered }
        : { success: b.closed > 0 ? b.m?.actual ?? null : null, daysToPay: b.daysToPay, delivered: b.delivered, closed: b.closed }),
    };
    if (!withRewards) return row;

    // Month and year: tier, distance, flag, badges (F-1107)
    const tier = tierReached(b.percent);
    const tiers = tiersOf.get(b.roleId) ?? {};
    const shown = { tier: tier === null ? 'none' : String(tier) };
    const flag = contractReviewFlag(b.kind, percent);
    const flagFields = flag && !b.tooEarly ? { flag, flagText: 'Contract review' } : { flag: null };
    const badges = badgeRows.filter((x) => x.userId === b.userId).map((x) => ({ key: x.key, period: x.period }));
    if (!human || b.percent === null || !b.m || !b.basis) {
      return {
        ...row, ...shown, ...flagFields, badges, reward: null, earned: false, distance: null,
        message: !b.m ? (b.reason ?? '') : rewardMessage({ tier, reward: null, distance: null, closed, human, percent }),
      };
    }
    const next = nextTier(tier);
    const nextRow = next === null ? undefined : tiers[next];
    const distance = distanceTo(b.basis, tier, b.m, b.target!, nextRow ? money(nextRow.amount) : null);
    const paid = tier === null ? undefined : tiers[tier];
    const reward = paid && paid.payout ? { amount: Money.toApi(paid.amount), dayOff: paid.dayOff } : null;
    return {
      ...row, ...shown, ...flagFields, badges, reward, distance, earned: closed && reward !== null,
      message: rewardMessage({ tier, reward: reward && { ...reward, amount: money(reward.amount) }, distance: distance?.message ?? null, closed, human, percent }),
    };
  });

  const ordered = rows.sort((a, b) => {
    const [ra, rb] = [a.rank as number | null, b.rank as number | null];
    if (ra !== rb) return ra === null ? 1 : rb === null ? -1 : ra - rb;
    return String(a.name).localeCompare(String(b.name));
  });
  const events = base.reduce((sum, b) => sum + b.delivered + b.closed + (b.confirmed ?? 0), 0);
  const seeAll = isManagerUp(actor);
  const tierCard = withRewards
    ? roleIds.map((id) => ({ roleId: id, roleName: base.find((b) => b.roleId === id)!.roleName, tier100: tierView(tiersOf.get(id)?.[100]), tier120: tierView(tiersOf.get(id)?.[120]) }))
    : null;

  return {
    role: query.role,
    period: { key: spec.key, kind: spec.kind, label: spec.label, from: spec.first, to: spec.last, closed },
    note: periodNote(spec.kind, events),
    currency,
    rewards: tierCard && { tiers: tierCard, noPayout: ['ai_agent', 'company'], message: NO_PAYOUT },
    rows: seeAll ? ordered : ordered.filter((r) => r.userId === actor.id),
  };
}

const tierView = (t: TierRow | undefined) => (t ? { amount: Money.toApi(t.amount), dayOff: t.dayOff, payout: t.payout } : null);


// ---- Top this month (dashboard, F-208) ----------------------------------------------------------------------------------

export interface TopPerson {
  rank: number;
  userId: number;
  name: string;
  kind: string;
  roleName: string;
  family: Family;
  /** Percent of the person's own target, one decimal. */
  percent: number;
  /** The role's own number: delivery success percent, or confirmed orders that got delivered. */
  main: { unit: 'delivery_success' | 'confirmed_delivered'; value: number };
}

/**
 * The top people of a month by percent of their own role target, across both roles (F-208): call reps and the Delivery role,
 * persons, AI agents (under the role they hold) and companies. Fewer than `limit` when fewer have a target; none when nobody has.
 * Not ranked people (no target, too early) never appear. A tie on percent goes to the person with more closed orders (a call
 * rep's closed orders are the orders they confirmed that were delivered), then to the name, so the order is always the same.
 * Reuses `boardBase`, the numbers of the Leaderboard page. Call inside the tenant context.
 */
export async function topThisMonth(month: string, limit = 3): Promise<TopPerson[]> {
  const zone = getStoreTimeZone(resolveTenantId());
  const spec = resolvePeriod(month, zone);
  const families: Family[] = ['call_rep', 'delivery'];
  const boards = await Promise.all(families.map(async (family) => ({ family, rows: await boardBase(family, spec) })));
  const people = boards.flatMap(({ family, rows }) => rows
    .filter((b) => b.percent !== null && b.m !== null)
    .map((b) => ({
      family, b, percent: displayPercent(b.percent!),
      volume: family === 'delivery' ? b.closed : b.delivered,
    })));
  people.sort((x, y) => y.percent - x.percent || y.volume - x.volume || x.b.name.localeCompare(y.b.name));
  return people.slice(0, limit).map(({ family, b, percent }, i) => ({
    rank: i + 1, userId: b.userId, name: b.name, kind: b.kind, roleName: b.roleName, family, percent,
    main: family === 'delivery' ? { unit: 'delivery_success' as const, value: b.m!.actual } : { unit: 'confirmed_delivered' as const, value: b.delivered },
  }));
}
