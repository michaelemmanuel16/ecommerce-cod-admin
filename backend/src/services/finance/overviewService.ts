/**
 * M5-T24 (COD-52, F-902, F-907, F-910, F-927): the Finance overview in one call. Six tiles, the payout reconciliation list,
 * unpaid delivered orders by age and cash runway.
 *
 * Nothing is computed twice: delivered revenue and AOV come from services/kpi, margin and expenses from the ledger reader
 * (statementsService), cash from the cash buckets, aging buckets from agingService. This file only assembles them.
 *
 * Date basis. The revenue, cash received, margin and profit per order tiles cover the range [from, to) the caller picked.
 * Cash outstanding, unpaid by age and cash runway are as of today (a balance has no range); each tile says which in its tooltip.
 * A tile that fails does not fail the call: it comes back as `{ status: 'error' }` and the other tiles are unaffected.
 * "n/a" is returned as the value (with `available: false`) when a figure has no basis, for example a margin on no revenue.
 */
import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import * as Money from '../../utils/money';
import { getTenantId, resolveTenantId } from '../../utils/tenantContext';
import { getCurrency } from '../../utils/currency';
import { fullName } from '../../utils/nameUtils';
import { formatOrderNumber } from '../../utils/orderNumber';
import { getStoreTimeZone, localDate, parseYmd, shiftYmd, startOfDay } from '../kpi/dates';
import { deliveredAov, deliveredRevenue } from '../kpi/revenue';
import { TARGET_NET_MARGIN, incomeStatementOver } from './statementsService';
import { cashBalances, cashBuckets } from './cashFlowService';
import agingService from '../agingService';

export const NOT_AVAILABLE = 'n/a';

/** Days of ad spend the runway divides by (decision "Seven-day average used for cash runway"). */
export const RUNWAY_AD_DAYS = 7;
/** Runway under this many days reads "Tight"; under the lower one "Critical". */
export const RUNWAY_TIGHT_DAYS = 14;
export const RUNWAY_CRITICAL_DAYS = 7;

/** Short partner rows list at most this many unpaid orders (the full list is on the Agent collections tab). */
const UNPAID_ROWS_PER_PARTNER = 10;
const SETTLEMENT_ROWS = 100;

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
type Value = string | number;

interface TileBase { key: string; label: string; tooltip: string; dateBasis: 'range' | 'today' }
export interface OkTile extends TileBase {
  status: 'ok';
  /** Money API string, a number (percent, days) or "n/a". */
  value: Value;
  unit: 'money' | 'percent' | 'days';
  available: boolean;
  tone: Tone;
  detail: Record<string, unknown>;
}
export interface ErrorTile { key: string; label: string; status: 'error'; message: string }
export type Tile = OkTile | ErrorTile;

