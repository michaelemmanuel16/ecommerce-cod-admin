// Display-only helpers for Marketing. Nothing here owns a KPI: the API sends every figure; this turns it into words.
import type { Amount, MoneyView } from '../../services/marketing.service';
import { formatCurrency, getStoreCurrency } from '../../utils/format';
import { parseMoney } from '../../utils/money';
import { wholeMoney } from '../dashboard/format';

/** The one place the page formats an amount: naira is a whole number (no kobo), any other currency keeps its own decimals. */
export const amount = (v: Amount, currency: string): string => (currency === 'NGN' ? wholeMoney(v, currency) : formatCurrency(v, currency));

/** The ad account figure first when there is one (₦), else the store figure. A missing figure is a dash. */
export const money = (v: MoneyView | null | undefined): string => {
  if (!v) return '-';
  return v.account !== null && v.accountCurrency ? amount(v.account, v.accountCurrency) : amount(v.store, getStoreCurrency());
};

/** The number behind `money`, for a change against the previous period. */
export const moneyNumber = (v: MoneyView | null | undefined): number | null => (v ? parseMoney(v.account !== null ? v.account : v.store) : null);

/** 12.34 -> "12.3%", 45.6 -> "46%", null -> "-". A step percent of the funnel. */
export function stepPercent(part: number, whole: number): string {
  if (whole <= 0) return '-';
  const p = (part / whole) * 100;
  return `${p < 10 ? Number(p.toFixed(1)) : Math.round(p)}%`;
}
