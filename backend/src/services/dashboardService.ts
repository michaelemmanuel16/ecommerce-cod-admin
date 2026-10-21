/**
 * Owner Dashboard data (M3-T09 and M3-T10, F-200 to F-205, F-207, F-210). `ownerDashboard` builds the blocks of
 * GET /api/dashboard/owner from the M1 KPI functions (services/kpi/*); it does no counting of its own.
 * Every number and every tag key the mockup shows is in the response, so the frontend formats and never calculates.
 *
 * Blocks: header, ladder (year, quarter, month, day), quests, tiles, chart, drivers, recentOrders.
 * `top` (F-208) comes with M6, the margin chip (F-202) with M5; until then neither is in the response.
 *
 *  - Error isolation: a block that throws becomes `{ error }`; the other blocks still answer.
 *  - Range (F-201) changes the tiles' rates, the chart and the recent orders. The ladder, the quests, the "orders today"
 *    tile, the cash tile and the drivers always read the month (and year) that holds `asOf`.
 *  - `asOf` is a store-zone day, default today; a day in the future is moved back to today (F-201).
 *  - Cache (F-200): 30 seconds per tenant, range and day, filled with every block. Permission trimming happens after the
 *    cache, so a manager with and without `financial:view` share one entry. The order events clear the tenant's entries.
 *  - Permission trimming (F-210): no cash tile without `financial:view`, no recent orders without `orders:view`.
 */
import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';
import { runInTenant } from '../utils/tenantContext';
import * as Money from '../utils/money';
import logger from '../utils/logger';
import { randomUUID } from 'crypto';
import { AppError } from '../middleware/errorHandler';
import { getCurrency } from '../utils/currency';
import { AppEvent, onOrderEvent } from '../utils/appEvents';
import { deliveredRevenue, deliveredRevenueByDay, type DeliveredRevenue } from './kpi/revenue';
import { rates, ratePercent } from './kpi/rates';
import { leadership, type Leadership, type Period } from './kpi/leadership';
import { cashHeldByPartners } from './kpi/cash';
import { failedDeliveryCalls, failedDeliveryCallsTarget, ordersPlacedByDay } from './kpi/daily';
import { changePercent, paceChip, progressTag, questPercent, questTone, rateTag } from './kpi/status';
import { daysInMonth, endOfDay, getStoreTimeZone, localDate, parseYmd, shiftYmd, startOfDay, weekRange } from './kpi/dates';

export const DASHBOARD_RANGES = ['today', 'week', 'month', 'last_7_days', 'last_30_days', 'quarter', 'year'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const CACHE_TTL_MS = 30_000;
const RECENT_ORDERS = 4;
/** Fewer days gone than this and the projection is too early to trust (F-205 GUESS). */
const MIN_DAYS_TO_PROJECT = 3;

export interface DashboardAccess {
  /** `financial:view`: the cash tile. */
  cash: boolean;
  /** `orders:view`: the recent orders block. */
  orders: boolean;
}

export interface DashboardOptions {
  range?: DashboardRange;
  /** Store-zone day 'YYYY-MM-DD'. */
  asOf?: string;
  access?: DashboardAccess;
}

/** What a failed block returns. The raw error stays in the server log (it can hold SQL or Prisma details); `errorId` finds it there. */
export interface BlockError { error: { code: 'block_failed'; errorId: string; message?: string } }
type Block<T> = T | BlockError;

/** Everything the page shows, one key per block. Optional keys are trimmed by permission. */
export interface OwnerDashboard {
  header: Block<Record<string, unknown>>;
  ladder: Block<Record<string, unknown>>;
  quests: Block<Record<string, unknown>>;
  tiles: Block<Record<string, unknown>>;
  chart: Block<Record<string, unknown>>;
  drivers: Block<Record<string, unknown>>;
  recentOrders?: Block<Array<Record<string, unknown>>>;
}

interface Context {
  tenantId: string;
  zone: string;
  asOfDate: string;
  range: DashboardRange;
  /** First and last store day of the range. */
  rangeFrom: string;
  rangeTo: string;
  lead: () => Promise<Leadership>;
  today: () => Promise<DeliveredRevenue>;
  /** Today's delivered revenue target (money), null without a month target. */
  todayTarget: () => Promise<Money.Money | null>;
  placedDays: () => Promise<Map<string, number>>;
  currency: () => Promise<string>;
}

const PERIOD_OF_RANGE: Partial<Record<DashboardRange, Period>> = { month: 'month', quarter: 'quarter', year: 'year' };

/** Memoise an async function so the blocks that need the same KPI share one query. */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= fn());
}

