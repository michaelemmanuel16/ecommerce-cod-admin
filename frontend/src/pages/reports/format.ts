// Display-only helpers for Reports. Nothing here calculates a KPI: it turns API values into the mockup's words.
import { MONTHS, parseDay } from '../dashboard/format';

const SHORT_MONTH_NAMES = MONTHS.map((m) => m.slice(0, 3));

export { compactMoney, compactNumber, wholeMoney, wholePercent, plural } from '../dashboard/format';

export const count = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : Math.round(n).toLocaleString('en-US'));

/** 9.2 -> "9.2 days", 1 -> "1 day". */
export const daysText = (n: number): string => `${Number(n.toFixed(1))} ${n === 1 ? 'day' : 'days'}`;

/** "1" for day 1 of the month's list, shown as "1 Oct"; every other label is the day number. */
export function dayTick(ymd: string, always = false): string {
  const { day, month } = parseDay(ymd);
  return always || day === 1 ? `${day} ${SHORT_MONTH_NAMES[month - 1]}` : String(day);
}

/** "1-17 Oct 2026", "17 Oct 2026", "28 Sep to 3 Oct 2026" or "28 Dec 2025 to 3 Jan 2026" (the mockup writes the dash as an en dash). */
export function rangeLabel(from: string, to: string): string {
  const a = parseDay(from);
  const b = parseDay(to);
  const m = (p: { month: number }) => SHORT_MONTH_NAMES[p.month - 1];
  if (from === to) return `${b.day} ${m(b)} ${b.year}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${m(b)} ${b.year}`;
  if (a.year === b.year) return `${a.day} ${m(a)} to ${b.day} ${m(b)} ${b.year}`;
  return `${a.day} ${m(a)} ${a.year} to ${b.day} ${m(b)} ${b.year}`;
}

/** The label under a reason bar: the enum key as words. */
export function reasonLabel(reason: string): string {
  const words: Record<string, string> = { not_reachable: 'Not reachable', refused: 'Refused', wrong_address: 'Wrong address', rescheduled: 'Rescheduled', other: 'Other', unknown: 'No reason given' };
  return words[reason] ?? reason.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** The API groups an empty city or town as "Unknown". Owner decision 2026-10-22: it reads "Not set". */
export const placeName = (name: string): string => (name === 'Unknown' ? 'Not set' : name);
