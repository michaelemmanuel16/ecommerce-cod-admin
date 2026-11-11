/**
 * Marketing funnel and campaign table (M8-T11, COD-73). M11 `marketing_funnel` reads this service.
 *
 * Funnel: Meta numbers (impressions, link clicks, landing page views, checkouts started) from MetaSpendDay, then real CodAdmin
 * orders placed, confirmed and delivered (by createdAt, non-digital). For one product: the campaigns mapped to it, and the
 * orders that hold it. Overall: every campaign (unmapped ones too) and every order.
 *
 * Campaign status, in this order:
 *   latest campaign status in Meta is not ACTIVE    Paused
 *   no product                                      Not mapped
 *   product max CPA not available                   null (the max CPA message says why; no status is guessed)
 *   CPA <= 85% of max CPA                           Winning
 *   CPA <= max CPA                                  On track
 *   otherwise, and spend with no purchase           Over max CPA
 * CPA = spend / Meta purchases, in the store currency. Call inside the tenant context.
 */
import prisma from '../../utils/prisma';
import * as Money from '../../utils/money';
import { getCurrency } from '../../utils/currency';
import { resolveTenantId } from '../../utils/tenantContext';
import { CONFIRMED, DIGITAL } from '../kpi/rates';
import { getStoreTimeZone, shiftYmd, startOfDay, utcDateOfYmd } from '../kpi/dates';
import { campaignKey, listCampaigns, resolveProducts } from './campaignMappingService';
import { accountContext, dayRates, maxCpaRaw, maxCpaView, moneyView, rateKey, type MaxCpa, type MoneyView } from './marketingKpiService';

/** A campaign at or under this percent of max CPA is Winning. */
export const WINNING_PERCENT_OF_MAX_CPA = 85;
/** A product with fewer closed orders than this in its cohort shows "low data". */
export const LOW_DATA_CLOSED_ORDERS = 30;
export const META_PURCHASES_LABEL = 'Meta purchases';

export type CampaignStatus = 'Paused' | 'Not mapped' | 'Winning' | 'On track' | 'Over max CPA';

/** Pure status rule. `max` is the unrounded store-currency max CPA, null when it is not available. */
export function campaignStatus(input: { paused: boolean; hasProduct: boolean; max: Money.MoneyInput | null; cpa: Money.MoneyInput | null; spend: Money.MoneyInput }): CampaignStatus | null {
  if (input.paused) return 'Paused';
  if (!input.hasProduct) return 'Not mapped';
  if (input.max === null) return null;
  if (input.cpa === null) return Money.parse(input.spend).gt(0) ? 'Over max CPA' : null;
  if (Money.compare(input.cpa, Money.mul(input.max, Money.div(WINNING_PERCENT_OF_MAX_CPA, 100))) <= 0) return 'Winning';
  return Money.compare(input.cpa, input.max) <= 0 ? 'On track' : 'Over max CPA';
}

// ---------------------------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------------------------

export interface Funnel {
  from: string;
  to: string;
  productId: number | null;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  checkoutsStarted: number;
  ordersPlaced: number;
  confirmed: number;
  delivered: number;
}

const spendDaysOf = (range: { from: string; to: string }) => prisma.metaSpendDay.findMany({
  where: { date: { gte: utcDateOfYmd(range.from), lte: utcDateOfYmd(range.to) } },
  orderBy: { date: 'desc' }, // newest first: the first status seen is the latest
});

export async function funnel(input: { from: string; to: string; productId?: number }): Promise<Funnel> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);
  const { productId } = input;
  const days = await spendDaysOf(input);
  let rows = days;
  if (productId !== undefined) {
    const refs = [...new Map(days.map((d) => [campaignKey(d.adAccountId, d.campaignId), d])).values()];
    const products = await resolveProducts(refs);
    rows = days.filter((d) => products.get(campaignKey(d.adAccountId, d.campaignId))?.productId === productId);
  }
  const sum = (pick: (d: (typeof days)[number]) => number) => rows.reduce((n, d) => n + pick(d), 0);

  const byStatus = await prisma.order.groupBy({
    by: ['status'],
    where: {
      tenantId, deletedAt: null, status: { notIn: DIGITAL },
      createdAt: { gte: startOfDay(input.from, zone), lt: startOfDay(shiftYmd(input.to, 1), zone) },
      ...(productId !== undefined ? { orderItems: { some: { productId } } } : {}),
    },
    _count: { _all: true },
  });
  const count = (statuses: string[]) => byStatus.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
  return {
    from: input.from, to: input.to, productId: productId ?? null,
    impressions: sum((d) => d.impressions), linkClicks: sum((d) => d.linkClicks),
    landingPageViews: sum((d) => d.landingPageViews), checkoutsStarted: sum((d) => d.checkoutsStarted),
    ordersPlaced: count(byStatus.map((g) => g.status)), confirmed: count(CONFIRMED), delivered: count(['delivered']),
  };
}

