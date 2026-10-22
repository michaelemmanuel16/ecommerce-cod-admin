// Display-only helpers for the Dashboard. Nothing here calculates a KPI: it turns API values into the mockup's words
// ("GH₵1.38M", "GH₵4.2k", "Friday 17 October", "Updated 06:42").
import { formatCurrency } from '../../utils/format';
import { parseMoney } from '../../utils/money';
import { getCurrencySymbol } from '../../utils/countries';
import type { Chart, Header, Money, RecentOrder } from './types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** A store-zone day 'YYYY-MM-DD' as parts. Parsed by hand: `new Date('2026-10-17')` would shift with the viewer's zone. */
export function parseDay(ymd: string): { year: number; month: number; day: number; weekday: number } {
  const [year, month, day] = ymd.split('-').map(Number);
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** "Friday 17 October" */
function longDay(ymd: string): string {
  const { weekday, day, month } = parseDay(ymd);
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`;
}
export const weekdayName = (ymd: string): string => WEEKDAYS[parseDay(ymd).weekday];
export const monthName = (ymd: string): string => MONTHS[parseDay(ymd).month - 1];
export const quarterOf = (ymd: string): number => Math.ceil(parseDay(ymd).month / 3);
/** "17 Oct" */
export const shortDay = (ymd: string): string => {
  const { day, month } = parseDay(ymd);
  return `${day} ${SHORT_MONTHS[month - 1]}`;
};

const trim = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** Number without symbol, as the chart axis writes it: 180k, 60k, 0, 1.4M. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000, 2)}M`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000, 1)}k`;
  return `${sign}${trim(abs, 0)}`;
}

/** Whole thousands for a gap against the pace: 6,700 -> "7k" (the mockup's "−7k vs pace"). */
export const gapNumber = (abs: number): string => compactNumber(abs >= 1000 && abs < 1_000_000 ? Math.round(abs / 1000) * 1000 : abs);

/** "GH₵1.38M", "GH₵92k", "GH₵4.2k", "GH₵850": the short money of the mockup. */
export function compactMoney(value: Money | null | undefined, currency: string): string {
  return `${getCurrencySymbol(currency)}${compactNumber(parseMoney(value))}`;
}

/** Whole-amount money for a target or a count of cash ("GH₵540,000", "GH₵6,286"). Rounds for display only. */
export function wholeMoney(value: Money | null | undefined, currency: string): string {
  return formatCurrency(Math.round(parseMoney(value)), currency);
}

/** Today's target as the mockup writes it: nearest GH₵100 ("GH₵6,300"). Display only; the bar uses the exact figure. */
export function hundredsMoney(value: Money | null | undefined, currency: string): string {
  return formatCurrency(Math.round(parseMoney(value) / 100) * 100, currency);
}

/** 76.8 -> "77%". */
export const wholePercent = (value: number | null | undefined): string => (value === null || value === undefined ? 'n/a' : `${Math.round(value)}%`);

/** "06:42" in the store time zone. */
export function clockTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  }
}

export const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "AO" from "Abena Owusu". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** The sub-line: "Friday 17 October. You need GH₵2,100 more delivered revenue today to stay on pace." */
export function subLine(h: Header): string {
  const day = `${longDay(h.asOfDate)}.`;
  if (h.targetMet) return `${day} You hit today's target.`;
  if (h.remainingTodayRounded === null || h.remainingTodayRounded === undefined) return day;
  const more = wholeMoney(h.remainingTodayRounded, h.currency);
  // remaining under GH₵50 rounds to 0: not met, but not a "GH₵0 more" either
  if (Number(h.remainingTodayRounded) === 0) return `${day} You are almost at today's target.`;
  return `${day} You need ${more} more delivered revenue today to stay on pace.`;
}


export const orderNumber = (o: Pick<RecentOrder, 'id' | 'externalOrderId'>): string => `#${o.externalOrderId ?? o.id}`;

export interface ChartPoint { date: string; cumulative: number | null; targetPace: number | null; vsPace: number | null }

export const toChartPoint = (d: Chart['days'][number]): ChartPoint => ({
  date: d.date,
  cumulative: d.cumulative === null ? null : parseMoney(d.cumulative),
  targetPace: d.targetPace === null ? null : parseMoney(d.targetPace),
  vsPace: d.vsPace === null ? null : parseMoney(d.vsPace),
});

/** What a screen reader hears instead of the picture (F-205). Built from the API's own numbers. */
export function chartSummary(chart: Chart, asOfDate: string | null): string {
  const points = chart.days.map(toChartPoint);
  const last = [...points].reverse().find((p) => p.cumulative !== null);
  const label = asOfDate ? `Delivered revenue for ${monthName(asOfDate)}` : 'Delivered revenue';
  if (!last || last.cumulative === null) return `${label}: no delivered revenue in this range.`;
  const parts = [`${label} compared with the target pace.`, `On ${shortDay(last.date)}: ${compactMoney(last.cumulative, chart.currency)} delivered so far`];
  if (chart.target !== null) parts[1] += ` of ${wholeMoney(chart.target, chart.currency)}`;
  parts[1] += '.';
  if (last.vsPace !== null) {
    parts.push(`${compactMoney(Math.abs(last.vsPace), chart.currency)} ${last.vsPace < 0 ? 'behind' : 'ahead of'} the target pace.`);
  }
  return parts.join(' ');
}

