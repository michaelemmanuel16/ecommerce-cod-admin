/**
 * M5-T27 (COD-52, F-928, F-929): cash position, 30-day forecast and the revenue and expense trend.
 *
 * Cash buckets (F-928): each unit of money sits in one bucket only.
 *   cash at bank and MoMo  = GL 1010
 *   cash with partners     = GL 1015 (net of the fees the partners keep)
 *   position               = 1010 + 1015. GL 1020 is not read at all: since M5 it holds 0, and before the fix it counted money twice.
 *   expected               = orders out for delivery. A forecast item, never part of cash.
 * The old report summed order totals for "cash in transit" next to GL 1010; a deposit moved the cash into 1010 but left
 * the order in that sum, so one order was in two buckets.
 */
import prisma from '../../utils/prisma';
import * as Money from '../../utils/money';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { getTenantId, resolveTenantId } from '../../utils/tenantContext';
import { OPEN_COLLECTION_STATUSES, outstandingOf } from '../../utils/collectionCash';
import { DAY_MS, getStoreTimeZone, localDate, weekRange } from '../kpi/dates';
import { deliveredRevenueByDay, revenueScope } from '../kpi/revenue';
import { rates } from '../kpi/rates';
import { successTargetPct } from '../kpi/successTarget';
import { invalidRange } from '../../utils/kpiRequest';

import { DEFAULT_DAYS_TO_PAY } from '../orderPaymentTag';

/** Days a partner takes to pay when there is no settlement history yet (F-928); one default with the payment tag. */
export { DEFAULT_DAYS_TO_PAY };

/** A range longer than this many days is grouped by week (F-929). */
export const TREND_WEEKLY_AFTER_DAYS = 366;

export interface CashBuckets {
  cashAtBank: Money.Money;
  cashWithPartners: Money.Money;
  expectedFromOutForDelivery: Money.Money;
  cashAvailableNow: Money.Money;
  totalCashPosition: Money.Money;
  /** Position plus what is expected from orders out for delivery. A forecast figure, labelled as such. */
  totalCashPipeline: Money.Money;
}

/** The disjoint buckets from the ledger balances and the expected amount. Pure. */
export function cashBuckets(input: { cash1010: Money.MoneyInput; cash1015: Money.MoneyInput; expected: Money.MoneyInput }): CashBuckets {
  const cashAtBank = Money.parse(input.cash1010);
  const cashWithPartners = Money.parse(input.cash1015);
  const expected = Money.parse(input.expected);
  const position = Money.add(cashAtBank, cashWithPartners);
  return {
    cashAtBank, cashWithPartners, expectedFromOutForDelivery: expected,
    cashAvailableNow: cashAtBank,
    totalCashPosition: position,
    totalCashPipeline: Money.add(position, expected),
  };
}

export interface CashBalances { cash1010: Money.Money; cash1015: Money.Money; payables2050: Money.Money }

/** The three ledger balances the report and the forecast need, in one read. */
export async function cashBalances(): Promise<CashBalances> {
  const rows = await prisma.account.findMany({
    where: { tenantId: resolveTenantId(), code: { in: [GL_ACCOUNTS.CASH_IN_HAND, GL_ACCOUNTS.CASH_IN_TRANSIT, GL_ACCOUNTS.SUPPLIER_PAYABLES] } },
    select: { code: true, currentBalance: true },
  });
  const of = (code: string) => Money.orZero(rows.find((r) => r.code === code)?.currentBalance);
  const payables = of(GL_ACCOUNTS.SUPPLIER_PAYABLES);
  // Payables are 0 until a shipment has unpaid terms (decision R4); a debit balance is never shown as money owed.
  return { cash1010: of(GL_ACCOUNTS.CASH_IN_HAND), cash1015: of(GL_ACCOUNTS.CASH_IN_TRANSIT), payables2050: payables.isNegative() ? Money.ZERO : payables };
}

/** Order totals out for delivery: expected, not cash. */
export async function expectedFromOutForDelivery(): Promise<Money.Money> {
  const out = await prisma.order.aggregate({
    where: { status: 'out_for_delivery', deletedAt: null, codAmount: { not: null } },
    _sum: { totalAmount: true },
  });
  return Money.orZero(out._sum.totalAmount);
}

