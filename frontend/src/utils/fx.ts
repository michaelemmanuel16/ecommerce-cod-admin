import { getCurrencySymbol } from './countries';
import { formatCurrency } from './format';

/** A manual rate older than this many days shows the stale warning (M1-T32; automatic rates never do). */
export const STALE_MANUAL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const dayNumber = (ymd: string): number => Date.parse(`${ymd}T00:00:00Z`) / DAY_MS;

/** Whole days from `fromYmd` to `toYmd` (YYYY-MM-DD). */
function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(dayNumber(toYmd) - dayNumber(fromYmd));
}

/** True only for a manual rate dated more than STALE_MANUAL_DAYS days before `today`. */
export function isStaleManualRate(rate: { source: 'auto' | 'manual'; date: string }, today: string): boolean {
  return rate.source === 'manual' && daysBetween(rate.date, today) > STALE_MANUAL_DAYS;
}

const trimNumber = (n: number): string => Number(n.toPrecision(8)).toString();

/** "1 GH₵ = ₦112" */
export function formatSampleRate(from: string, to: string, rate: number): string {
  return `1 ${getCurrencySymbol(from)} = ${getCurrencySymbol(to)}${trimNumber(rate)}`;
}

/** Computed helper text: "GH₵100.00 = ₦11,200.00, and ₦100.00 = GH₵0.89". */
export function formatRateHelper(from: string, to: string, rate: number): string {
  return `${formatCurrency(100, from)} = ${formatCurrency(100 * rate, to)}, and ${formatCurrency(100, to)} = ${formatCurrency(100 / rate, from)}`;
}
