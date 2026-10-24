import { format, formatDistance, formatRelative } from 'date-fns';
import { useConfigStore } from '../stores/configStore';
import { formatMoney, parseMoney } from './money';
import { getCurrencySymbol } from './countries';

/** The store currency from config (F-100, O5). 'USD' until the config loads. */
export const getStoreCurrency = (): string => useConfigStore.getState().currency || 'USD';

/**
 * The one money formatter. Amount in the store currency by default; pass `currency` for a record that has its own.
 * An unknown or malformed code never throws: it shows "XYZ 1,234.50". Whole amounts drop the cents.
 * The formatting itself is `formatMoney` in ./money, which the public checkout and the embed use without the admin app's stores.
 */
export const formatCurrency = (amount: string | number | null | undefined, currency?: string): string =>
  formatMoney(amount, currency || getStoreCurrency());

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

/** Today as YYYY-MM-DD in the viewer's own zone (toISOString is UTC and gives tomorrow after 23:00 in Lagos). */
export const todayYmd = (now: Date = new Date()): string => format(now, 'yyyy-MM-dd');

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

// Local display for a stored E.164 phone (F-362), same rule as backend formatPhoneLocal.
export const formatPhoneLocal = (e164: string): string => {
  const gh = /^\+233(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (gh) return `0${gh[1]} ${gh[2]} ${gh[3]}`;
  const ng = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (ng) return `0${ng[1]} ${ng[2]} ${ng[3]}`;
  return e164;
};

export const formatPercentage = (value: number, decimals: number = 1): string => {
  return `${value.toFixed(decimals)}%`;
};

export const truncate = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
};
