import type { Calculators, GrowthMode, TreeNode } from '../../services/targets.service';
import { compactMoney, monthName as monthOfDay } from '../dashboard/format';
import { formatCount } from '../targets/model';

// Pure rules of the North Star wizard and the Settings tab (M6-T17, F-1111 to F-1113). The API does the arithmetic (split, calculators);
// this file only reads what the person typed and words what the API answered.

export const DEFAULT_ANNUAL = '1800000';
export const DEFAULT_MARGIN = '35';

export const MODES: Array<{ key: GrowthMode; label: string }> = [
  { key: 'even', label: 'Even each month' },
  { key: 'grow', label: 'Grow each quarter' },
  { key: 'custom', label: 'Custom' },
];

/** A typed number: "1,800,000" and "1800000" both read as 1800000. Null for empty or not a number. */
export function parseNumber(text: string): number | null {
  const clean = text.replace(/[,\s]/g, '');
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/** The typed quarters of Custom mode as numbers; null when any is empty or not a number. */
export function customQuarters(texts: string[]): number[] | null {
  const nums = texts.map(parseNumber);
  return nums.every((n): n is number => n !== null && n >= 0) ? nums : null;
}

/** What the typed quarters are short of (positive) or over (negative) the annual figure; null while a field is unreadable. */
export function customGap(annual: number | null, texts: string[]): number | null {
  const q = customQuarters(texts);
  if (annual === null || q === null) return null;
  return Math.round((annual - q.reduce((a, b) => a + b, 0)) * 100) / 100;
}

/** "GH₵100,000 short of the annual figure" / "GH₵100,000 over it"; null when the quarters add up. */
export function customGapText(gap: number | null, currency: string): string | null {
  if (gap === null || gap === 0) return null;
  return `The quarters are ${compactMoney(Math.abs(gap), currency)} ${gap > 0 ? 'short of' : 'over'} the annual figure. They must add up.`;
}

/** Which mode the saved quarters follow: equal quarters are Even; the quarters of the Grow split are Grow; anything else is Custom. */
export function inferMode(saved: number[], even: number[], grow: number[]): GrowthMode {
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  return same(saved, even) ? 'even' : same(saved, grow) ? 'grow' : 'custom';
}

/** True when the tree already has a month that is over: re-planning keeps those values (F-1111). */
export const hasPastMonths = (months: Pick<TreeNode, 'periodStart'>[], currentMonth: string): boolean =>
  months.some((m) => m.periodStart.slice(0, 7) < currentMonth);

export const PAST_MONTHS_NOTE = 'Targets for past months do not change. Only the months from now on take the new split.';

/** "GH₵180k ÷ GH₵249 = 723 delivered orders. ÷ 70% ÷ 60% = 1,721 orders. ÷ 31 days in October = 56 a day." from the API's own numbers. */
export function calculatorLine(c: Calculators, currency: string): string {
  return `${compactMoney(c.revenueTarget, currency)} ÷ ${compactMoney(c.plannedAov, currency)} = ${formatCount(c.ordersDelivered)} delivered orders. `
    + `÷ ${c.confirmationRate}% ÷ ${c.deliverySuccessRate}% = ${formatCount(c.ordersToTakeIn)} orders. `
    + `÷ ${c.daysInMonth} days in ${monthOfDay(`${c.month}-01`)} = ${c.ordersPerDay} a day.`;
}

/** The months of a quarter in words under its tile: "GH₵120k a month". */
export const perMonth = (monthly: string | number, currency: string): string => `${compactMoney(monthly, currency)} a month`;

/** Where the wizard opens: the step in the address, else the first store step not done, else the saved North Star step. */
export function startStep(opts: { asked: number | null; store: boolean; partner: boolean; saved: number }): number {
  if (opts.asked !== null && opts.asked >= 3 && opts.asked <= 6 && opts.store && opts.partner) return opts.asked;
  if (!opts.store) return 1;
  if (!opts.partner) return 2;
  return opts.saved;
}

/** The quarters a save would change: saved value and new value, only where they differ. */
export function quarterChanges(saved: number[], next: string[]): Array<{ quarter: number; from: number; to: number }> {
  return next.flatMap((v, i) => (saved[i] !== undefined && Math.abs(saved[i] - Number(v)) >= 0.01 ? [{ quarter: i + 1, from: saved[i], to: Number(v) }] : []));
}
