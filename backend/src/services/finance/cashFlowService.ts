/**
 * M5-T27 (COD-52, F-928, F-929): cash position, 30-day forecast and the revenue and expense trend.
 *
 * Cash buckets (F-928): each unit of money sits in one bucket only.
 *   cash at bank and MoMo  = GL 1010
 *   cash with partners     = GL 1015 (net of the fees the partners keep)
 *   position               = 1010 + 1015. GL 1020 is NOT added: since M5 it holds 0, and before the fix it counted money twice.
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

/** Days a partner takes to pay when there is no settlement history yet (F-928). */
export const DEFAULT_DAYS_TO_PAY = 7;

/** A range longer than this many days is grouped by week (F-929). */
export const TREND_WEEKLY_AFTER_DAYS = 366;

export interface CashBuckets {
  cashAtBank: Money.Money;
  cashWithPartners: Money.Money;
  /** GL 1020, shown for reference only. It is never part of cash. */
  receivablesAgents: Money.Money;
  expectedFromOutForDelivery: Money.Money;
  cashAvailableNow: Money.Money;
  totalCashPosition: Money.Money;
  /** Position plus what is expected from orders out for delivery. A forecast figure, labelled as such. */
  totalCashPipeline: Money.Money;
}

/** The disjoint buckets from the ledger balances and the expected amount. Pure. */
export function cashBuckets(input: {
  cash1010: Money.MoneyInput; cash1015: Money.MoneyInput; receivables1020?: Money.MoneyInput; expected: Money.MoneyInput;
}): CashBuckets {
  const cashAtBank = Money.orZero(input.cash1010);
  const cashWithPartners = Money.orZero(input.cash1015);
  const expected = Money.orZero(input.expected);
  const position = Money.add(cashAtBank, cashWithPartners);
  return {
    cashAtBank, cashWithPartners, receivablesAgents: Money.orZero(input.receivables1020), expectedFromOutForDelivery: expected,
    cashAvailableNow: cashAtBank,
    totalCashPosition: position,
    totalCashPipeline: Money.add(position, expected),
  };
}

export async function balanceOf(code: string): Promise<Money.Money> {
  const account = await prisma.account.findUnique({ where: { tenantId_code: { tenantId: resolveTenantId(), code } } });
  return Money.orZero(account?.currentBalance);
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
  const lines = (await prisma.partnerSettlementLine.findMany({
    where: { orderId: { not: null }, order: { deliveryDate: { not: null } } },
    select: { settlement: { select: { partnerId: true, payoutDate: true } }, order: { select: { deliveryDate: true } } },
    orderBy: { id: 'desc' },
    take: 5000,
  })) ?? [];
  const gaps = new Map<number, number[]>();
  const all: number[] = [];
  for (const l of lines) {
    if (!l.order?.deliveryDate) continue;
    const days = Math.max((l.settlement.payoutDate.getTime() - l.order.deliveryDate.getTime()) / DAY_MS, 0);
    all.push(days);
    gaps.set(l.settlement.partnerId, [...(gaps.get(l.settlement.partnerId) ?? []), days]);
  }
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  return {
    overall: all.length > 0 ? oneDecimal(mean(all)) : DEFAULT_DAYS_TO_PAY,
    fromHistory: all.length > 0,
    byPartner: new Map([...gaps].map(([id, xs]) => [id, oneDecimal(mean(xs))])),
  };
}

export interface CashFlowKpis extends CashBuckets {
  /** GL 2050. 0 until a shipment has unpaid terms (decision R4). */
  supplierPayables: Money.Money;
}

export async function cashFlowKpis(): Promise<CashFlowKpis> {
  const [cash1010, cash1015, receivables, payables, expected] = await Promise.all([
    balanceOf(GL_ACCOUNTS.CASH_IN_HAND),
    balanceOf(GL_ACCOUNTS.CASH_IN_TRANSIT),
    balanceOf(GL_ACCOUNTS.AR_AGENTS),
    balanceOf(GL_ACCOUNTS.SUPPLIER_PAYABLES),
    prisma.order.aggregate({
      where: { status: 'out_for_delivery', deletedAt: null, codAmount: { not: null } },
      _sum: { totalAmount: true },
    }),
  ]);
  return {
    ...cashBuckets({ cash1010, cash1015, receivables1020: receivables, expected: expected._sum.totalAmount ?? 0 }),
    supplierPayables: payables.isNegative() ? Money.ZERO : payables,
  };
}