type Failed = { status: 'error'; message: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (ymd: string) => { const { month, day } = parseYmd(ymd); return `${day} ${MONTHS[month - 1]}`; };

/** Run a source once, even when several tiles read it. Nothing starts until the first tile asks. */
const once = <T>(fn: () => Promise<T>) => { let p: Promise<T> | undefined; return () => (p ??= fn()); };

const failure = (what: string, error: unknown): Failed => {
  logger.error(`Finance overview: ${what} failed`, { error });
  return { status: 'error', message: 'This could not be loaded. Try again.' };
};

async function guarded<T>(what: string, fn: () => Promise<T>): Promise<T | Failed> {
  try { return await fn(); } catch (error) { return failure(what, error); }
}

const okTile = (t: Omit<OkTile, 'status' | 'available'> & { available?: boolean }): OkTile =>
  ({ status: 'ok', available: t.value !== NOT_AVAILABLE, ...t });

async function tile(key: string, label: string, build: () => Promise<OkTile>): Promise<Tile> {
  try { return await build(); } catch (error) { return { key, label, ...failure(`tile ${key}`, error) }; }
}

export interface OverviewOptions {
  from: Date;
  to: Date;
  /** Store day that stands for "today" (YYYY-MM-DD). Left out in the app; tests and past views pass it. */
  asOf?: string;
}

export async function financeOverview(opts: OverviewOptions) {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(getTenantId());
  const today = opts.asOf ?? localDate(new Date(), zone);
  const { from, to } = opts;
  const fromDay = localDate(from, zone);
  const toDay = localDate(new Date(to.getTime() - 1), zone);
  const span = `${dayLabel(fromDay)} to ${dayLabel(toDay)}`;

  // ---- Sources, each read once and only when a tile needs it ----
  const revenue = once(() => deliveredRevenue(tenantId, from, to));
  const statement = once(() => incomeStatementOver(from, to));
  const unpaid = once(() => agingService.getUnpaidByAge());
  const deposits = once(() => prisma.agentDeposit.aggregate({
    where: { status: 'verified', depositDate: { gte: from, lt: to } },
    _sum: { amount: true },
    _count: true,
  }));
  const runwayData = once(async () => {
    const [balances, ads] = await Promise.all([
      cashBalances(),
      // The last seven full store days before today
      incomeStatementOver(startOfDay(shiftYmd(today, -RUNWAY_AD_DAYS), zone), startOfDay(today, zone)),
    ]);
    const position = cashBuckets({ cash1010: balances.cash1010, cash1015: balances.cash1015, expected: Money.ZERO });
    const adsPerDay = Money.div(Money.parse(ads.metaSpend), RUNWAY_AD_DAYS);
    const cash = position.totalCashPosition;
    let days: number | null = null;
    if (adsPerDay.gt(0)) days = cash.lte(0) ? 0 : Money.div(cash, adsPerDay).floor().toNumber();
    const tone: Tone = days === null ? 'neutral' : days < RUNWAY_CRITICAL_DAYS ? 'bad' : days < RUNWAY_TIGHT_DAYS ? 'warn' : 'ok';
    return {
      days, tone,
      level: days === null ? 'no_ads' as const : days < RUNWAY_CRITICAL_DAYS ? 'critical' as const : days < RUNWAY_TIGHT_DAYS ? 'tight' as const : 'ok' as const,
      cash: Money.toApi(cash),
      cashAtBank: Money.toApi(position.cashAtBank),
      cashWithPartners: Money.toApi(position.cashWithPartners),
      adsPerDay: Money.toApi(adsPerDay),
      adDays: RUNWAY_AD_DAYS,
    };
  });

  // ---- Tiles ----
  const tiles = await Promise.all([
    tile('deliveredRevenue', 'Delivered revenue', async () => {
      const r = await revenue();
      const orders = r.deliveredOrders.value;
      const aov = deliveredAov(r).value;
      return okTile({
        key: 'deliveredRevenue', label: 'Delivered revenue', unit: 'money', dateBasis: 'range', tone: 'neutral',
        value: r.total.value,
        tooltip: `Orders delivered ${span}, counted on the delivery date. Includes paid digital orders. Returns leave in the month they come back.`,
        detail: { deliveredOrders: orders, averageOrderValue: aov ?? NOT_AVAILABLE, ofWhichDigital: r.digital.value, ofWhichPhysical: r.physical.value, currency: r.total.currency },
      });
    }),

    tile('cashReceived', 'Cash received', async () => {
      const [d, r] = await Promise.all([deposits(), revenue()]);
      const received = Money.orZero(d._sum.amount);
      return okTile({
        key: 'cashReceived', label: 'Cash received', unit: 'money', dateBasis: 'range', tone: 'ok',
        value: Money.toApi(received),
        tooltip: `Cash that delivery partners paid in ${span}, counted on the payout or deposit date. Only verified payouts count.`,
        detail: { payouts: d._count, percentOfDeliveredRevenue: Money.percentOrNull(received, r.total.value, 0) },
      });
    }),

    tile('cashOutstanding', 'Cash outstanding', async () => {
      const u = await unpaid();
      return okTile({
        key: 'cashOutstanding', label: 'Cash outstanding', unit: 'money', dateBasis: 'today',
        tone: u.overdue.orders > 0 ? 'warn' : 'ok',
        value: u.total.amount,
        tooltip: 'Delivered orders whose cash a partner still holds, as of today, net of the delivery fee the partner keeps. Not limited to the dates you picked.',
        detail: { orders: u.total.orders, overdueOrders: u.overdue.orders, overdueAmount: u.overdue.amount },
      });
    }),

    tile('netMargin', 'Net margin', async () => {
      const s = await statement();
      const pct = s.netMarginPct;
      return okTile({
        key: 'netMargin', label: 'Net margin', unit: 'percent', dateBasis: 'range',
        tone: pct === null ? 'neutral' : pct >= TARGET_NET_MARGIN ? 'ok' : pct >= 0 ? 'warn' : 'bad',
        value: pct ?? NOT_AVAILABLE,
        tooltip: `Net profit as a share of revenue, from the ledger entries dated ${span}. Product cost, delivery fees, Meta spend, rep commission, Paystack fees and other expenses are all taken off. Target ${TARGET_NET_MARGIN}%.`,
        detail: {
          target: TARGET_NET_MARGIN, netProfit: s.netProfit, revenue: s.revenue,
          expenses: {
            total: s.totalExpenses, productCost: s.productCost, deliveryFees: s.deliveryFees, metaSpend: s.metaSpend,
            repCommission: s.repCommission, paystackFees: s.paystackFees, other: s.otherExpenses,
          },
        },
      });
    }),

    tile('profitPerOrder', 'Profit per delivered order', async () => {
      const [s, r] = await Promise.all([statement(), revenue()]);
      const orders = r.deliveredOrders.value;
      const per = orders > 0 ? Money.roundHalfUp(Money.div(s.netProfit, orders), 2) : null;
      return okTile({
        key: 'profitPerOrder', label: 'Profit per delivered order', unit: 'money', dateBasis: 'range',
        tone: per === null ? 'neutral' : per.lt(0) ? 'bad' : 'ok',
        value: per === null ? NOT_AVAILABLE : Money.toApi(per),
        tooltip: `Net profit from the ledger entries dated ${span}, divided by the orders delivered in the same dates.`,
        detail: { netProfit: s.netProfit, deliveredOrders: orders },
      });
    }),

    tile('cashRunway', 'Cash runway', async () => {
      const w = await runwayData();
      return okTile({
        key: 'cashRunway', label: 'Cash runway', unit: 'days', dateBasis: 'today', tone: w.tone,
        value: w.days ?? NOT_AVAILABLE,
        tooltip: `Cash at bank and with partners as of today, divided by the average daily Meta spend of the last ${RUNWAY_AD_DAYS} days. How many days of ads the cash pays for.`,
        detail: { level: w.level, cash: w.cash, adsPerDay: w.adsPerDay, adDays: w.adDays },
      });
    }),
  ]);

  // ---- Sections ----
  const [reconciliation, unpaidByAge, runway] = await Promise.all([
    guarded('payout reconciliation', () => reconciliationOf(from, to, zone)),
    guarded('unpaid by age', async () => ({ ...(await unpaid()), dateBasis: 'today' as const })),
    guarded('cash runway', runwayData),
  ]);

  return {
    from: fromDay, to: toDay, asOf: today,
    currency: await getCurrency(),
    tiles,
    reconciliation,
    unpaidByAge,
    runway,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Payout reconciliation
// ---------------------------------------------------------------------------------------------------------------------

async function reconciliationOf(from: Date, to: Date, zone: string) {
  const settlements = await prisma.partnerSettlement.findMany({
    where: { payoutDate: { gte: from, lt: to } },
    orderBy: [{ payoutDate: 'desc' }, { id: 'desc' }],
    take: SETTLEMENT_ROWS,
    select: {
      id: true, partnerId: true, payoutDate: true, payoutAmount: true, expectedNet: true, shortAmount: true, unappliedAmount: true,
      status: true, reference: true,
      partner: { select: { firstName: true, lastName: true, kind: true } },
      lines: { select: { matched: true } },
    },
  });

  // A short payout opens to the partner's unpaid orders, oldest first
  const shortPartners = [...new Set(settlements.filter((s) => s.status === 'short').map((s) => s.partnerId))];
  const unpaidOrders = shortPartners.length > 0 ? await agingService.getUnpaidOrdersOf(shortPartners) : [];
  const shown = new Map<number, typeof unpaidOrders>();
  for (const o of unpaidOrders) {
    const list = shown.get(o.agentId) ?? [];
    if (list.length < UNPAID_ROWS_PER_PARTNER) list.push(o);
    shown.set(o.agentId, list);
  }
  const details = new Map(
    (await prisma.order.findMany({
      where: { id: { in: [...shown.values()].flat().map((o) => o.orderId) } },
      select: { id: true, deliveryArea: true, totalAmount: true, codAmount: true, deliveryFee: true, customer: { select: { firstName: true, lastName: true } } },
    })).map((o) => [o.id, o]),
  );

  const rows = settlements.map((s) => {
    const gap = Money.roundHalfUp(Money.sub(s.payoutAmount, s.expectedNet), 2);
    const partnerOrders = unpaidOrders.filter((o) => o.agentId === s.partnerId);
    return {
      id: s.id,
      date: s.payoutDate.toISOString().slice(0, 10),
      reference: s.reference,
      partnerId: s.partnerId,
      partnerName: fullName(s.partner) || `Partner #${s.partnerId}`,
      partnerKind: s.partner.kind,
      paidIn: Money.toApi(s.payoutAmount),
      expectedAfterFees: Money.toApi(s.expectedNet),
      orders: s.lines.filter((l) => l.matched).length,
      status: s.status,
      shortAmount: Money.toApi(s.shortAmount),
      overAmount: Money.toApi(gap.gt(0) ? gap : Money.ZERO),
      unappliedAmount: Money.toApi(s.unappliedAmount),
      unpaid: s.status === 'short'
        ? {
          orders: partnerOrders.length,
          amount: Money.toApi(Money.sum(partnerOrders.map((o) => o.amount))),
          rows: (shown.get(s.partnerId) ?? []).map((o) => {
            const d = details.get(o.orderId);
            const gross = d ? Money.parse(d.codAmount ?? d.totalAmount) : null;
            return {
              orderId: o.orderId,
              orderNumber: formatOrderNumber(o.orderId),
              customer: fullName(d?.customer) || null,
              area: d?.deliveryArea ?? null,
              deliveredOn: o.deliveredOn,
              ageDays: o.ageDays,
              orderTotal: gross ? Money.toApi(gross) : null,
              fee: d?.deliveryFee != null ? Money.toApi(d.deliveryFee) : null,
              amount: Money.toApi(o.amount),
            };
          }),
        }
        : null,
    };
  });

  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return {
    basis: 'expected_cash_after_fees' as const,
    dateBasis: 'range' as const,
    from: localDate(from, zone), to: localDate(new Date(to.getTime() - 1), zone),
    counts: { matched: count('matched'), short: count('short'), over: count('over'), unmatched: count('unmatched') },
    rows,
  };
}
