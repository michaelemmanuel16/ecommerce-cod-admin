import { presetRange, type DayRange } from '../reports/range';

// The Marketing period select: four presets. Days are UTC dates, as on Reports (Africa/Accra is UTC).
export type Period = 'today' | 'week' | 'month' | 'lastMonth';

export const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
];

/** This week runs from Monday to today. */
export const periodRange = (period: Period, now: Date = new Date()): DayRange => presetRange(period, now);