// ---------------------------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------------------------

export interface CampaignPerformanceRow {
  adAccountId: number;
  campaignId: string;
  campaignName: string;
  /** `via`: 'campaign' = a one-off pick, 'prefix' = a name rule. */
  product: { id: number; name: string; archived: boolean; via: 'campaign' | 'prefix' } | null;
  spend: MoneyView;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  checkoutsStarted: number;
  purchases: number;
  /** Spend / Meta purchases. Null with no purchase. */
  cpa: MoneyView | null;
  /** Meta purchases x the product's order-to-cash yield, 1 dp. Null when the product has no yield. */
  projectedDelivered: number | null;
  projectedDeliveredLabel: typeof META_PURCHASES_LABEL;
  maxCpa: MaxCpa | null;
  status: CampaignStatus | null;
  /** The product has fewer than 30 closed orders in its cohort. */
  lowData: boolean;
}

export interface CampaignTotals {
  spend: MoneyView;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  checkoutsStarted: number;
  purchases: number;
  cpa: MoneyView | null;
  projectedDelivered: number;
  projectedDeliveredLabel: typeof META_PURCHASES_LABEL;
}

/** A store-currency amount with the figure in the campaign's own currency when that differs. */
function view(store: Money.Money, original: Money.Money, currency: string, storeCurrency: string): MoneyView {
  const same = currency === storeCurrency;
  return { store: Money.toApi(store), account: same ? null : Money.toApi(original), accountCurrency: same ? null : currency, rate: null, rateDate: null };
}

/** The campaign rows and totals, with the max CPA of each mapped product and the account context they were built with. */
async function campaignData(input: { from: string; to: string }) {
  const store = await getCurrency();
  const [list, days, ctx] = await Promise.all([listCampaigns(input), spendDaysOf(input), accountContext(input.to)]);
  const rates = await dayRates(days, store);

  // Per campaign: Meta counts, spend in the store currency (each day at its own rate), the latest Meta status
  type Acc = { storeSpend: Money.Money; impressions: number; linkClicks: number; landingPageViews: number; checkoutsStarted: number; purchases: number; metaStatus: string | null };
  const acc = new Map<string, Acc>();
  for (const d of days) { // newest first
    const key = campaignKey(d.adAccountId, d.campaignId);
    const a = acc.get(key) ?? { storeSpend: Money.ZERO, impressions: 0, linkClicks: 0, landingPageViews: 0, checkoutsStarted: 0, purchases: 0, metaStatus: null };
    const rate = rates.get(rateKey(d.currency, d.date));
    if (rate) a.storeSpend = Money.add(a.storeSpend, Money.mul(d.spend, rate));
    a.impressions += d.impressions; a.linkClicks += d.linkClicks; a.landingPageViews += d.landingPageViews;
    a.checkoutsStarted += d.checkoutsStarted; a.purchases += d.purchases;
    a.metaStatus ??= d.campaignStatus;
    acc.set(key, a);
  }

  const productIds = [...new Set(list.flatMap((c) => (c.product ? [c.product.productId] : [])))];
  const maxByProduct = new Map(await Promise.all(productIds.map(async (id) => [id, await maxCpaRaw({ to: input.to, productId: id })] as const)));

  const rows: CampaignPerformanceRow[] = list.map((c) => {
    const a = acc.get(campaignKey(c.adAccountId, c.campaignId))!;
    const max = c.product ? maxByProduct.get(c.product.productId)! : null;
    const original = Money.parse(c.spend);
    const cpaStore = a.purchases > 0 ? Money.div(a.storeSpend, a.purchases) : null;
    return {
      adAccountId: c.adAccountId, campaignId: c.campaignId, campaignName: c.campaignName,
      product: c.product ? { id: c.product.productId, name: c.product.productName, archived: c.product.archived, via: c.product.via } : null,
      spend: view(a.storeSpend, original, c.currency, store),
      impressions: a.impressions, linkClicks: a.linkClicks, landingPageViews: a.landingPageViews, checkoutsStarted: a.checkoutsStarted, purchases: a.purchases,
      cpa: cpaStore ? view(cpaStore, Money.div(original, a.purchases), c.currency, store) : null,
      projectedDelivered: max?.yieldPct != null ? Money.roundHalfUp(Money.mul(a.purchases, Money.div(max.yieldPct, 100)), 1).toNumber() : null,
      projectedDeliveredLabel: META_PURCHASES_LABEL,
      maxCpa: max ? maxCpaView(max, ctx) : null,
      status: campaignStatus({ paused: a.metaStatus !== null && a.metaStatus !== 'ACTIVE', hasProduct: c.product !== null, max: max?.max ?? null, cpa: cpaStore, spend: a.storeSpend }),
      lowData: max ? max.closedOrders < LOW_DATA_CLOSED_ORDERS : false,
    };
  });

  const total = (pick: (a: Acc) => number) => [...acc.values()].reduce((n, a) => n + pick(a), 0);
  const storeSpend = Money.sum([...acc.values()].map((a) => a.storeSpend));
  const purchases = total((a) => a.purchases);
  const originals = new Set(list.map((c) => c.currency));
  const oneCurrency = originals.size === 1 ? [...originals][0] : store;
  const originalSum = Money.sum(list.map((c) => c.spend));
  const totals: CampaignTotals = {
    spend: view(storeSpend, originalSum, oneCurrency, store),
    impressions: total((a) => a.impressions), linkClicks: total((a) => a.linkClicks), landingPageViews: total((a) => a.landingPageViews),
    checkoutsStarted: total((a) => a.checkoutsStarted), purchases,
    cpa: purchases > 0 ? view(Money.div(storeSpend, purchases), Money.div(originalSum, purchases), oneCurrency, store) : null,
    projectedDelivered: Money.sum(rows.map((r) => r.projectedDelivered ?? 0)).toNumber(),
    projectedDeliveredLabel: META_PURCHASES_LABEL,
  };
  return { rows, totals, maxByProduct, ctx };
}

