/**
 * Reports data (M3-T20 and M3-T21, F-1050 to F-1053, F-1064): the Overview, Sales and Delivery tabs of
 * GET /api/reports/:tab. Like dashboardService, this file does no counting of its own: every figure comes from the KPI
 * functions (services/kpi/*), so a number on a tab is the number on the Dashboard for the same range. What it adds is
 * the layout (blocks, rows, previous period) so the frontend formats and never calculates.
 *
 *  - Range: [from, to) as in /api/kpi (a date-only `to` is inclusive). More than 366 store days is a 400 (F-1057).
 *  - Compare (F-1050): when on, the same figures are read for the previous period and each tile and row carries
 *    `previous` and a change. A range that starts on the 1st and stays inside one month compares with the same days of the
 *    month before ("1-17 Oct" against "1-17 Sep", the mockup); any other range with the equal-length period just before it.
 *  - Basis: the three rates are cohort (orders placed in the range, outcome read now). Revenue and delivered orders are
 *    by delivery date. Each block says which in `dateBasis` where the two sit side by side.
 *  - Error isolation: a block that throws becomes `{ error: { code: 'block_failed', errorId } }`, the others still
 *    answer; the raw error stays in the server log.
 *  - Permission trimming: Sales has no cash tiles without `financial:view`.
 */
import { randomUUID } from 'crypto';
import * as Money from '../utils/money';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { invalidRange } from '../utils/kpiRequest';
import { currencyOfTenant } from '../utils/currency';
import { OrderStatus } from '@prisma/client';
import { deliveredAov, deliveredRevenue, deliveredRevenueByDay, deliveredRevenueByState } from './kpi/revenue';
import { rates, ratePercent } from './kpi/rates';
import { leadership } from './kpi/leadership';
import { cashHeldByPartner, cashHeldByPartners, cashReceived, partnerPaysInDays } from './kpi/cash';
import { confirmedPlacedByDay, ordersPlacedByDay } from './kpi/daily';
import { partnerRates } from './kpi/partners';
import { productDeliveredUnits } from './kpi/products';
import { baseState } from '../utils/regions';
import { failureReasons, ordersByStatus, outForDelivery, successByState, waitingToDispatch } from './kpi/outcomes';
import { changePercent, rateTag } from './kpi/status';
import { DAY_MS, addDays, daysInMonth, endOfDay, getStoreTimeZone, localDate, parseYmd, shiftYmd, startOfDay } from './kpi/dates';

/** The longest range a report or export covers (F-1057: "Range over 366 days asks to narrow it"). */
export const MAX_REPORT_DAYS = 366;