export interface PayDays {
  /** Average over all partners with history; the default when none has any. */
  overall: number;
  fromHistory: boolean;
  byPartner: Map<number, number>;
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * Average days from delivery to payout, from settlement history: for each matched settlement line, the payout date less the
 * delivery date of its order. Per partner, and overall. No history gives the default of 7 days.
 */
export async function partnerPayDays(): Promise<PayDays> {
  const lines = await prisma.partnerSettlementLine.findMany({
    where: { orderId: { not: null }, order: { deliveryDate: { not: null } } },
    select: { settlement: { select: { partnerId: true, payoutDate: true } }, order: { select: { deliveryDate: true } } },
    orderBy: { id: 'desc' },
    take: 5000,
  });
  const byPartner = new Map<number, { sum: number; count: number }>();
  let sum = 0;
  let count = 0;
  for (const l of lines) {
    const days = Math.max((l.settlement.payoutDate.getTime() - l.order!.deliveryDate!.getTime()) / DAY_MS, 0);
    const p = byPartner.get(l.settlement.partnerId) ?? { sum: 0, count: 0 };
    p.sum += days;
    p.count += 1;
    byPartner.set(l.settlement.partnerId, p);
    sum += days;
    count += 1;
  }
  return {
    overall: count > 0 ? oneDecimal(sum / count) : DEFAULT_DAYS_TO_PAY,
    fromHistory: count > 0,
    byPartner: new Map([...byPartner].map(([id, p]) => [id, oneDecimal(p.sum / p.count)])),
  };
}

/** The two forecast scenarios (F-928): today's pace, or delivery success at the target. The target changes only the inflow of new deliveries. */
export const SCENARIOS = ['pace', 'target'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface ScenarioInfo {
  key: Scenario;
  /** Delivery success of the last 30 days (closed orders), for both scenarios so the pace label can name it. Null when no order closed. */
  currentRate: number | null;
  /** The store's delivery success target (successTargetPct). */
  targetRate: number;
  /** What the new-delivery inflow is multiplied by: target / current, and 1 for today's pace, no closed orders, or a rate already at the target. */
  multiplier: number;
}

/** The scenario from a query value; a value that is not one of SCENARIOS is a 400. Left out means today's pace. */
export function parseScenario(value: unknown): Scenario {
  if (value === undefined) return 'pace';
  if (!(SCENARIOS as readonly unknown[]).includes(value)) throw invalidRange('scenario must be pace or target');
  return value as Scenario;
}

/** The scenario's multiplier on the new-delivery inflow. Pure. */
export function scenarioMultiplier(key: Scenario, currentRate: number | null, targetRate: number): number {
  if (key !== 'target' || currentRate === null || currentRate <= 0 || currentRate >= targetRate) return 1;
  return Money.roundHalfUp(Money.div(targetRate, currentRate), 4).toNumber();
}

/** The scenario with the store's target and the delivery success of the last 30 days (KPI layer). Only the target scenario scales the inflow. */
export async function forecastScenario(key: Scenario, now: Date = new Date()): Promise<ScenarioInfo> {
  const tenantId = resolveTenantId();
  const targetRate = await successTargetPct(tenantId, now);
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const current = (await rates(tenantId, since, now, { basis: 'delivery' })).deliverySuccessRate.value;
  return { key, currentRate: current, targetRate, multiplier: scenarioMultiplier(key, current, targetRate) };
}

export interface ForecastDay {
  date: string;
  expectedCollection: Money.Money;
  expectedExpense: Money.Money;
  projectedBalance: Money.Money;
}

/**
 * The next 30 days from balances and pay days the caller already read. Starts from cash at bank (1010). Inflows:
 *   - cash the partners hold (1015) arrives per open collection on its delivery date plus the partner's average days to pay;
 *   - deliveries from now on arrive after the average days to pay, at the pace of the last 30 days.
 * Outflows: the average daily expense of the last 30 days, and supplier payables (2050) on the first day. The balance is not
 * floored at 0: a negative balance is shown.
 */
export async function buildForecast(input: { balances: CashBalances; payDays: PayDays; now?: Date; paceMultiplier?: number }): Promise<ForecastDay[]> {
  const { balances, payDays } = input;
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [collected, spent, collections] = await Promise.all([
    prisma.transaction.aggregate({
      where: { type: 'cod_collection', status: { in: ['collected', 'deposited', 'reconciled'] }, createdAt: { gte: since }, order: { deletedAt: null } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({ where: { expenseDate: { gte: since } }, _sum: { amount: true } }),
    prisma.agentCollection.findMany({
      where: { status: { in: [...OPEN_COLLECTION_STATUSES] }, order: { deletedAt: null } },
      select: { agentId: true, amount: true, allocatedAmount: true, collectionDate: true },
    }),
  ]);
  // The scenario scales only what new deliveries bring in: partner cash already held and every outflow stay as they are
  const avgDailyCollection = Money.mul(Money.div(Money.orZero(collected._sum.amount), 30), input.paceMultiplier ?? 1);
  const avgDailyExpense = Money.div(Money.orZero(spent._sum.amount), 30);

  // Partner cash by arrival day (1..30). Days past the horizon are left out.
  const arrivals: Money.Money[] = Array.from({ length: 31 }, () => Money.ZERO);
  const held = balances.cash1015;
  const open = collections.map((c) => ({ ...c, left: outstandingOf(c) })).filter((c) => c.left.gt(0));
  if (held.gt(0)) {
    const totalLeft = Money.sum(open.map((c) => c.left));
    if (totalLeft.isZero()) {
      const day = Math.max(1, Math.round(payDays.overall));
      if (day <= 30) arrivals[day] = Money.add(arrivals[day], held);
    } else {
      for (const c of open) {
        const days = payDays.byPartner.get(c.agentId) ?? payDays.overall;
        const arrives = c.collectionDate.getTime() + days * DAY_MS;
        const day = Math.max(1, Math.ceil((arrives - now.getTime()) / DAY_MS));
        if (day <= 30) arrivals[day] = Money.add(arrivals[day], Money.mul(held, Money.div(c.left, totalLeft)));
      }
    }
  }

  const paceFrom = Math.max(1, Math.round(payDays.overall)) + 1;
  const forecast: ForecastDay[] = [];
  let balance = balances.cash1010;
  for (let i = 1; i <= 30; i++) {
    const date = new Date(now.getTime() + i * DAY_MS);
    const inflow = Money.add(arrivals[i], i >= paceFrom ? avgDailyCollection : Money.ZERO);
    const outflow = Money.add(avgDailyExpense, i === 1 ? balances.payables2050 : Money.ZERO);
    balance = Money.add(balance, Money.sub(inflow, outflow));
    forecast.push({ date: date.toISOString().split('T')[0], expectedCollection: inflow, expectedExpense: outflow, projectedBalance: balance });
  }
  return forecast;
}

/** Balances, pay days, the scenario and the 30 day forecast: what the report and the CSV export both stand on. */
export async function getCashForecast(scenarioKey: Scenario = 'pace') {
  const [balances, payDays, scenario] = await Promise.all([cashBalances(), partnerPayDays(), forecastScenario(scenarioKey)]);
  const forecast = await buildForecast({ balances, payDays, paceMultiplier: scenario.multiplier });
  return { balances, payDays, scenario, forecast };
}

export interface ForecastSummary {
  /** Cash at bank and MoMo (1010) on the first day. */
  cashToday: string;
  expectedIn: string;
  expectedOut: string;
  endDate: string;
  endBalance: string;
  lowest: { date: string; balance: string };
  /** First day the balance is below 0, or null. */
  runsOutOn: string | null;
  /** Days of expected spending under which the lowest point counts as tight (GUESS, owner sets). The page words it from this. */
  tightDays: number;
  /** safe; tight = the lowest point is under `tightDays` days of expected spending; runs_out = the balance goes below 0. */
  status: 'safe' | 'tight' | 'runs_out';
}

/** Days of spending a low point must cover to count as safe. */
export const TIGHT_DAYS = 7;

export interface ForecastWeek { from: string; to: string; moneyIn: string; moneyOut: string; net: string; cashAtEnd: string }

/** Tiles and the week-by-week table of a forecast. Pure: it only adds up the days. An empty forecast gives zeros. */
export function summarizeForecast(cashToday: Money.MoneyInput, forecast: ForecastDay[]): { summary: ForecastSummary; weeks: ForecastWeek[] } {
  const expectedIn = Money.sum(forecast.map((d) => d.expectedCollection));
  const expectedOut = Money.sum(forecast.map((d) => d.expectedExpense));
  const last = forecast[forecast.length - 1];
  const low = forecast.reduce<ForecastDay | null>((m, d) => (m === null || Money.lt(d.projectedBalance, m.projectedBalance) ? d : m), null);
  const runsOut = forecast.find((d) => Money.lt(d.projectedBalance, 0));
  const tightBelow = Money.mul(Money.div(expectedOut, Math.max(forecast.length, 1)), TIGHT_DAYS);
  const lowest = low ? Money.parse(low.projectedBalance) : Money.parse(cashToday);
  const weeks: ForecastWeek[] = [];
  for (let i = 0; i < forecast.length; i += 7) {
    const days = forecast.slice(i, i + 7);
    const moneyIn = Money.sum(days.map((d) => d.expectedCollection));
    const moneyOut = Money.sum(days.map((d) => d.expectedExpense));
    weeks.push({
      from: days[0].date, to: days[days.length - 1].date,
      moneyIn: Money.toApi(moneyIn), moneyOut: Money.toApi(moneyOut), net: Money.toApi(Money.sub(moneyIn, moneyOut)),
      cashAtEnd: Money.toApi(days[days.length - 1].projectedBalance),
    });
  }
  return {
    summary: {
      cashToday: Money.toApi(cashToday), expectedIn: Money.toApi(expectedIn), expectedOut: Money.toApi(expectedOut),
      endDate: last?.date ?? '', endBalance: Money.toApi(last?.projectedBalance ?? cashToday),
      lowest: { date: low?.date ?? '', balance: Money.toApi(lowest) },
      runsOutOn: runsOut?.date ?? null,
      tightDays: TIGHT_DAYS,
      status: lowest.isNegative() ? 'runs_out' : lowest.lt(tightBelow) ? 'tight' : 'safe',
    },
    weeks,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// F-929 revenue and expense trend
// ---------------------------------------------------------------------------------------------------------------------

export interface TrendRow {
  date: string;
  revenue: Money.Money;
  expenses: Money.Money;
  profit: Money.Money;
  orders: number;
}

export interface Trend {
  rows: TrendRow[];
  /** What each row's date stands for: a day, the Monday of a week (range over 366 days) or a month (period = monthly). */
  grouping: 'day' | 'week' | 'month';
}

/**
 * Delivered revenue per delivery date against the expenses booked per expense date, for [start, end] (inclusive). Days with
 * no data are left out (the chart shows them as 0). A range over 366 days groups by week (the Monday dates the week).
 * `period: 'monthly'` groups by month. A rep or partner sees only their own orders.
 */
export async function revenueExpenseTrend(opts: {
  start: Date; end: Date; period?: string; role?: { id?: number; role?: string } | null; expenseRecordedBy?: number;
}): Promise<Trend> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(getTenantId());
  const grouping = opts.period === 'monthly' ? 'month' : (opts.end.getTime() - opts.start.getTime()) / DAY_MS > TREND_WEEKLY_AFTER_DAYS ? 'week' : 'day';
  const keyOf = (ymd: string) => (grouping === 'month' ? ymd.slice(0, 7) : grouping === 'week' ? weekRange(ymd, zone).monday : ymd);
  const scope = opts.role?.role === 'sales_rep' ? { repId: opts.role.id }
    : opts.role?.role === 'delivery_agent' ? { partnerId: opts.role.id } : {};

  const [revenueDays, expenses] = await Promise.all([
    deliveredRevenueByDay(tenantId, opts.start, new Date(opts.end.getTime() + 1), revenueScope(scope)),
    prisma.expense.groupBy({
      by: ['expenseDate'],
      where: { expenseDate: { gte: opts.start, lte: opts.end }, ...(opts.expenseRecordedBy ? { recordedBy: opts.expenseRecordedBy } : {}) },
      _sum: { amount: true },
    }),
  ]);

  const grouped = new Map<string, { revenue: Money.Money; expenses: Money.Money; orders: number }>();
  const slot = (key: string) => {
    let g = grouped.get(key);
    if (!g) grouped.set(key, (g = { revenue: Money.ZERO, expenses: Money.ZERO, orders: 0 }));
    return g;
  };
  for (const d of revenueDays) {
    const g = slot(keyOf(d.date));
    g.revenue = Money.add(g.revenue, d.revenue);
    g.orders += d.deliveredOrders;
  }
  for (const e of expenses) {
    const g = slot(keyOf(localDate(e.expenseDate, zone)));
    g.expenses = Money.add(g.expenses, Money.orZero(e._sum.amount));
  }
  const rows = [...grouped.entries()]
    .map(([date, g]) => ({ date, revenue: g.revenue, expenses: g.expenses, profit: Money.sub(g.revenue, g.expenses), orders: g.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { rows, grouping };
}