export async function campaigns(input: { from: string; to: string }): Promise<{ campaigns: CampaignPerformanceRow[]; totals: CampaignTotals }> {
  const { rows, totals } = await campaignData(input);
  return { campaigns: rows, totals };
}

// ---------------------------------------------------------------------------------------------
// Products (M8-T14)
// ---------------------------------------------------------------------------------------------

export interface ProductPerformanceRow {
  product: { id: number; name: string; archived: boolean };
  /** Store spend of the product's campaigns in the range. */
  spend: MoneyView;
  purchases: number;
  ordersPlaced: number;
  confirmed: number;
  delivered: number;
  /** Order-to-cash yield percent of the product cohort (also in maxCpa). */
  yieldPct: number | null;
  maxCpa: MaxCpa;
  /** Spend / orders placed, store currency. Null with no placed order. */
  costPerPlaced: MoneyView | null;
  lowData: boolean;
}

/** One row per product that has a mapped campaign in the range. Reuses campaignData(), funnel() and maxCpaView(); no new math. */
export async function products(input: { from: string; to: string }): Promise<{ products: ProductPerformanceRow[] }> {
  const { rows, maxByProduct, ctx } = await campaignData(input);
  const byProduct = new Map<number, { product: NonNullable<CampaignPerformanceRow['product']>; rows: CampaignPerformanceRow[] }>();
  for (const r of rows) {
    if (!r.product) continue;
    const entry = byProduct.get(r.product.id) ?? { product: r.product, rows: [] };
    entry.rows.push(r);
    byProduct.set(r.product.id, entry);
  }
  const out = await Promise.all([...byProduct.values()].map(async ({ product, rows: rs }) => {
    const f = await funnel({ ...input, productId: product.id });
    const max = maxCpaView(maxByProduct.get(product.id)!, ctx);
    const storeSpend = Money.sum(rs.map((r) => r.spend.store));
    // The account figure shows only when every campaign has one in the same currency
    const currencies = new Set(rs.map((r) => r.spend.accountCurrency));
    const oneAccountCurrency = currencies.size === 1 && !currencies.has(null);
    const spend: MoneyView = {
      store: Money.toApi(storeSpend),
      account: oneAccountCurrency ? Money.toApi(Money.sum(rs.map((r) => r.spend.account!))) : null,
      accountCurrency: oneAccountCurrency ? [...currencies][0] : null,
      rate: null, rateDate: null,
    };
    return {
      product: { id: product.id, name: product.name, archived: product.archived },
      spend,
      purchases: rs.reduce((n, r) => n + r.purchases, 0),
      ordersPlaced: f.ordersPlaced, confirmed: f.confirmed, delivered: f.delivered,
      yieldPct: max.yieldPct,
      maxCpa: max,
      costPerPlaced: f.ordersPlaced > 0 ? moneyView(Money.div(storeSpend, f.ordersPlaced), ctx) : null,
      lowData: max.closedOrders < LOW_DATA_CLOSED_ORDERS,
    };
  }));
  return { products: out.sort((x, y) => Money.compare(y.spend.store, x.spend.store)) };
}
