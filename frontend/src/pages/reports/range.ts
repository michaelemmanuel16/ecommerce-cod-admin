// The date card of F-1050: five presets. Africa/Accra is UTC and the Orders list already works in UTC dates, so these do too.
export type Preset = 'today' | 'last7' | 'month' | 'lastMonth' | 'custom';
export interface DayRange { from: string; to: string }

export const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
];

const DAY = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m, d));

/** This month runs from the 1st to today (the mockup's "1-17 Oct"), not to the end of the month. */
export function presetRange(preset: Exclude<Preset, 'custom'>, now: Date = new Date()): DayRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = utc(y, m, now.getUTCDate());
  switch (preset) {
    case 'today': return { from: iso(today), to: iso(today) };
    case 'last7': return { from: iso(new Date(+today - 6 * DAY)), to: iso(today) };
    case 'month': return { from: iso(utc(y, m, 1)), to: iso(today) };
    case 'lastMonth': return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) };
  }
}