const firstOfMonth = (ymd: string) => `${ymd.slice(0, 7)}-01`;

function periodStart(ymd: string, period: Period): string {
  const { year, month } = parseYmd(ymd);
  if (period === 'year') return `${year}-01-01`;
  const startMonth = period === 'quarter' ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  return `${year}-${String(startMonth).padStart(2, '0')}-01`;
}

function periodEnd(ymd: string, period: Period): string {
  const { year, month } = parseYmd(ymd);
  const endMonth = period === 'year' ? 12 : period === 'quarter' ? Math.floor((month - 1) / 3) * 3 + 3 : month;
  return `${year}-${String(endMonth).padStart(2, '0')}-${String(daysInMonth(year, endMonth)).padStart(2, '0')}`;
}

/** First and last store day of a range that ends on asOf. */
function rangeDays(range: DashboardRange, asOfDate: string, zone: string): { from: string; to: string } {
  switch (range) {
    case 'today': return { from: asOfDate, to: asOfDate };
    case 'week': return { from: weekRange(asOfDate, zone).monday, to: asOfDate };
    case 'last_7_days': return { from: shiftYmd(asOfDate, -6), to: asOfDate };
    case 'last_30_days': return { from: shiftYmd(asOfDate, -29), to: asOfDate };
    default: return { from: periodStart(asOfDate, PERIOD_OF_RANGE[range] as Period), to: asOfDate };
  }
}

function greeting(zone: string): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

/**
 * Run one block; a failure becomes `{ error: { code, errorId } }` and the full error goes to the log under the same id.
 * Only the message of an AppError below 500 (a message written for the user) is passed on.
 */
