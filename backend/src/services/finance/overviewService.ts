/**
 * M5-T24 (COD-52, F-902, F-907, F-910, F-927): the Finance overview in one call: six tiles and the payout reconciliation list.
 *
 * Nothing is computed twice: delivered revenue and AOV come from services/kpi, margin and expenses from the ledger reader
 * (statementsService), cash from the cash buckets, aging buckets from agingService. This file only assembles them.
 *
 * Date basis. The revenue, cash received, margin and profit per order tiles cover the range [from, to) the caller picked.
 * Cash outstanding and cash runway are as of today (a balance has no range); each tile says which in its tooltip.
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
import { getStoreTimeZone, localDate, parseYmd, shiftYmd, startOfDay, utcDateOfYmd } from '../kpi/dates';
import { deliveredAov, deliveredRevenue } from '../kpi/revenue';
import { coveringTarget, paceMarker, periodOfTarget } from '../kpi/leadership';
import { progressTag } from '../kpi/status';
import { ratePercent } from '../kpi/rates';
import { profitByProduct } from './profitService';
import { TARGET_NET_MARGIN, incomeStatementOver } from './statementsService';
import { cashBalances, cashBuckets } from './cashFlowService';
import agingService from '../agingService';
import type { UnpaidOrder } from '../agingService';

export const NOT_AVAILABLE = 'n/a';

/** Days of ad spend the runway divides by (decision "Seven-day average used for cash runway"). */
export const RUNWAY_AD_DAYS = 7;
/** Runway under this many days reads "Tight"; under the lower one "Critical". */
export const RUNWAY_TIGHT_DAYS = 14;
export const RUNWAY_CRITICAL_DAYS = 7;

/** Short partner rows list at most this many unpaid orders (the full list is on the Agent collections tab). */
const UNPAID_ROWS_PER_PARTNER = 10;
const SETTLEMENT_ROWS = 100;

/** The ui-v2 Tag tones. The page draws `badge` as it comes and holds no tag rule of its own. */
type TagTone = 'ok' | 'bad' | 'warn' | 'v' | 'n';
export interface Badge { label: string; tone: TagTone }

export interface TileDetails {
  deliveredRevenue: {
    deliveredOrders: number; averageOrderValue: string; ofWhichDigital: string;
    /** The covering revenue target and the Dashboard's progress tag key; null when none covers the range. */
    target: { value: string; status: ReturnType<typeof progressTag> } | null;
  };
  cashReceived: { payouts: number; percentOfDeliveredRevenue: number | null };
  cashOutstanding: { orders: number; overdueOrders: number };
  netMargin: { target: number; netProfit: string; expenses: { total: string; paystackFees: string } };
  profitPerOrder: {
    deliveredOrders: number;
    /** Product cost and fees only: ads have no product until M8, rep commission is not split by product. */
    topProduct: { name: string; profitPerOrder: string } | null;
  };
  cashRunway: { cash: string; adsPerDay: string; adDays: number };
}
export type TileKey = keyof TileDetails;

export interface OkTile<K extends TileKey = TileKey> {
  status: 'ok';
  key: K;
  label: string;
  tooltip: string;
  dateBasis: 'range' | 'today';
  /** Money API string, a number (percent, days) or "n/a". */
  value: string | number;
  badge: Badge | null;
  detail: TileDetails[K];
}
export interface ErrorTile { key: TileKey; label: string; status: 'error'; message: string }
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

/** One tile. `build` returns the body; key and label are written here once. A build that throws becomes this tile's error. */
async function tile<K extends TileKey>(key: K, label: string, build: () => Promise<Omit<OkTile<K>, 'status' | 'key' | 'label'>>): Promise<Tile> {
  try { return { status: 'ok', key, label, ...(await build()) }; } catch (error) { return { key, label, ...failure(`tile ${key}`, error) }; }
}

