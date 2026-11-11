// Display-only helpers for Marketing. Nothing here owns a KPI: the API sends every figure; this turns it into words.
import type { Amount, MoneyView } from '../../services/marketing.service';
import { formatCurrency } from '../../utils/format';
import { parseMoney } from '../../utils/money';

/** The ad account figure first when there is one (₦), else the store figure. A missing figure is a dash. */
export const money = (v: MoneyView | null | undefined): string => {
  if (!v) return '-';
  return v.account !== null && v.accountCurrency ? formatCurrency(v.account, v.accountCurrency) : formatCurrency(v.store);
};

/** The number behind `money`, for a change against the previous period. */
export const moneyNumber = (v: MoneyView | null | undefined): number | null => (v ? parseMoney(v.account !== null ? v.account : v.store) : null);

export const amount = (v: Amount, currency: string): string => formatCurrency(v, currency);

/** 12.34 -> "12.3%", 45.6 -> "46%", null -> "-". A step percent of the funnel. */
export function stepPercent(part: number, whole: number): string {
  if (whole <= 0) return '-';
  const p = (part / whole) * 100;
  return `${p < 10 ? Number(p.toFixed(1)) : Math.round(p)}%`;
}