export const REPORT_TABS = ['overview', 'sales', 'delivery'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export interface ReportAccess {
  /** `financial:view`: the cash tiles of Sales. */
  cash: boolean;
}

export interface ReportOptions {
  compare?: boolean;
  access?: ReportAccess;
}

/** What a failed block returns. The raw error stays in the server log; `errorId` finds it there. */
export interface BlockError { error: { code: 'block_failed'; errorId: string; message?: string } }
type Block<T = Record<string, unknown>> = T | BlockError;

export interface ReportBody {
  tab: ReportTab;
  range: { from: string; to: string; days: number; timeZone: string };
  /** The previous period, null when compare is off. */
  compare: { from: string; to: string; days: number } | null;
  generatedAt: string;
  currency: string;
  [block: string]: unknown;
}

interface Period {
  from: Date;
  to: Date;
  /** First and last store day, YYYY-MM-DD. */
  fromYmd: string;
  toYmd: string;
  days: string[];
}

export interface ReportRange extends Period {
  zone: string;
  previous: Period | null;
}

function period(fromYmd: string, toYmd: string, zone: string): Period {
  const days: string[] = [];
  for (let d = fromYmd; d <= toYmd; d = shiftYmd(d, 1)) days.push(d);
  return { from: startOfDay(fromYmd, zone), to: endOfDay(toYmd, zone), fromYmd, toYmd, days };
}

/** The previous period of a first..last store-day range (see the file comment). */
export function previousDays(fromYmd: string, toYmd: string): { from: string; to: string } {
  const f = parseYmd(fromYmd);
  const t = parseYmd(toYmd);
  if (f.day === 1 && f.year === t.year && f.month === t.month) {
    const year = f.month === 1 ? f.year - 1 : f.year;
    const month = f.month === 1 ? 12 : f.month - 1;
    const length = daysInMonth(year, month);
    const lastDay = t.day === daysInMonth(t.year, t.month) ? length : Math.min(t.day, length);
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, '0')}` };
  }
  const length = Math.round((Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(f.year, f.month - 1, f.day)) / DAY_MS) + 1;
  return { from: shiftYmd(fromYmd, -length), to: shiftYmd(fromYmd, -1) };
}

/** Resolve [from, to) to store days and the previous period. Throws a 400 for a range over 366 days. */
export function reportRange(tenantId: string, from: Date, to: Date, compare: boolean): ReportRange {
  const zone = getStoreTimeZone(tenantId);
  const fromYmd = localDate(from, zone);
  const toYmd = localDate(new Date(to.getTime() - 1), zone);
  // Cheap bound before the day list is built
  if (to.getTime() - from.getTime() > (MAX_REPORT_DAYS + 1) * DAY_MS) throw invalidRange(`The range is over ${MAX_REPORT_DAYS} days. Narrow it.`);
  const current = period(fromYmd, toYmd, zone);
  if (current.days.length > MAX_REPORT_DAYS) throw invalidRange(`The range is over ${MAX_REPORT_DAYS} days. Narrow it.`);
  // The first and last day keep the instants asked for (an ISO range may start mid-day)
  current.from = from;
  current.to = to;
  const prev = compare ? previousDays(fromYmd, toYmd) : null;
  return { ...current, zone, previous: prev ? period(prev.from, prev.to, zone) : null };
}

/** Run one block; a failure becomes `{ error: { code, errorId } }`. Only the message of an AppError below 500 is passed on. */
async function isolate<T>(name: string, tenantId: string, build: () => Promise<T>): Promise<Block<T>> {
  try {
    return await build();
  } catch (error: any) {
    const errorId = randomUUID();
    logger.error('Report block failed', { block: name, tenantId, errorId, error: error?.message, stack: error?.stack });
    const safe = error instanceof AppError && error.statusCode < 500;
    return { error: { code: 'block_failed', errorId, ...(safe ? { message: error.message } : {}) } };
  }
}

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined;
  return () => (promise ??= fn());
}

// ---------------------------------------------------------------------------------------------------------
// Small shapes shared by the tabs
// ---------------------------------------------------------------------------------------------------------

/** A count with its previous value and the change in percent (null when there is no previous period or it was 0). */
function counted(value: number, previous: number | null) {
  return { value, previous, deltaPercent: previous === null ? null : changePercent(value, previous) };
}

/** Same for money strings. */
function moneyTile(value: string, previous: string | null) {
  return { value, previous, deltaPercent: previous === null ? null : changePercent(Number(value), Number(previous)) };
}

/** A rate with its previous value and the change in points (1 decimal). */
function rateTile(value: number | null, previous: number | null | undefined) {
  const p = previous === undefined ? null : previous;
  return { value, previous: p, deltaPoints: value === null || p === null ? null : Math.round((value - p) * 10) / 10 };
}

function sharePercent(part: number | string, whole: number | string): number | null {
  return ratePercent(Number(part), Number(whole));
}

const average = (revenue: Money.Money, orders: number): string | null =>
  orders > 0 ? Money.toApi(Money.roundHalfUp(Money.div(revenue, orders), 2)) : null;

/** Targets the tiles are read against: the Dashboard's (leadership.ts), at the last day of the range or today. */
async function targetsOf(tenantId: string, r: ReportRange) {
  const today = localDate(new Date(), r.zone);
  const asOf = r.toYmd > today ? today : r.toYmd;
  const l = await leadership(tenantId, asOf);
  const { confirmationTarget, successTarget } = l.ordersNeededPerDay.detail as { confirmationTarget: number; successTarget: number };
  return { confirmationTarget, successTarget, monthRevenue: l.attainment.month.target };
}

/** Days of a period lined up with the days of the current one by position (day 3 against day 3). */
function previousDayAt(r: ReportRange, i: number): string | null {
  return r.previous?.days[i] ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// Overview (F-1051, F-1064)
// ---------------------------------------------------------------------------------------------------------

type Segment = 'delivered' | 'failed' | 'returned' | 'outForDelivery' | 'waitingToDispatch' | 'pendingCall' | 'cancelled' | 'other';
const SEGMENT_OF: Record<OrderStatus, Segment> = {
  delivered: 'delivered',
  failed_delivery: 'failed',
  returned: 'returned',
  out_for_delivery: 'outForDelivery',
  confirmed: 'waitingToDispatch',
  preparing: 'waitingToDispatch',
  ready_for_pickup: 'waitingToDispatch',
  pending_confirmation: 'pendingCall',
  cancelled: 'cancelled',
  payment_pending: 'other',
  payment_failed: 'other',
  digital_delivered: 'other',
};
const SEGMENTS: Segment[] = ['delivered', 'failed', 'returned', 'outForDelivery', 'waitingToDispatch', 'pendingCall', 'cancelled', 'other'];

/** Everything the Overview needs for one period. */
async function overviewFigures(tenantId: string, p: Period) {
  const [r, revenue, byDay, placed, confirmed] = await Promise.all([
    rates(tenantId, p.from, p.to, { basis: 'cohort' }),
    deliveredRevenue(tenantId, p.from, p.to),
    deliveredRevenueByDay(tenantId, p.from, p.to),
    ordersPlacedByDay(tenantId, p.from, p.to),
    confirmedPlacedByDay(tenantId, p.from, p.to),
  ]);
  return {
    rates: r,
    revenue,
    revenueByDay: new Map(byDay.map((d) => [d.date, d])),
    placedByDay: new Map(placed.map((d) => [d.date, d.count])),
    confirmedByDay: new Map(confirmed.map((d) => [d.date, d.count])),
  };
}
type OverviewFigures = Awaited<ReturnType<typeof overviewFigures>>;

function dayRow(f: OverviewFigures, date: string) {
  return {
    date,
    orders: f.placedByDay.get(date) ?? 0,
    confirmed: f.confirmedByDay.get(date) ?? 0,
    delivered: f.revenueByDay.get(date)?.deliveredOrders ?? 0,
    revenue: f.revenueByDay.get(date)?.revenue ?? '0.00',
  };
}

function overviewTiles(c: OverviewFigures, p: OverviewFigures | null, t: Awaited<ReturnType<typeof targetsOf>>, currency: string) {
  const conf = c.rates.confirmationRate;
  const success = c.rates.deliverySuccessRate;
  const pConf = p?.rates.confirmationRate;
  const pSuccess = p?.rates.deliverySuccessRate;
  return {
    currency,
    /** Orders placed in the range (cohort), the same count the Dashboard confirmation rate is read from. */
    orders: counted(conf.detail?.placed ?? 0, p ? (pConf?.detail?.placed ?? 0) : null),
    confirmed: {
      ...counted(conf.detail?.confirmed ?? 0, p ? (pConf?.detail?.confirmed ?? 0) : null),
      confirmationRate: { ...rateTile(conf.value, p ? pConf?.value ?? null : undefined), target: t.confirmationTarget, tag: rateTag(conf.value, t.confirmationTarget) },
    },
    delivered: {
      /** Delivered orders by delivery date, the count behind the revenue below. */
      ...counted(c.revenue.deliveredOrders.value, p ? p.revenue.deliveredOrders.value : null),
      dateBasis: 'deliveryDate',
      deliverySuccessRate: {
        ...rateTile(success.value, p ? pSuccess?.value ?? null : undefined),
        target: t.successTarget, tag: rateTag(success.value, t.successTarget), basis: 'cohort',
        delivered: success.detail?.delivered ?? 0, closed: success.detail?.closed ?? 0,
      },
    },
    deliveredRevenue: { ...moneyTile(c.revenue.total.value, p ? p.revenue.total.value : null), monthTarget: t.monthRevenue },
    orderToCashYield: rateTile(c.rates.orderToCashYield.value, p ? p.rates.orderToCashYield.value : undefined),
  };
}

function endedUp(c: OverviewFigures, statuses: Map<OrderStatus, number>) {
  const counts = new Map<Segment, number>(SEGMENTS.map((s) => [s, 0]));
  for (const [status, n] of statuses) counts.set(SEGMENT_OF[status], (counts.get(SEGMENT_OF[status]) ?? 0) + n);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    total,
    segments: SEGMENTS.map((key) => ({ key, count: counts.get(key) ?? 0, percent: sharePercent(counts.get(key) ?? 0, total) })),
    /** The note under the chart: "48% success, 34% yield". */
    deliverySuccessRate: c.rates.deliverySuccessRate.value,
    orderToCashYield: c.rates.orderToCashYield.value,
  };
}

function dailyTable(r: ReportRange, c: OverviewFigures, p: OverviewFigures | null) {
  const rows = r.days.map((date, i) => {
    const prevDate = previousDayAt(r, i);
    return { ...dayRow(c, date), previous: p && prevDate ? dayRow(p, prevDate) : null };
  });
  return {
    rows,
    total: {
      orders: c.rates.confirmationRate.detail?.placed ?? 0,
      confirmed: c.rates.confirmationRate.detail?.confirmed ?? 0,
      delivered: c.revenue.deliveredOrders.value,
      revenue: c.revenue.total.value,
      previous: p ? {
        orders: p.rates.confirmationRate.detail?.placed ?? 0,
        confirmed: p.rates.confirmationRate.detail?.confirmed ?? 0,
        delivered: p.revenue.deliveredOrders.value,
        revenue: p.revenue.total.value,
      } : null,
    },
  };
}

export async function overviewReport(tenantId: string, r: ReportRange): Promise<ReportBody> {
  const currency = await currencyOfTenant(tenantId);
  const current = once(() => overviewFigures(tenantId, r));
  const previous = once(async () => (r.previous ? overviewFigures(tenantId, r.previous) : null));
  const targets = once(() => targetsOf(tenantId, r));
  const [tiles, ended, daily] = await Promise.all([
    isolate('tiles', tenantId, async () => overviewTiles(await current(), await previous(), await targets(), currency)),
    isolate('endedUp', tenantId, async () => {
      const [c, statuses] = await Promise.all([current(), ordersByStatus(tenantId, r.from, r.to)]);
      return endedUp(c, statuses);
    }),
    isolate('daily', tenantId, async () => dailyTable(r, await current(), await previous())),
  ]);
  return { ...head('overview', r, currency), tiles, endedUp: ended, daily };
}

// ---------------------------------------------------------------------------------------------------------
// Sales (F-1052, F-1064)
// ---------------------------------------------------------------------------------------------------------

async function salesFigures(tenantId: string, p: Period) {
  const [revenue, byDay] = await Promise.all([deliveredRevenue(tenantId, p.from, p.to), deliveredRevenueByDay(tenantId, p.from, p.to)]);
  return { revenue, aov: deliveredAov(revenue), byDay: new Map(byDay.map((d) => [d.date, d.revenue])) };
}
type SalesFigures = Awaited<ReturnType<typeof salesFigures>>;

export async function salesReport(tenantId: string, r: ReportRange, access: ReportAccess = { cash: true }): Promise<ReportBody> {
  const currency = await currencyOfTenant(tenantId);
  const current = once(() => salesFigures(tenantId, r));
  const previous = once(async (): Promise<SalesFigures | null> => (r.previous ? salesFigures(tenantId, r.previous) : null));

  const tiles = () => isolate('tiles', tenantId, async () => {
    const [c, p, thirty] = await Promise.all([
      current(), previous(),
      // The 30 days that end with the range: the figure the planned AOV default is made from (F-1113)
      deliveredRevenue(tenantId, addDays(r.to, -30), r.to).then(deliveredAov),
    ]);
    const base = {
      currency,
      deliveredRevenue: moneyTile(c.revenue.total.value, p ? p.revenue.total.value : null),
      deliveredOrders: counted(c.revenue.deliveredOrders.value, p ? p.revenue.deliveredOrders.value : null),
      aov: {
        value: c.aov.value, previous: p ? p.aov.value : null,
        deltaAmount: p && c.aov.value !== null && p.aov.value !== null ? Money.toApi(Money.sub(c.aov.value, p.aov.value)) : null,
      },
      thirtyDayAov: { value: thirty.value, from: thirty.from, to: thirty.to, deliveredOrders: thirty.detail?.deliveredOrders ?? 0 },
    };
    if (!access.cash) return base;
    const [received, previousReceived, held] = await Promise.all([
      cashReceived(tenantId, r.from, r.to),
      r.previous ? cashReceived(tenantId, r.previous.from, r.previous.to) : null,
      cashHeldByPartners(tenantId),
    ]);
    return {
      ...base,
      cashReceived: {
        ...moneyTile(received.value, previousReceived ? previousReceived.value : null),
        percentOfDeliveredRevenue: sharePercent(received.value, c.revenue.total.value),
      },
      /** A snapshot of today: it has no previous period. */
      cashWithPartners: { value: held.value, partners: held.detail?.partners ?? 0 },
    };
  });

  const revenuePerDay = () => isolate('revenuePerDay', tenantId, async () => {
    const [c, p] = await Promise.all([current(), previous()]);
    return {
      rows: r.days.map((date, i) => {
        const prevDate = previousDayAt(r, i);
        return {
          date, revenue: c.byDay.get(date) ?? '0.00',
          previous: p && prevDate ? { date: prevDate, revenue: p.byDay.get(prevDate) ?? '0.00' } : null,
        };
      }),
    };
  });

  const byProduct = () => isolate('byProduct', tenantId, async () => {
    const units = await productDeliveredUnits(tenantId, 'all', r.from, r.to);
    const total = units.lineRevenue.value;
    return {
      rows: (units.byProduct ?? []).map((l) => ({ ...l, revenue: l.lineRevenue, sharePercent: sharePercent(l.lineRevenue, total) })),
      total,
    };
  });

  const byState = () => isolate('byState', tenantId, async () => {
    const states = await deliveredRevenueByState(tenantId, r.from, r.to);
    // Blank and missing states are one "Not set" row; "Greater Accra (Tema)" counts as "Greater Accra" (baseState)
    const merged = new Map<string, { revenue: Money.Money; delivered: number }>();
    for (const a of states) {
      const state = baseState(a.state) || 'Not set';
      const m = merged.get(state) ?? { revenue: Money.ZERO, delivered: 0 };
      merged.set(state, { revenue: Money.add(m.revenue, a.revenue), delivered: m.delivered + a.deliveredOrders });
    }
    const total = Money.sum([...merged.values()].map((m) => m.revenue));
    const delivered = [...merged.values()].reduce((n, m) => n + m.delivered, 0);
    const rows = [...merged.entries()]
      .sort(([, a], [, b]) => Money.compare(b.revenue, a.revenue))
      .map(([state, m]) => ({
        state, delivered: m.delivered, revenue: Money.toApi(m.revenue),
        averageOrder: average(m.revenue, m.delivered), sharePercent: sharePercent(Money.toApi(m.revenue), Money.toApi(total)),
      }));
    return { label: 'State', rows, total: { delivered, revenue: Money.toApi(total), averageOrder: average(total, delivered) } };
  });

  const [t, perDay, product, state] = await Promise.all([tiles(), revenuePerDay(), byProduct(), byState()]);
  return { ...head('sales', r, currency), tiles: t, revenuePerDay: perDay, byProduct: product, byState: state };
}

// ---------------------------------------------------------------------------------------------------------
// Delivery (F-1053, F-1064)
// ---------------------------------------------------------------------------------------------------------

export async function deliveryReport(tenantId: string, r: ReportRange, access: ReportAccess = { cash: true }): Promise<ReportBody> {
  const currency = await currencyOfTenant(tenantId);
  const current = once(async () => {
    const [rt, byDay] = await Promise.all([rates(tenantId, r.from, r.to, { basis: 'cohort' }), deliveredRevenueByDay(tenantId, r.from, r.to)]);
    return { rates: rt, delivered: new Map(byDay.map((d) => [d.date, d.deliveredOrders])) };
  });
  const previous = once(async () => {
    if (!r.previous) return null;
    const [rt, byDay] = await Promise.all([rates(tenantId, r.previous.from, r.previous.to, { basis: 'cohort' }), deliveredRevenueByDay(tenantId, r.previous.from, r.previous.to)]);
    return { rates: rt, delivered: new Map(byDay.map((d) => [d.date, d.deliveredOrders])) };
  });
  const targets = once(() => targetsOf(tenantId, r));
  const reasons = once(() => failureReasons(tenantId, r.from, r.to));
  const outNow = once(() => outForDelivery(tenantId));
  const partners = once(() => partnerRates(tenantId, r.from, r.to));
  const paysIn = once(() => partnerPaysInDays(tenantId, r.from, r.to));

  const tiles = () => isolate('tiles', tenantId, async () => {
    const [c, p, t, why, out, pr, pays] = await Promise.all([current(), previous(), targets(), reasons(), outNow(), partners(), paysIn()]);
    const success = c.rates.deliverySuccessRate;
    const failed = success.detail?.failed ?? 0;
    const returned = success.detail?.returned ?? 0;
    const notReachable = why.find((x) => x.reason === 'not_reachable')?.count ?? 0;
    const slowest = [...pr].filter((x) => pays.has(x.partnerId)).sort((a, b) => (pays.get(b.partnerId) as number) - (pays.get(a.partnerId) as number))[0];
    return {
      currency,
      deliverySuccessRate: {
        ...rateTile(success.value, p ? p.rates.deliverySuccessRate.value : undefined),
        target: t.successTarget, tag: rateTag(success.value, t.successTarget), basis: 'cohort',
        delivered: success.detail?.delivered ?? 0, closed: success.detail?.closed ?? 0,
      },
      /** Failed and returned are separate numbers (never "402" alone, section 4 item 30). */
      failed: counted(failed, p ? (p.rates.deliverySuccessRate.detail?.failed ?? 0) : null),
      returned: counted(returned, p ? (p.rates.deliverySuccessRate.detail?.returned ?? 0) : null),
      /** Share of failed and returned orders whose reason is "not reachable". */
      notReachable: { count: notReachable, percentOfFailedAndReturned: sharePercent(notReachable, failed + returned) },
      outForDeliveryNow: { value: out.total, partners: out.byPartner.size },
      slowestPaysIn: slowest ? { partnerId: slowest.partnerId, name: slowest.name, days: pays.get(slowest.partnerId) as number } : null,
    };
  });

  const deliveredPerDay = () => isolate('deliveredPerDay', tenantId, async () => {
    const [c, p] = await Promise.all([current(), previous()]);
    return {
      rows: r.days.map((date, i) => {
        const prevDate = previousDayAt(r, i);
        return { date, delivered: c.delivered.get(date) ?? 0, previous: p && prevDate ? { date: prevDate, delivered: p.delivered.get(prevDate) ?? 0 } : null };
      }),
    };
  });

  const reasonsBlock = () => isolate('reasons', tenantId, async () => {
    const why = await reasons();
    const total = why.reduce((n, x) => n + x.count, 0);
    return { total, rows: why.map((x) => ({ ...x, percent: sharePercent(x.count, total) })) };
  });

  const regionSuccess = () => isolate('successByState', tenantId, async () => {
    const [states, t] = await Promise.all([successByState(tenantId, r.from, r.to), targets()]);
    return {
      label: 'State',
      target: t.successTarget,
      rows: states
        .map((x) => ({
          state: x.state, placed: x.placed,
          delivered: x.deliverySuccessRate.detail?.delivered ?? 0,
          failed: x.deliverySuccessRate.detail?.failed ?? 0,
          returned: x.deliverySuccessRate.detail?.returned ?? 0,
          closed: x.deliverySuccessRate.detail?.closed ?? 0,
          successRate: x.deliverySuccessRate.value,
        }))
        .sort((a, b) => b.closed - a.closed || a.state.localeCompare(b.state)),
    };
  });

  const waitingAndReturns = () => isolate('waitingAndReturns', tenantId, async () => {
    const [waiting, c] = await Promise.all([waitingToDispatch(tenantId), current()]);
    return { waiting: { count: waiting.count.value, oldestDays: waiting.oldestDays }, returned: { count: c.rates.deliverySuccessRate.detail?.returned ?? 0 } };
  });

  const partnerTable = () => isolate('partners', tenantId, async () => {
    // Cash held is finance data: without financial:view the field is absent, not zero
    const [pr, out, held, pays, c, totalHeld] = await Promise.all([
      partners(), outNow(), access.cash ? cashHeldByPartner(tenantId) : null, paysIn(), current(), access.cash ? cashHeldByPartners(tenantId) : null,
    ]);
    const rows = pr.map((x) => {
      const d = x.deliverySuccessRate.detail ?? {};
      return {
        partnerId: x.partnerId, name: x.name, assigned: x.assigned,
        delivered: d.delivered ?? 0, failedOrReturned: (d.failed ?? 0) + (d.returned ?? 0), outNow: out.byPartner.get(x.partnerId) ?? 0,
        closed: d.closed ?? 0,
        /** Null when the partner has no closed order yet ("No closed orders yet"). */
        successRate: x.deliverySuccessRate.value,
        confirmedToDispatchedDays: x.confirmedToDispatchedDays.value,
        dispatchedToDeliveredDays: x.dispatchedToDeliveredDays.value,
        ...(held ? { cashHeld: held.get(x.partnerId) ?? '0.00' } : {}),
        paysInDays: pays.get(x.partnerId) ?? null,
      };
    });
    const success = c.rates.deliverySuccessRate;
    return {
      rows,
      total: {
        assigned: rows.reduce((n, x) => n + x.assigned, 0),
        delivered: success.detail?.delivered ?? 0,
        failedOrReturned: (success.detail?.failed ?? 0) + (success.detail?.returned ?? 0),
        outNow: out.total,
        successRate: success.value,
        ...(totalHeld ? { cashHeld: totalHeld.value } : {}),
      },
    };
  });

  const [t, perDay, why, state, waiting, table] = await Promise.all([
    tiles(), deliveredPerDay(), reasonsBlock(), regionSuccess(), waitingAndReturns(), partnerTable(),
  ]);
  return { ...head('delivery', r, currency), tiles: t, deliveredPerDay: perDay, reasons: why, successByState: state, waitingAndReturns: waiting, partners: table };
}

// ---------------------------------------------------------------------------------------------------------

function head(tab: ReportTab, r: ReportRange, currency: string): Pick<ReportBody, 'tab' | 'range' | 'compare' | 'generatedAt' | 'currency'> {
  return {
    tab,
    range: { from: r.fromYmd, to: r.toYmd, days: r.days.length, timeZone: r.zone },
    compare: r.previous ? { from: r.previous.fromYmd, to: r.previous.toYmd, days: r.previous.days.length } : null,
    generatedAt: new Date().toISOString(),
    currency,
  };
}

export function buildReport(tab: ReportTab, tenantId: string, r: ReportRange, access: ReportAccess): Promise<ReportBody> {
  switch (tab) {
    case 'overview': return overviewReport(tenantId, r);
    case 'sales': return salesReport(tenantId, r, access);
    case 'delivery': return deliveryReport(tenantId, r, access);
  }
}
