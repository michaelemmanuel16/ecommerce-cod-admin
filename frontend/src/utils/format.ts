import { format, formatDistance, formatRelative } from 'date-fns';
import { useConfigStore } from '../stores/configStore';
import { parseMoney } from './money';
import { getCurrencySymbol } from './countries';

/** The store currency from config (F-100, O5). 'USD' until the config loads. */
export const getStoreCurrency = (): string => useConfigStore.getState().currency || 'USD';

/**
 * The one money formatter. Amount in the store currency by default; pass `currency` for a record that has its own.
 * An unknown or malformed code never throws: it shows "XYZ 1,234.50".
 */
export const formatCurrency = (amount: string | number | null | undefined, currency?: string): string => {
  const targetCurrency = currency || getStoreCurrency();
  const value = parseMoney(amount);

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: targetCurrency,
      // narrowSymbol renders the local glyph (GH₵5,680.00) instead of the ISO
      // code prefix (GHS 5,680.00) that 'symbol' falls back to for GHS/NGN.
      currencyDisplay: 'narrowSymbol',
    }).format(value);
  } catch {
    return `${targetCurrency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
  }
};

/** "₦112 = GH₵1": the rate used, `rate` = units of `foreign` for 1 unit of the store currency on that day. */
export const formatRateUsed = (foreign: string, rate: number, store: string = getStoreCurrency()): string =>
  `${getCurrencySymbol(foreign)}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(rate)} = ${getCurrencySymbol(store)}1`;

/**
 * An amount in another currency (for example Meta ad spend in NGN) shown in the store currency at that day's rate.
 * `text` is the converted amount; `rateText` is the rate used, for the page to show next to it ("₦112 = GH₵1").
 * Without a usable rate the amount stays in its own currency and `rateText` is empty, so nothing is converted on a guess.
 */
export const formatConverted = (
  amount: string | number | null | undefined,
  foreign: string,
  rate: number | null | undefined,
  store: string = getStoreCurrency(),
): { text: string; rateText: string } => {
  if (foreign === store) return { text: formatCurrency(amount, store), rateText: '' };
  if (!rate || !Number.isFinite(rate) || rate <= 0) return { text: formatCurrency(amount, foreign), rateText: '' };
  return { text: formatCurrency(parseMoney(amount) / rate, store), rateText: formatRateUsed(foreign, rate, store) };
};

export const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value);
};

export const formatDate = (date: string | Date, formatStr: string = 'MMM dd, yyyy'): string => {
  return format(new Date(date), formatStr);
};

export const formatDateTime = (date: string | Date): string => {
  return format(new Date(date), 'MMM dd, yyyy HH:mm');
};

export const formatRelativeTime = (date: string | Date): string => {
  return formatDistance(new Date(date), new Date(), { addSuffix: true });
};

export const formatRelativeDate = (date: string | Date): string => {
  return formatRelative(new Date(date), new Date());
};

export const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return '(' + match[1] + ') ' + match[2] + '-' + match[3];
  }
  return phone;
};

export const formatPercentage = (value: number, decimals: number = 1): string => {
  return `${value.toFixed(decimals)}%`;
};

export const truncate = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
};
