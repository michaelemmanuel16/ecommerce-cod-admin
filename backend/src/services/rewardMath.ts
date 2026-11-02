import * as Money from '../utils/money';

/**
 * M6-T09 (F-1108, F-1110): the tier, distance and message rules of rewards. Pure functions, no database. Percent of target
 * is actual / target x 100, exact (never rounded before the tier is picked: 99.96 is not 100).
 */

/** A cash tier: the percent of target it starts at. */
export type Tier = 100 | 120;
export const TIERS: readonly Tier[] = [100, 120];

const TOP_TIER = 'Top tier reached';
export const NO_PAYOUT = 'No payout';

/** Percent of target, exact. Null when there is no positive target. */
export function attainmentPercent(actual: Money.MoneyInput, target: Money.MoneyInput): Money.Money | null {
  const t = Money.parse(target);
  return t.gt(0) ? Money.div(Money.mul(actual, 100), t) : null;
}

/** The highest tier a percent earns: 120 or more earns the 120 tier, 100 or more the 100 tier, anything less none. */
export function tierReached(percent: Money.MoneyInput | null): Tier | null {
  if (percent === null) return null;
  const p = Money.parse(percent);
  if (p.gte(120)) return 120;
  if (p.gte(100)) return 100;
  return null;
}

/** The tier after the one reached (the first tier for none); null at the top. */
export const nextTier = (reached: Tier | null): Tier | null => (reached === null ? 100 : reached === 100 ? 120 : null);

/** One decimal, cut down not rounded, so a screen never shows 100.0 for 99.96. */
export const displayPercent = (percent: Money.MoneyInput): number => Money.parse(percent).toDecimalPlaces(1, 1 /* ROUND_DOWN */).toNumber();

/** Orders still to count for a count target: how many more to reach 100 percent and 120 percent of it. */
export function countDistance(actual: number, target: Money.MoneyInput): Record<Tier, number> {
  const t = Money.parse(target);
  const more = (threshold: Money.Money) => Math.max(0, threshold.ceil().toNumber() - actual);
  return { 100: more(t), 120: more(Money.mul(t, '1.2')) };
}

/**
 * Deliveries with no failure still needed so that delivered / closed reaches `targetPct` x tier (a tier of 120 on a 60
 * percent target needs 72 percent). Zero when already there. Null when the rate cannot get there (it would need 100
 * percent or more while a failure is on record, or more than 100 percent).
 */
export function rateDistance(delivered: number, closed: number, targetPct: Money.MoneyInput, tier: Tier): number | null {
  const needed = Money.div(Money.mul(targetPct, tier), 100); // the success rate to reach, in percent
  if (closed > 0 && Money.mul(delivered, 100).gte(Money.mul(needed, closed))) return 0;
  if (needed.gt(100)) return null;
  // Nothing closed yet: one delivery with no failure is 100 percent. With a failure on record, 100 percent is out of reach.
  if (needed.eq(100)) return closed === 0 ? 1 : null;
  // (delivered + x) / (closed + x) >= needed / 100  =>  x >= (needed x closed - 100 x delivered) / (100 - needed)
  const x = Money.div(Money.sub(Money.mul(needed, closed), Money.mul(delivered, 100)), Money.sub(100, needed));
  return Math.max(1, x.ceil().toNumber());
}

interface RewardMessageInput {
  tier: Tier | null;
  /** The reward text parts the tier pays, already in the store currency ("GH₵500"); null when this tier pays nothing. */
  reward: { amount: string; dayOff: boolean } | null;
  /** The "N more ... to reach X%" line of the next tier, if there is one. */
  distance: string | null;
  closed: boolean;
  human: boolean;
  /** The percent shown on the row. */
  percent: number | null;
}

/** The one line a row shows (F-1108, F-1110). Nothing is paid before month close, so an open month says "On track". */
export function rewardMessage({ tier, reward, distance, closed, human, percent }: RewardMessageInput): string {
  if (!human) return `${NO_PAYOUT}. Attainment ${percent ?? 0}%`;
  if (tier === null) return distance ?? 'No tier reached yet';
  const top = tier === 120 ? `${TOP_TIER}. ` : '';
  if (!reward) return tier === 120 ? TOP_TIER : `${tier}% reached`;
  const verb = closed ? 'Earned' : 'On track to earn';
  const dayOff = reward.dayOff ? ' and a paid day off' : '';
  return `${top}${verb} ${reward.amount}${dayOff}${closed ? '' : ' at month close'}`;
}