async function isolate<T>(name: string, tenantId: string, build: () => Promise<T>): Promise<Block<T>> {
  try {
    return await build();
  } catch (error: any) {
    const errorId = randomUUID();
    logger.error('Dashboard block failed', { block: name, tenantId, errorId, error: error?.message, stack: error?.stack });
    const safe = error instanceof AppError && error.statusCode < 500;
    return { error: { code: 'block_failed', errorId, ...(safe ? { message: error.message } : {}) } };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------------------

async function headerBlock(c: Context) {
  const [today, target, currency] = await Promise.all([c.today(), c.todayTarget(), c.currency()]);
  const delivered = Money.parse(today.total.value);
  const remaining = target ? Prisma.Decimal.max(Money.sub(target, delivered), Money.ZERO) : null;
  return {
    asOfDate: c.asOfDate,
    generatedAt: new Date().toISOString(),
    timeZone: c.zone,
    greeting: greeting(c.zone),
    currency,
    /** What today's delivered revenue still needs to reach today's target; null without a target. */
    remainingToday: remaining ? Money.toApi(remaining) : null,
    /** Same, rounded to the nearest 100 for the sub-line ("You need GH₵2,100 more"). */
    remainingTodayRounded: remaining ? Money.toApi(Money.mul(Money.roundHalfUp(Money.div(remaining, 100), 0), 100)) : null,
    targetMet: target !== null && delivered.gte(target),
  };
}

async function ladderBlock(c: Context) {
  const [l, today, target, currency] = await Promise.all([c.lead(), c.today(), c.todayTarget(), c.currency()]);
  const rung = (period: Period) => {
    const a = l.attainment[period];
    const gone = l.pace[period].detail as { daysGone: number; daysInPeriod: number };
    return {
      actual: a.actual,
      target: a.target,
      percent: a.value,
      /** Days gone / days in the period, percent. */
      pace: a.pace,
      daysLeft: gone.daysInPeriod - gone.daysGone,
      tag: progressTag(a.value, a.pace),
    };
  };
  const delivered = Money.parse(today.total.value);
  const dayPercent = target && target.gt(0) ? ratePercent(delivered.toNumber(), target.toNumber()) : null;
  return {
    currency,
    year: { ...rung('year'), paceChip: paceChip(l.attainment.year.value, l.attainment.year.pace) },
    quarter: rung('quarter'),
    month: rung('month'),
    day: {
      actual: today.total.value,
      target: target ? Money.toApi(Money.roundHalfUp(target, 2)) : null,
      percent: dayPercent,
      deliveredOrders: today.deliveredOrders.value,
      tag: target === null ? 'no_target' : delivered.gte(target) ? 'hit' : 'in_progress',
    },
  };
}

async function questsBlock(c: Context) {
  const [l, today, target, days, callsTarget] = await Promise.all([
    c.lead(), c.today(), c.todayTarget(), c.placedDays(), failedDeliveryCallsTarget(c.tenantId, c.asOfDate),
  ]);
  const dayStart = startOfDay(c.asOfDate, c.zone);
  const calls = await failedDeliveryCalls(c.tenantId, dayStart, endOfDay(c.asOfDate, c.zone));

  const ordersTarget = l.ordersNeededPerDay.value;
  const ordersToday = days.get(c.asOfDate) ?? 0;
  const ordersPercent = questPercent(ordersToday, ordersTarget);

  const monthStart = firstOfMonth(c.asOfDate);
  let daysHit = 0;
  if (ordersTarget !== null) {
    for (let d = monthStart; d <= c.asOfDate; d = shiftYmd(d, 1)) if ((days.get(d) ?? 0) >= ordersTarget) daysHit += 1;
  }

  const delivered = Money.parse(today.total.value);
  const revenuePercent = target && target.gt(0) ? ratePercent(delivered.toNumber(), target.toNumber()) : null;
  const callsPercent = questPercent(calls.value, callsTarget.value);

  return {
    /** "On target 14 of 17 days this month": days the New orders quest was hit, of the days gone. Null without an orders target. */
    onTargetDays: ordersTarget === null ? null : { hit: daysHit, of: l.daysGone, quest: 'new_orders' },
    items: [
      {
        key: 'new_orders', unit: 'count', value: ordersToday, target: ordersTarget, percent: ordersPercent,
        tag: ordersTarget !== null && ordersToday >= ordersTarget ? 'hit' : 'open', tone: questTone(ordersPercent),
      },
      {
        key: 'delivered_revenue', unit: 'money', value: today.total.value,
        target: target ? Money.toApi(Money.roundHalfUp(target, 2)) : null, percent: revenuePercent,
        tag: target !== null && delivered.gte(target) ? 'hit' : 'open', tone: questTone(revenuePercent),
      },
      {
        key: 'failed_delivery_calls', unit: 'count', value: calls.value, target: callsTarget.value,
        targetSource: callsTarget.source, percent: callsPercent,
        tag: calls.value >= callsTarget.value ? 'hit' : 'open', tone: questTone(callsPercent),
      },
    ],
  };
}

async function tilesBlock(c: Context) {
  const { start, end } = { start: startOfDay(c.rangeFrom, c.zone), end: endOfDay(c.rangeTo, c.zone) };
  const [l, days, r, cash, currency] = await Promise.all([
    c.lead(),
    c.placedDays(),
    rates(c.tenantId, start, end, { basis: 'cohort' }),
    cashHeldByPartners(c.tenantId),
    c.currency(),
  ]);
  const { confirmationTarget, successTarget } = l.ordersNeededPerDay.detail as { confirmationTarget: number; successTarget: number };
  const gap = (value: number | null, target: number) => (value === null ? null : Math.round((value - target) * 10) / 10);

  const ordersToday = days.get(c.asOfDate) ?? 0;
  const lastWeekDate = shiftYmd(c.asOfDate, -7);
  const lastWeek = days.get(lastWeekDate) ?? 0;
  const delta = changePercent(ordersToday, lastWeek);

  const conf = r.confirmationRate;
  const success = r.deliverySuccessRate;
  return {
    currency,
    /** The rates below cover this range, orders by the date they were placed. */
    range: { from: c.rangeFrom, to: c.rangeTo },
    ordersToday: {
      value: ordersToday,
      target: l.ordersNeededPerDay.value,
      vsLastWeek: { date: lastWeekDate, count: lastWeek, deltaPercent: delta, trend: delta === null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' },
    },
    confirmationRate: {
      value: conf.value, target: confirmationTarget, gapPoints: gap(conf.value, confirmationTarget),
      tag: rateTag(conf.value, confirmationTarget), confirmed: conf.detail?.confirmed ?? 0, placed: conf.detail?.placed ?? 0,
    },
    deliverySuccessRate: {
      value: success.value, target: successTarget, gapPoints: gap(success.value, successTarget),
      tag: rateTag(success.value, successTarget), basis: 'cohort', yield: r.orderToCashYield.value,
      delivered: success.detail?.delivered ?? 0, closed: success.detail?.closed ?? 0,
    },
    /** overdueOrders: partner collections still open (draft, verified or approved) and collected more than 8 days ago ("38 orders over 8 days"). */
    cash: { value: cash.value, partners: cash.detail?.partners ?? 0, overdueOrders: cash.detail?.overdueOrders ?? 0 },
  };
}

async function chartBlock(c: Context) {
  const [l, currency] = await Promise.all([c.lead(), c.currency()]);
  const period = PERIOD_OF_RANGE[c.range];
  const target = period ? l.attainment[period].target : null;
  const lastDay = period ? periodEnd(c.asOfDate, period) : c.rangeTo;

  const revenue = new Map((await deliveredRevenueByDay(c.tenantId, startOfDay(c.rangeFrom, c.zone), endOfDay(c.rangeTo, c.zone)))
    .map((d) => [d.date, d.revenue]));
  const dates: string[] = [];
  for (let d = c.rangeFrom; d <= lastDay; d = shiftYmd(d, 1)) dates.push(d);

  let cumulative = Money.ZERO;
  const days = dates.map((date, i) => {
    // Straight pace to the period target: day i of N is i / N of it, the same rule as the pace marker (F-202).
    const targetPace = target ? Money.toApi(Money.roundHalfUp(Money.div(Money.mul(target, i + 1), dates.length), 2)) : null;
    if (date > c.rangeTo) return { date, delivered: null, cumulative: null, targetPace, vsPace: null };
    const delivered = Money.parse(revenue.get(date) ?? '0');
    cumulative = Money.add(cumulative, delivered);
    return {
      date, delivered: Money.toApi(delivered), cumulative: Money.toApi(cumulative), targetPace,
      /** Cumulative minus target pace: negative = behind. */
      vsPace: targetPace ? Money.toApi(Money.sub(cumulative, targetPace)) : null,
    };
  });
  return { currency, period: period ?? null, target, from: c.rangeFrom, to: c.rangeTo, days };
}

async function driversBlock(c: Context) {
  const [l, currency] = await Promise.all([c.lead(), c.currency()]);
  return {
    currency,
    projectedMonth: {
      value: l.projectedMonth.value, percentOfTarget: l.projectedPercent.value,
      /** Fewer than 3 days gone: the card says "Too early to project". */
      tooEarly: l.daysGone < MIN_DAYS_TO_PROJECT,
      basis: 'todays_rate', daysGone: l.daysGone, daysInMonth: l.daysInMonth,
    },
    neededPerDay: { value: l.neededPerDay.value, daysLeft: l.daysInMonth - l.daysGone },
    biggestLever: { rate: l.lever.rate, points: l.lever.points, value: l.lever.value },
  };
}

async function recentOrdersBlock(c: Context) {
  const [rows, storeCurrency] = await Promise.all([
    runInTenant(c.tenantId, () => prisma.order.findMany({
      where: { deletedAt: null, createdAt: { gte: startOfDay(c.rangeFrom, c.zone), lt: endOfDay(c.rangeTo, c.zone) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RECENT_ORDERS,
      select: {
        id: true, externalOrderId: true, status: true, totalAmount: true, currency: true, deliveryArea: true, createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
        calls: { orderBy: { createdAt: 'desc' }, take: 1, select: { outcome: true } },
      },
    })),
    c.currency(),
  ]);
  return rows.map((o) => ({
    id: o.id,
    externalOrderId: o.externalOrderId,
    customerName: `${o.customer.firstName} ${o.customer.lastName}`.trim(),
    city: o.deliveryArea,
    status: o.status,
    /** A pending order whose last call was not reachable: the row shows Pending with a small note (F-207). */
    notReachable: o.status === 'pending_confirmation' && o.calls[0]?.outcome === 'not_reachable',
    amount: Money.toApi(o.totalAmount),
    currency: o.currency ?? storeCurrency,
    createdAt: o.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------------------------------------
// Entry point, cache, trimming
// ---------------------------------------------------------------------------------------------------------

async function build(tenantId: string, range: DashboardRange, asOfDate: string): Promise<OwnerDashboard> {
  const zone = getStoreTimeZone(tenantId);
  const days = rangeDays(range, asOfDate, zone);
  const asOfStart = startOfDay(asOfDate, zone);
  const asOfEnd = endOfDay(asOfDate, zone);

  const lead = once(() => leadership(tenantId, asOfDate));
  const today = once(() => deliveredRevenue(tenantId, asOfStart, asOfEnd));
  const c: Context = {
    tenantId, zone, asOfDate, range, rangeFrom: days.from, rangeTo: days.to, lead, today,
    currency: once(() => getCurrency()),
    // (month target - delivered so far) / days left after today (F-203). On the last day nothing is left after today,
    // so the whole remaining target (before today's deliveries) falls on today.
    todayTarget: once(async () => {
      const [l, t] = await Promise.all([lead(), today()]);
      if (l.neededPerDay.value !== null) return Money.parse(l.neededPerDay.value);
      const monthTarget = l.attainment.month.target;
      if (monthTarget === null || l.daysGone < l.daysInMonth) return null;
      return Prisma.Decimal.max(Money.sub(monthTarget, Money.sub(l.revenueSoFar.value, t.total.value)), Money.ZERO);
    }),
    // Orders placed per day from the first of the month or a week before asOf, whichever is earlier (quests and tiles).
    placedDays: once(async () => {
      const from = [firstOfMonth(asOfDate), shiftYmd(asOfDate, -7)].sort()[0];
      const rows = await ordersPlacedByDay(tenantId, startOfDay(from, zone), asOfEnd);
      return new Map(rows.map((r) => [r.date, r.count]));
    }),
  };
  // Every block is built for every viewer, so one cache entry serves all; `trim` takes out what a viewer may not see.
  const [header, ladder, quests, tiles, chart, drivers, recentOrders] = await Promise.all([
    isolate('header', tenantId, () => headerBlock(c)),
    isolate('ladder', tenantId, () => ladderBlock(c)),
    isolate('quests', tenantId, () => questsBlock(c)),
    isolate('tiles', tenantId, () => tilesBlock(c)),
    isolate('chart', tenantId, () => chartBlock(c)),
    isolate('drivers', tenantId, () => driversBlock(c)),
    isolate('recentOrders', tenantId, () => recentOrdersBlock(c)),
  ]);
  return { header, ladder, quests, tiles, chart, drivers, recentOrders };
}

const cache = new Map<string, { at: number; body: OwnerDashboard }>();
/** Raised by every clear, so a build that started before an order event does not cache its stale body. */
let generation = 0;

/** Drop a tenant's cached dashboards (all tenants without an argument). */
export function clearDashboardCache(tenantId?: string): void {
  generation += 1;
  if (!tenantId) { cache.clear(); return; }
  for (const key of cache.keys()) if (key.startsWith(`${tenantId}|`)) cache.delete(key);
}

let listening = false;
/** Clear the tenant's cache on every order event. Idempotent; the server calls it at bootstrap (tests call it too). */
export function registerDashboardCacheListeners(): void {
  if (listening) return;
  listening = true;
  const clear = (evt: { tenantId: string }) => clearDashboardCache(evt.tenantId);
  onOrderEvent(AppEvent.ORDER_STATUS_CHANGED, clear);
  onOrderEvent(AppEvent.ORDER_CREATED, clear);
  onOrderEvent(AppEvent.ORDER_DELETED, clear);
}

const hasError = (body: OwnerDashboard) => Object.values(body).some((b) => b && typeof b === 'object' && !Array.isArray(b) && 'error' in b);

/** Take out what the viewer may not see. Works on a copy, the cached body stays whole. */
function trim(body: OwnerDashboard, access: DashboardAccess): OwnerDashboard {
  const out: OwnerDashboard = { ...body };
  if (!access.orders) delete out.recentOrders;
  if (!access.cash && out.tiles && !('error' in out.tiles)) {
    const { cash: _cash, ...tiles } = out.tiles as Record<string, unknown>;
    out.tiles = tiles;
  }
  return out;
}

export async function ownerDashboard(tenantId: string, options: DashboardOptions = {}): Promise<OwnerDashboard> {
  const range = options.range ?? 'month';
  const access = options.access ?? { cash: true, orders: true };
  const zone = getStoreTimeZone(tenantId);
  const todayDate = localDate(new Date(), zone);
  // Validates the format (RangeError for 2026-02-30). A day after today is moved back to today.
  const requested = options.asOf ?? todayDate;
  parseYmd(requested);
  const asOfDate = requested > todayDate ? todayDate : requested;

  const key = `${tenantId}|${range}|${asOfDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return trim(hit.body, access);

  const startedAt = generation;
  const body = await build(tenantId, range, asOfDate);
  if (!hasError(body) && generation === startedAt) {
    if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_TTL_MS) cache.delete(k);
    cache.set(key, { at: Date.now(), body });
  }
  return trim(body, access);
}
