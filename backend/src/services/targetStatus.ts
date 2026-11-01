import { OFF_TRACK_POINTS, progressTag } from './kpi/status';

/**
 * Status words of the Targets page (M6-T15, F-1101). Pure: the tree and the attainment return the key and the label, the page only
 * draws them (one tone per key).
 *
 *  - 'revenue_hit'        revenue is at or above its target
 *  - 'hit_margin_missed'  revenue is at or above its target and the margin is below the margin target ("Revenue hit, margin missed")
 *  - 'ahead'              under target, and OFF_TRACK_POINTS or more ahead of the pace
 *  - 'on_track'           under target, at or above the pace
 *  - 'behind'             under target and under the pace, or a period that is over and was missed
 *
 * `pace` is the percent the period should have reached today: straight days for a quarter and a month, the quarter plan for a year
 * (owner decision, kpi/yearPace.ts). The pace test is the Dashboard's `progressTag`, so the two screens never disagree. A period with
 * no target has no status. A margin that is null (no margin data, or a count or rate metric) never counts as missed.
 */

export type TargetStatus = 'revenue_hit' | 'hit_margin_missed' | 'ahead' | 'on_track' | 'behind';

export const STATUS_LABEL: Record<TargetStatus, string> = {
  revenue_hit: 'Revenue hit',
  hit_margin_missed: 'Revenue hit, margin missed',
  ahead: 'Ahead',
  on_track: 'On track',
  behind: 'Behind',
};

export interface StatusInput {
  /** Revenue (or progress) / target, percent. Null when there is no target (or it is 0). */
  percent: number | null;
  /** Percent of the period gone (see above). Ignored for a period that is over. */
  pace: number;
  /** Net margin of the period, percent; null when there is no margin data. */
  margin: number | null;
  marginTarget: number;
  /** The period has ended. */
  over: boolean;
}

export function targetStatus({ percent, pace, margin, marginTarget, over }: StatusInput): TargetStatus | null {
  if (percent === null) return null;
  if (percent >= 100) return margin !== null && margin < marginTarget ? 'hit_margin_missed' : 'revenue_hit';
  if (over || progressTag(percent, pace) !== 'on_track') return 'behind';
  return Math.round((percent - pace) * 10) / 10 >= OFF_TRACK_POINTS ? 'ahead' : 'on_track';
}