export interface ForecastDay {
  date: string;
  expectedCollection: Money.Money;
  expectedExpense: Money.Money;
  projectedBalance: Money.Money;
}

/**
 * The next 30 days. Starts from cash at bank (1010). Inflows:
 *   - cash the partners hold (1015) arrives per open collection on its delivery date plus the partner's average days to pay;
 *   - deliveries from now on arrive after the average days to pay, at the pace of the last 30 days.
 * Outflows: the average daily expense of the last 30 days, and supplier payables (2050) on the first day. The balance is not
 * floored at 0: a negative balance is shown.
 */
export async function buildForecast(now: Date = new Date()): Promise<ForecastDay[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [cash, held, payables, payDays, collected, spent, collections] = await Promise.all([
    balanceOf(GL_ACCOUNTS.CASH_IN_HAND),
    balanceOf(GL_ACCOUNTS.CASH_IN_TRANSIT),
    balanceOf(GL_ACCOUNTS.SUPPLIER_PAYABLES),
    partnerPayDays(),
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
  const avgDailyCollection = Money.div(Money.orZero(collected?._sum?.amount ?? null), 30);
  const avgDailyExpense = Money.div(Money.orZero(spent?._sum?.amount ?? null), 30);

  // Partner cash by arrival day (1..30). Days past the horizon are left out.
  const arrivals: Money.Money[] = Array.from({ length: 31 }, () => Money.ZERO);
  const open = (collections ?? []).map((c) => ({ ...c, left: outstandingOf(c) })).filter((c) => c.left.gt(0));
  if (held.gt(0)) {
    const totalLeft = open.reduce((t, c) => Money.add(t, c.left), Money.ZERO);
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
  let balance = cash;
  for (let i = 1; i <= 30; i++) {
    const date = new Date(now.getTime() + i * DAY_MS);
    const inflow = Money.add(arrivals[i], i >= paceFrom ? avgDailyCollection : Money.ZERO);
    const outflow = Money.add(avgDailyExpense, i === 1 && payables.gt(0) ? payables : Money.ZERO);
    balance = Money.add(balance, Money.sub(inflow, outflow));
    forecast.push({ date: date.toISOString().split('T')[0], expectedCollection: inflow, expectedExpense: outflow, projectedBalance: balance });
  }
  return forecast;
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

/** 'week' when the range is longer than 366 days, else 'day'. */
export function trendGrouping(start: Date, end: Date): 'day' | 'week' {
  return (end.getTime() - start.getTime()) / DAY_MS > TREND_WEEKLY_AFTER_DAYS ? 'week' : 'day';
}

/**
 * Delivered revenue per delivery date against the expenses booked per expense date, for [start, end] (inclusive). Days with
 * no data are left out (the chart shows them as 0). A range over 366 days groups by week (the Monday dates the week).
 * `period: 'monthly'` groups by month. A rep or partner sees only their own orders.
 */
export async function revenueExpenseTrend(opts: {
  start: Date; end: Date; period?: string; role?: { id?: number; role?: string } | null; expenseRecordedBy?: number;
}): Promise<TrendRow[]> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(getTenantId());
  const grouping = trendGrouping(opts.start, opts.end);
  const keyOf = (ymd: string) => {
    if (opts.period === 'monthly') return ymd.slice(0, 7);
    return grouping === 'week' ? weekRange(ymd, zone).monday : ymd;
  };
  const scope = opts.role?.role === 'sales_rep' ? { repId: opts.role.id }
    : opts.role?.role === 'delivery_agent' ? { partnerId: opts.role.id } : {};

  const [revenueDays, expenses] = await Promise.all([
    deliveredRevenueByDay(tenantId, opts.start, new Date(opts.end.getTime() + 1), revenueScope(scope)),
    prisma.expense.findMany({
      where: { expenseDate: { gte: opts.start, lte: opts.end }, ...(opts.expenseRecordedBy ? { recordedBy: opts.expenseRecordedBy } : {}) },
      select: { amount: true, expenseDate: true },
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
    g.expenses = Money.add(g.expenses, e.amount);
  }
  return [...grouped.entries()]
    .map(([date, g]) => ({ date, revenue: g.revenue, expenses: g.expenses, profit: Money.sub(g.revenue, g.expenses), orders: g.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
