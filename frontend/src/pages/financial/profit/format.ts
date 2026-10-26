// Display-only helpers for the Finance profit cards. Nothing here calculates a figure the server owns: it turns API values
// into words, signs and tones.
import { formatCurrency } from '../../../utils/format';
import { parseMoney } from '../../../utils/money';
import { monthName } from '../../dashboard/format';
import type { Money } from '../../../services/financeReports.service';

export const isLoss = (v: Money | null | undefined): boolean => parseMoney(v) < 0;

/** The amount with its minus kept. A missing figure is a dash, never GH₵0. */
export const money = (v: Money | null | undefined): string => (v === null || v === undefined ? '-' : formatCurrency(v));

/** The same amount as a cost line: GH₵12,000 becomes -GH₵12,000 (a zero stays GH₵0). */
export const cost = (v: Money | null | undefined): string => {
  const n = parseMoney(v);
  return formatCurrency(n === 0 ? 0 : -n);
};

/** 12.4 -> "12%", -15.5 -> "-16%" (half away from zero, as the mockup writes it), null -> "n/a". */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'n/a';
  const whole = Math.sign(v) * Math.round(Math.abs(v));
  return `${whole === 0 ? 0 : whole}%`;
}

/** "October" for the month a range ends in. */
export const monthOf = (to: string): string => monthName(to);

/** A margin tag: a loss is bad, under the target is a warning, at or over it is fine. n/a has no tone. */
export function marginTone(v: number | null, target: number): 'ok' | 'warn' | 'bad' | 'n' {
  if (v === null) return 'n';
  if (v < 0) return 'bad';
  return v >= target ? 'ok' : 'warn';
}

/** The class of a figure that is a loss. */
export const lossClass = (v: Money | null | undefined): string | undefined => (isLoss(v) ? 'neg' : undefined);

/** ["Aug", "Sep", "1-17 Sep"] -> "Aug, Sep and 1-17 Sep". */
export const listWords = (items: string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** "Projected at 34% yield" -> "projected at 34% yield". */
export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
