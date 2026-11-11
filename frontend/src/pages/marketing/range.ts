import { presetRange, type DayRange } from '../reports/range';

// The Marketing period select: four presets. Days are UTC dates, as on Reports (Africa/Accra is UTC).
export type Period = 'today' | 'week' | 'month' | 'lastMonth';

export const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
];

const DAY = 86_400_000;

/** This week runs from Monday to today. */
export function periodRange(period: Period, now: Date = new Date()): DayRange {
  if (period !== 'week') return presetRange(period, now);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  return { from: new Date(+today - sinceMonday * DAY).toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}