type RunwayLevel = 'critical' | 'tight' | 'ok' | 'no_ads';
const RUNWAY_BADGE: Record<RunwayLevel, Badge | null> = {
  critical: { label: 'Critical', tone: 'bad' }, tight: { label: 'Tight', tone: 'warn' }, ok: { label: 'OK', tone: 'ok' }, no_ads: null,
};
const runwayLevel = (days: number | null): RunwayLevel =>
  days === null ? 'no_ads' : days < RUNWAY_CRITICAL_DAYS ? 'critical' : days < RUNWAY_TIGHT_DAYS ? 'tight' : 'ok';

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
  // Cash received (F-902): verified deposits and settlement payouts dated in the range. A payout recorded through a settlement
  // also writes a verified deposit (settlementId set); that one is left out here so the same cash is not counted twice.
  const cashIn = once(async () => {
    const [d, p] = await Promise.all([
      prisma.agentDeposit.aggregate({
        where: { status: 'verified', settlementId: null, depositDate: { gte: from, lt: to } },
        _sum: { amount: true }, _count: true,
      }),
      prisma.partnerSettlement.aggregate({ where: { payoutDate: { gte: from, lt: to } }, _sum: { payoutAmount: true }, _count: true }),
    ]);
    return { amount: Money.add(Money.orZero(d._sum.amount), Money.orZero(p._sum.payoutAmount)), payouts: d._count + p._count };
  });
  // The tenant-wide revenue target that covers the range, when the range starts on the target's first day (a part of a period
  // would be compared with the whole target). The tag is the Dashboard's: progress against the pace marker of the period.
  const revenueTarget = once(async () => {
    const target = await coveringTarget(tenantId, 'revenue', utcDateOfYmd(toDay));
    const period = target && periodOfTarget(target);
    if (!target || !period || Money.parse(target.value).lte(0) || target.periodStart.toISOString().slice(0, 10) !== fromDay) return null;
    const r = await revenue();
    const percent = ratePercent(Money.parse(r.total.value).toNumber(), Money.parse(target.value).toNumber());
    return { value: Money.toApi(target.value), status: progressTag(percent, paceMarker(parseYmd(toDay), period).percent) };
  });
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
    return { days, badge: RUNWAY_BADGE[runwayLevel(days)], cash: Money.toApi(cash), adsPerDay: Money.toApi(adsPerDay) };
  });

  const [tiles, reconciliation, currency] = await Promise.all([
    Promise.all([
      tile('deliveredRevenue', 'Delivered revenue', async () => {
        const r = await revenue();
        // A missing or failing target read only drops the target; the revenue stays
        const target = await revenueTarget().catch((error) => { logger.error('Finance overview: revenue target failed', { error }); return null; });
        return {
          dateBasis: 'range', badge: null, value: r.total.value,
          tooltip: `By delivery date. Orders delivered ${span}. Includes paid digital orders. Returns leave in the month they come back.`,
          detail: { deliveredOrders: r.deliveredOrders.value, averageOrderValue: deliveredAov(r).value ?? NOT_AVAILABLE, ofWhichDigital: r.digital.value, target },
        };
      }),

      tile('cashReceived', 'Cash received', async () => {
        const [d, r] = await Promise.all([cashIn(), revenue()]);
        return {
          dateBasis: 'range', badge: { label: 'Paid in', tone: 'ok' }, value: Money.toApi(d.amount),
          tooltip: `By payment date. Cash that delivery partners paid in ${span}: verified deposits and settlement payouts.`,
          detail: { payouts: d.payouts, percentOfDeliveredRevenue: Money.percentOrNull(d.amount, r.total.value, 0) },
        };
      }),

      tile('cashOutstanding', 'Cash outstanding', async () => {
        const u = await unpaid();
        return {
          dateBasis: 'today', badge: u.overdue.orders > 0 ? { label: 'Chase', tone: 'warn' } : { label: 'On time', tone: 'ok' }, value: u.total.amount,
          tooltip: 'As of today. Delivered orders whose cash a partner still holds, net of the delivery fee the partner keeps. Not limited to the dates you picked.',
          detail: { orders: u.total.orders, overdueOrders: u.overdue.orders },
        };
      }),

      tile('netMargin', 'Net margin', async () => {
        const s = await statement();
        const pct = s.netMarginPct;
        return {
          dateBasis: 'range', value: pct ?? NOT_AVAILABLE,
          badge: pct === null ? null : pct >= TARGET_NET_MARGIN ? { label: 'On target', tone: 'ok' } : pct >= 0 ? { label: 'Under target', tone: 'warn' } : { label: 'Loss', tone: 'bad' },
          tooltip: `By ledger entry date. Net profit as a share of revenue, from the entries dated ${span}. Product cost, delivery fees, Meta spend, rep commission, Paystack fees and other expenses are all taken off. Target ${TARGET_NET_MARGIN}%.`,
          detail: { target: TARGET_NET_MARGIN, netProfit: s.netProfit, expenses: { total: s.totalExpenses, paystackFees: s.paystackFees } },
        };
      }),

      tile('profitPerOrder', 'Profit per delivered order', async () => {
        const [s, r] = await Promise.all([statement(), revenue()]);
        const orders = r.deliveredOrders.value;
        const per = orders > 0 ? Money.roundHalfUp(Money.div(s.netProfit, orders), 2) : null;
        // The product with the most delivered orders, from profit by product. Best effort: the tile stands without it.
        const topProduct = await profitByProduct(from, to).then((p) => {
          const top = [...p.products].sort((a, b) => b.delivered - a.delivered || a.productId - b.productId)[0];
          return top && top.profitPerDeliveredOrder !== null ? { name: top.name, profitPerOrder: top.profitPerDeliveredOrder } : null;
        }).catch((error) => { logger.error('Finance overview: profit by product failed', { error }); return null; });
        return {
          dateBasis: 'range', value: per === null ? NOT_AVAILABLE : Money.toApi(per),
          badge: per === null ? null : per.lt(0) ? { label: 'Loss', tone: 'bad' } : { label: 'Profit', tone: 'ok' },
          tooltip: `By delivery date. Net profit of ${span} after rep commission and ads, divided by the orders delivered in the same dates. The product line under it is profit before ads and rep commission: it takes off product cost and delivery fees only, because neither is split by product yet.`,
          detail: { deliveredOrders: orders, topProduct },
        };
      }),

      tile('cashRunway', 'Cash runway, in days of ads', async () => {
        const w = await runwayData();
        return {
          dateBasis: 'today', badge: w.badge, value: w.days ?? NOT_AVAILABLE,
          tooltip: `As of today. Cash at bank and with partners, divided by the average daily Meta spend of the last ${RUNWAY_AD_DAYS} days. How many days of ads the cash pays for.`,
          detail: { cash: w.cash, adsPerDay: w.adsPerDay, adDays: RUNWAY_AD_DAYS },
        };
      }),
    ]),
    guarded('payout reconciliation', () => reconciliationOf(from, to)),
    getCurrency(),
  ]);

  return { from: fromDay, to: toDay, currency, tiles, reconciliation };
}

