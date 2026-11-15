import { presetRange } from '../reports/range';

// The Overview offers four ranges; the log adds "Any time" (no dates sent). Days are UTC dates, as on Marketing.
export type RangeKey = 'today' | 'week' | 'month' | 'lastMonth';
export type LogRangeKey = RangeKey | 'any';

export const RANGES: Array<{ id: RangeKey; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
];

export const LOG_RANGES: Array<{ id: LogRangeKey; label: string }> = [{ id: 'any', label: 'Any time' }, ...RANGES];

/** The `from` and `to` the API takes, or none for "any". */
export const datesFor = (key: LogRangeKey): { from?: string; to?: string } => (key === 'any' ? {} : presetRange(key));

const isRangeKey = (v: string | null): v is RangeKey => RANGES.some((r) => r.id === v);
export const isLogRangeKey = (v: string | null): v is LogRangeKey => v === 'any' || isRangeKey(v);
