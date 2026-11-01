import prisma, { type TransactionClient } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { Requester, isManagerUp } from '../utils/authUtils';
import { fullName } from '../utils/nameUtils';
import agingService from './agingService';
import { getRewardFeatures } from './tenantFeatures';
import { boardBase, rankRows, resolvePeriod, type Family } from './leaderboardService';
import { getStoreTimeZone, MONTH_RE } from './kpi/dates';
import {
  BADGES, LOCKED_BADGE, UNPAID_DAYS, beatTargetBy20, hitTargetStreak, topOfMonth, type BadgeKey, type MonthResult,
} from './leaderboardMath';
import type * as Money from '../utils/money';

/**
 * M6-T11 (F-1109): result badges. One store, `BadgeAward` (tenant, user, key, period): it feeds the leaderboard, the Rewards tab and
 * the apps. Badges come only from results, are written only by the month close (`awardMonthBadges`), and are never edited by hand.
 * No XP, levels or streak counters. Call inside the tenant context.
 *
 * A badge is a result, not a payout, so AI agents and companies can hold them (the PRD does not exclude them).
 */

const FAMILIES: Family[] = ['call_rep', 'delivery'];

/** The month before `period` ('2026-01' -> '2025-12'), `back` months back. */
const monthBefore = (period: string, back: number): string => {
  const d = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1 - back, 1));
  return d.toISOString().slice(0, 7);
};

type Db = Pick<TransactionClient, 'badgeAward'>;

/**
 * Give the badges a month earned: Top of month (rank 1 per role family, every tied first place), Hit target 3 months running,
 * Beat target by 20 percent, and, for delivery, Zero unpaid over 8 days. Safe to run twice: the unique key (tenant, user, key,
 * period) and `skipDuplicates` mean a badge is never awarded twice for one period. `db` is the client of the caller (the close
 * transaction): the numbers are read outside it, and the awards are counted and written through it, so the count sees the rows
 * of its own transaction. Returns how many awards were new.
 */
export async function awardMonthBadges(period: string, db: Db = prisma): Promise<{ awarded: number; byKey: Partial<Record<BadgeKey, number>> }> {
  if (!MONTH_RE.test(period)) throw new RangeError(`Period must be a month like 2026-10, got ${period}`);
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);
  const wanted: Array<{ userId: number; key: BadgeKey }> = [];

  for (const family of FAMILIES) {
    const rows = await boardBase(family, resolvePeriod(period, zone));
    if (!rows.length) continue;
    const ranks = rankRows(rows);
    const results: MonthResult[] = rows.map((r) => ({ userId: r.userId, rank: ranks.get(`${r.userId}:${r.roleId}`) ?? null, percent: r.percent }));
    for (const userId of topOfMonth(results)) wanted.push({ userId, key: 'top_of_month' });
    for (const r of rows) if (beatTargetBy20(r.percent)) wanted.push({ userId: r.userId, key: 'beat_target_20' });

    // Three months running: this month and the two before it, each read the same way.
    if (rows.some((r) => r.percent !== null && r.percent.gte(100))) {
      const earlier = await Promise.all([2, 1].map((back) => boardBase(family, resolvePeriod(monthBefore(period, back), zone))));
      for (const r of rows) {
        const previous = earlier.map((month) => month.find((x) => x.userId === r.userId && x.roleId === r.roleId)?.percent ?? null) as Array<Money.Money | null>;
        if (hitTargetStreak(r.percent, previous)) wanted.push({ userId: r.userId, key: 'hit_target_3_months' });
      }
    }

    if (family === 'delivery') {
      const delivering = rows.filter((r) => r.closed > 0);
      const late = new Set((await agingService.getUnpaidOrdersOf(delivering.map((r) => r.userId))).filter((o) => o.ageDays > UNPAID_DAYS).map((o) => o.agentId));
      for (const r of delivering) if (!late.has(r.userId)) wanted.push({ userId: r.userId, key: 'zero_unpaid_8_days' });
    }
  }

  const unique = [...new Map(wanted.map((w) => [`${w.userId}:${w.key}`, w])).values()];
  if (!unique.length) return { awarded: 0, byKey: {} };
  // createMany does not say which rows were new, so count them from the table around the insert.
  const before = await db.badgeAward.count({ where: { period } });
  await db.badgeAward.createMany({ data: unique.map((w) => ({ tenantId, userId: w.userId, key: w.key, period })), skipDuplicates: true });
  const after = await db.badgeAward.count({ where: { period } });
  const byKey: Partial<Record<BadgeKey, number>> = {};
  for (const w of unique) byKey[w.key] = (byKey[w.key] ?? 0) + 1;
  return { awarded: after - before, byKey };
}

/**
 * GET /api/badges. Every badge with its holders (user and month), or "Locked, no one yet". `period` limits to one month,
 * `userId` to one person; anyone who is not Owner, Admin or Manager sees their own only. With the badge display switched off
 * in the Rewards settings the list is empty and says so.
 */
export async function listBadges(actor: Requester, query: { userId?: number; period?: string }) {
  const seeAll = isManagerUp(actor);
  const userId = seeAll ? query.userId : actor.id;
  const features = await getRewardFeatures();
  if (features.badgesDisplay === false) return { display: false, badges: [] };

  const awards = await prisma.badgeAward.findMany({
    where: { ...(userId !== undefined && { userId }), ...(query.period && { period: query.period }) },
    orderBy: [{ period: 'desc' }, { id: 'asc' }],
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(awards.map((a) => a.userId))] } }, select: { id: true, firstName: true, lastName: true, kind: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.kind === 'person' ? fullName(u) : u.firstName]));
  const kindOf = new Map(users.map((u) => [u.id, u.kind]));

  return {
    display: true,
    badges: BADGES.map((b) => {
      const holders = awards.filter((a) => a.key === b.key && nameOf.has(a.userId)).map((a) => ({ userId: a.userId, name: nameOf.get(a.userId)!, kind: kindOf.get(a.userId)!, period: a.period }));
      return { key: b.key, label: b.label, description: b.description, holders, locked: holders.length === 0, ...(holders.length === 0 && { message: LOCKED_BADGE }) };
    }),
  };
}
