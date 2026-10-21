/**
 * Status tags for the Dashboard (M3-T09, F-202, F-204). Pure functions: the Dashboard endpoint returns the tag key and
 * the frontend only picks a word and a colour for it.
 *
 *  - progressTag: progress against the pace marker of a period. 'on_track' at or above the pace, 'behind' when under it
 *    by less than 3 points, 'off_track' by 3 points or more. 'hit' once the period target is reached.
 *    The 3-point split is inferred from the mockup (quarter 1.5 under = behind; month 3.8 under = off track), owner confirms at G1.
 *  - rateTag: a rate against its target, same split. 'no_data' when the rate is null (nothing closed yet).
 *  - paceChip: points ahead or behind the pace, rounded to a whole point ("3 pts behind").
 *  - questTone: the bar colour of a daily quest: green at or above target, gold 50 to 99 percent, coral under 50.
 */
import { ratePercent } from './rates';

/** Under the pace by this many points or more, a period is off track. */
export const OFF_TRACK_POINTS = 3;

export type ProgressTag = 'hit' | 'on_track' | 'behind' | 'off_track' | 'no_target';
export type RateTag = 'on_track' | 'behind' | 'off_track' | 'no_data';
export type Tone = 'ok' | 'warn' | 'bad';

/** Points a value is under a reference (0 when at or above it), to 1 decimal so 54.8 - 51.8 is 3, not 2.9999999999999964. */
const under = (value: number, reference: number) => Math.max(Math.round((reference - value) * 10) / 10, 0);

export function progressTag(percent: number | null, pace: number): ProgressTag {
  if (percent === null) return 'no_target';
  if (percent >= 100) return 'hit';
  const gap = under(percent, pace);
  if (gap === 0) return 'on_track';
  return gap < OFF_TRACK_POINTS ? 'behind' : 'off_track';
}

export function rateTag(value: number | null, target: number): RateTag {
  if (value === null) return 'no_data';
  const gap = under(value, target);
  if (gap === 0) return 'on_track';
  return gap < OFF_TRACK_POINTS ? 'behind' : 'off_track';
}

export interface PaceChip {
  /** Whole points between progress and pace, always >= 0. */
  points: number;
  tag: 'ahead' | 'behind' | 'on_pace';
}

/** "<N> pts behind the year's pace": N = pace minus progress, rounded. Null when there is no target. */
export function paceChip(percent: number | null, pace: number): PaceChip | null {
  if (percent === null) return null;
  const points = Math.round(Math.abs(Math.round((percent - pace) * 10) / 10));
  if (points === 0) return { points, tag: 'on_pace' };
  return { points, tag: percent >= pace ? 'ahead' : 'behind' };
}

/** Progress against a daily quest target, percent to 1 decimal. Null when the target is 0 or unknown. */
export function questPercent(value: number, target: number | null): number | null {
  return target === null ? null : ratePercent(value, target);
}

export function questTone(percent: number | null): Tone {
  if (percent === null || percent < 50) return 'bad';
  return percent >= 100 ? 'ok' : 'warn';
}

/** Change from a previous count to a current one, whole percent ("18% vs last Friday"). Null when the previous count is 0. */
export function changePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
