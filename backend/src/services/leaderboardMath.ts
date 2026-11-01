import * as Money from '../utils/money';
import { daysInMonth } from './kpi/dates';
import { displayPercent } from './rewardMath';
import { DAY_MS } from './kpi/dates';

/**
 * M6-T11 (F-1104, F-1105, F-1107, F-1109): the rules of the leaderboard and the badges. Pure functions, no database.
 */

/** Below this percent of its target a delivery company shows the contract review flag (F-1105). A flag, not a tier. */
export const CONTRACT_REVIEW_BELOW = 80;
export const CONTRACT_REVIEW = 'contract_review';
export const TOO_EARLY = 'Too early';
/** A day or a week with fewer order events than this carries a note that the numbers are early (F-1107). */
export const NEAR_EMPTY_BELOW = 5;
export const NEAR_EMPTY_NOTE = 'Early in this period: only a few orders so far, so the ranking can change a lot.';
export const NO_ACTIVITY_NOTE = 'No orders in this period yet.';

/** Days an unpaid delivered order may wait before it spoils the "Zero unpaid over 8 days" badge. */
export const UNPAID_DAYS = 8;

/** Percent of target of a row, one decimal cut down: what the screen shows, and what ties are judged on. */
export const rankPercent = (percent: Money.Money | null): number | null => (percent === null ? null : displayPercent(percent));

/**
 * Competition ranks by percent of the person's own target, highest first: a tie shares a rank and the next rank skips
 * (1, 1, 3). `null` percent is not ranked. Returns the rank per id, in input order of the ranked ones; unranked ids map to null.
 */
export function rankByPercent<K>(items: ReadonlyArray<{ id: K; percent: number | null }>): Map<K, number | null> {
  const ranked = items.filter((i): i is { id: K; percent: number } => i.percent !== null).sort((a, b) => b.percent - a.percent);
  const ranks = new Map<K, number | null>(items.map((i) => [i.id, null]));
  ranked.forEach((item, index) => {
    ranks.set(item.id, index > 0 && ranked[index - 1].percent === item.percent ? ranks.get(ranked[index - 1].id)! : index + 1);
  });
  return ranks;
}

/** The days of a window as local 'YYYY-MM-DD' counted per month ('YYYY-MM'). `last` is inclusive. */
export function daysByMonth(first: string, last: string): Map<string, number> {
  const start = Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, +first.slice(8, 10));
  const end = Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 1, +last.slice(8, 10));
  const counts = new Map<string, number>();
  for (let t = start; t <= end; t += DAY_MS) {
    const month = new Date(t).toISOString().slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return counts;
}

/**
 * The target of a window from the monthly targets of a person (straight days, as month and quarter pace). A count target is
 * the share of each month the window covers: a week is 7 days of the month target over its days; a year is the sum of its
 * months. A rate target (success percent) does not scale: it is the average of the months, weighted by the days the window
 * has in each. A month with no target adds nothing. Null when no month of the window has a target.
 */
export function windowTarget(basis: 'count' | 'rate', monthTargets: ReadonlyMap<string, Money.MoneyInput>, days: ReadonlyMap<string, number>): Money.Money | null {
  let total = Money.ZERO;
  let covered = 0;
  for (const [month, count] of days) {
    const value = monthTargets.get(month);
    if (value === undefined) continue;
    const dim = daysInMonth(+month.slice(0, 4), +month.slice(5, 7));
    covered += count;
    total = Money.add(total, basis === 'count' ? Money.div(Money.mul(value, count), dim) : Money.mul(value, count));
  }
  if (covered === 0) return null;
  return basis === 'count' ? total : Money.div(total, covered);
}

/** Average days between delivery and payment, one decimal; null when nothing is paid. Negative gaps count as 0. */
export function averageDaysToPay(gapsMs: readonly number[]): number | null {
  if (gapsMs.length === 0) return null;
  const days = gapsMs.map((g) => Math.max(g, 0) / DAY_MS);
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10;
}

/** The note of a day or week with little data; null for a month or year, or when there is enough. */
export function periodNote(kind: 'today' | 'week' | 'month' | 'year', events: number): string | null {
  if (kind === 'month' || kind === 'year') return null;
  if (events === 0) return NO_ACTIVITY_NOTE;
  return events < NEAR_EMPTY_BELOW ? NEAR_EMPTY_NOTE : null;
}

/** A company (3PL) under the contract review line of its target, on a month or year; never a payout. */
export const contractReviewFlag = (kind: string, percent: number | null): typeof CONTRACT_REVIEW | null =>
  kind === 'company' && percent !== null && percent < CONTRACT_REVIEW_BELOW ? CONTRACT_REVIEW : null;

// ---- Badges (F-1109) -------------------------------------------------------------------------------------------------

export const BADGES = [
  { key: 'top_of_month', label: 'Top of month', description: 'Rank 1 at month close' },
  { key: 'hit_target_3_months', label: 'Hit target 3 months running', description: '100 percent of target or more, three months in a row' },
  { key: 'beat_target_20', label: 'Beat target by 20 percent', description: '120 percent of target or more in the month' },
  { key: 'zero_unpaid_8_days', label: 'Zero unpaid over 8 days', description: 'No delivered order unpaid for more than 8 days' },
] as const;
export type BadgeKey = typeof BADGES[number]['key'];
export const LOCKED_BADGE = 'Locked, no one yet';

/** One person's month, as the badge rules read it. `percent` is exact percent of target, null with no target. */
export interface MonthResult { userId: number; rank: number | null; percent: Money.Money | null }

/** Rank 1 with some result: every tied first place gets it. A person at 0 percent is not the top of anything. */
export const topOfMonth = (rows: readonly MonthResult[]): number[] =>
  rows.filter((r) => r.rank === 1 && r.percent !== null && r.percent.gt(0)).map((r) => r.userId);

/** 100 percent or more in this month and in each of the two before it (`previous`: percent per earlier month, oldest first). */
export function hitTargetStreak(current: Money.Money | null, previous: ReadonlyArray<Money.Money | null>): boolean {
  return previous.length >= 2 && [current, ...previous.slice(-2)].every((p) => p !== null && p.gte(100));
}

/** 120 percent or more of the person's own target. */
export const beatTargetBy20 = (percent: Money.Money | null): boolean => percent !== null && percent.gte(120);