// ---------------------------------------------------------------------------------------------------------------------
// Payout reconciliation
// ---------------------------------------------------------------------------------------------------------------------

async function reconciliationOf(from: Date, to: Date) {
  const settlements = await prisma.partnerSettlement.findMany({
    where: { payoutDate: { gte: from, lt: to } },
    orderBy: [{ payoutDate: 'desc' }, { id: 'desc' }],
    take: SETTLEMENT_ROWS,
    select: {
      id: true, partnerId: true, payoutDate: true, payoutAmount: true, expectedNet: true, shortAmount: true, status: true,
      partner: { select: { firstName: true, lastName: true, kind: true } },
      lines: { select: { matched: true } },
    },
  });

  // A short payout opens to its partner's unpaid orders, oldest first: grouped once per partner (rows capped; count and sum are all of them)
  const shortPartners = [...new Set(settlements.filter((s) => s.status === 'short').map((s) => s.partnerId))];
  const unpaidOf = new Map<number, { orders: number; amount: Money.Money; rows: UnpaidOrder[] }>();
  if (shortPartners.length > 0) {
    for (const o of await agingService.getUnpaidOrdersOf(shortPartners)) {
      const g = unpaidOf.get(o.agentId) ?? { orders: 0, amount: Money.ZERO, rows: [] };
      g.orders += 1;
      g.amount = Money.add(g.amount, o.amount);
      if (g.rows.length < UNPAID_ROWS_PER_PARTNER) g.rows.push(o);
      unpaidOf.set(o.agentId, g);
    }
  }
  const shownIds = [...unpaidOf.values()].flatMap((g) => g.rows.map((o) => o.orderId));
  const details = new Map(
    (shownIds.length === 0 ? [] : await prisma.order.findMany({
      where: { id: { in: shownIds } },
      select: { id: true, deliveryArea: true, totalAmount: true, codAmount: true, deliveryFee: true, customer: { select: { firstName: true, lastName: true } } },
    })).map((o) => [o.id, o]),
  );

  const rows = settlements.map((s) => {
    const gap = Money.roundHalfUp(Money.sub(s.payoutAmount, s.expectedNet), 2);
    const group = s.status === 'short' ? unpaidOf.get(s.partnerId) : undefined;
    return {
      id: s.id,
      date: s.payoutDate.toISOString().slice(0, 10),
      partnerName: fullName(s.partner) || `Partner #${s.partnerId}`,
      partnerKind: s.partner.kind,
      paidIn: Money.toApi(s.payoutAmount),
      expectedAfterFees: Money.toApi(s.expectedNet),
      orders: s.lines.filter((l) => l.matched).length,
      status: s.status,
      shortAmount: Money.toApi(s.shortAmount),
      overAmount: Money.toApi(gap.gt(0) ? gap : Money.ZERO),
      unpaid: s.status === 'short'
        ? {
          orders: group?.orders ?? 0,
          amount: Money.toApi(group?.amount ?? Money.ZERO),
          rows: (group?.rows ?? []).map((o) => {
            const d = details.get(o.orderId);
            return {
              orderId: o.orderId,
              orderNumber: formatOrderNumber(o.orderId),
              customer: fullName(d?.customer) || null,
              area: d?.deliveryArea ?? null,
              deliveredOn: o.deliveredOn,
              ageDays: o.ageDays,
              orderTotal: d ? Money.toApi(d.codAmount ?? d.totalAmount) : null,
              fee: d?.deliveryFee != null ? Money.toApi(d.deliveryFee) : null,
              amount: Money.toApi(o.amount),
            };
          }),
        }
        : null,
    };
  });
  return { rows };
}
