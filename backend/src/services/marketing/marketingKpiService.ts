/**
 * Marketing KPIs (M8-T10, COD-73): max CPA and the tiles of the Marketing page.
 *
 * Profit per delivered order before ads = average delivered order revenue - average landed cost - average delivery fee
 * (the fee stamped on the order from the partner fee rules, so it is the weighted fee, R5). No rep commission, no ads.
 * Max CPA = that profit x order-to-cash yield. It is a cost per PLACED order: only the yield share of placed orders is
 * delivered. Profit of 0 or less gives max CPA 0 and "No room for ads at this price".
 *
 * Cohort: orders placed in the 90 days that end 30 days before the end of the range, so every order has an outcome.
 * No closed cohort, or no delivered order to average, gives `available: false` and "Not enough closed orders".
 * Money is in the store currency. When every enabled ad account is in one other currency, each money value also
 * carries the figure in that currency and the rate used. A NGN figure is rounded to the nearest 10.
 * Call inside the tenant context.
 */
import prisma from '../../utils/prisma';
import * as Money from '../../utils/money';
import { getCurrency } from '../../utils/currency';
import { resolveTenantId } from '../../utils/tenantContext';
import { rateOn } from '../fxService';
import { rates, CONFIRMED, DIGITAL } from '../kpi/rates';
import { getStoreTimeZone, shiftYmd, startOfDay, utcDateOfYmd } from '../kpi/dates';
import { NOT_ENOUGH_CLOSED } from '../finance/profitService';
import { convertSpend } from './metaLedgerService';

export const NO_ROOM_FOR_ADS = 'No room for ads at this price';
export const ACTUAL_COST_LABEL = 'Actual, delivered in range';

/** Length of the cohort and the gap between its end and the end of the range, in days. */
const COHORT_DAYS = 90;
const COHORT_LAG_DAYS = 30;
/** A NGN figure is shown to the nearest 10 (PRD: GH₵185 x 112 = ₦20,720; x 34% = ₦7,040). */
const ROUND_TO_TEN_CURRENCY = 'NGN';
/** A free bundled digital item is not a sale of its own (same rule as profitService). */
const FREE_ITEM_WEIGHT = Money.parse('0.0001');

// ---------------------------------------------------------------------------------------------
// Money views
// ---------------------------------------------------------------------------------------------

/** The rate to the ad account currency: `rate` units of `currency` for 1 unit of the store currency. */
export interface AccountContext { currency: string; rate: Money.Money; rateDate: string }

export interface MoneyView {
  /** Store currency, 2 dp. */
  store: string;
  /** The same amount in the ad account currency, or null when the account currency is the store currency or mixed. */
  account: string | null;
  accountCurrency: string | null;
  rate: string | null;
  rateDate: string | null;
}

/** Nearest 10 of an amount, half up. */
const roundToTen = (a: Money.Money): Money.Money => Money.mul(Money.roundHalfUp(Money.div(a, 10), 0), 10);

/** An amount in the store currency, with its ad account currency figure at the rate of `ctx`. */
export function moneyView(store: Money.Money, ctx: AccountContext | null, opts: { tenth?: boolean } = {}): MoneyView {
  if (!ctx) return { store: Money.toApi(store), account: null, accountCurrency: null, rate: null, rateDate: null };
  const converted = Money.mul(store, ctx.rate);
  const account = opts.tenth && ctx.currency === ROUND_TO_TEN_CURRENCY ? roundToTen(converted) : converted;
  return { store: Money.toApi(store), account: Money.toApi(account), accountCurrency: ctx.currency, rate: ctx.rate.toFixed(4), rateDate: ctx.rateDate };
}

/** The ad account currency view: one enabled-account currency that is not the store currency, with its rate on `ymd`. */
export async function accountContext(ymd: string): Promise<AccountContext | null> {
  const accounts = await prisma.metaAdAccount.findMany({ where: { enabled: true }, select: { currency: true }, distinct: ['currency'] });
  const store = await getCurrency();
  if (accounts.length !== 1 || accounts[0].currency === store) return null;
  const found = await rateOn(resolveTenantId(), store, accounts[0].currency, ymd);
  return found ? { currency: accounts[0].currency, rate: found.rate, rateDate: found.date } : null;
}

// ---------------------------------------------------------------------------------------------
// Max CPA
// ---------------------------------------------------------------------------------------------

/** Pure math. `yieldPct` is a percent (34 means 34%). */
export function maxCpaMath(input: { revenuePer: Money.MoneyInput; costPer: Money.MoneyInput; feePer: Money.MoneyInput; yieldPct: number }) {
  const profit = Money.sub(input.revenuePer, Money.add(input.costPer, input.feePer));
  if (!profit.gt(0)) return { profit, max: Money.ZERO, message: NO_ROOM_FOR_ADS as string | null };
  return { profit, max: Money.mul(profit, Money.div(input.yieldPct, 100)), message: null as string | null };
}

export interface MaxCpaRaw {
  available: boolean;
  yieldPct: number | null;
  /** Store currency, unrounded. Null when not available. */
  profit: Money.Money | null;
  max: Money.Money | null;
  message: string | null;
  /** Delivered + failed + returned orders of the cohort: under 30 is "low data". */
  closedOrders: number;
  cohort: { from: string; to: string };
}

export interface MaxCpa {
  available: boolean;
  yieldPct: number | null;
  profitBeforeAds: MoneyView | null;
  maxCpa: MoneyView | null;
  message: string | null;
  closedOrders: number;
  cohort: { from: string; to: string };
}

/** [from, to) of the cohort as local days: 90 days ending 30 days before the day after `to`. */
function cohortDays(to: string): { from: string; to: string } {
  const end = shiftYmd(to, 1 - COHORT_LAG_DAYS);
  return { from: shiftYmd(end, -COHORT_DAYS), to: end };
}

/** Split `amount` over weights; the last share takes the rounding rest (same split as profitService). */
function shares(amount: Money.Money, weights: Money.Money[]): Money.Money[] {
  const total = Money.sum(weights);
  let left = amount;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return left;
    const share = total.isZero() ? Money.ZERO : Money.roundHalfUp(Money.mul(amount, Money.div(w, total)), 4);
    left = Money.sub(left, share);
    return share;
  });
}

/**
 * Averages over the delivered orders placed in [from, to). Account level: the order totals. Product level: the share of
 * each order that belongs to the product (revenue and fee split by item value, cost by item cost). An order delivered
 * before its landed cost was stamped is costed at the products' current cost, as `cohortProfit` does.
 */
async function deliveredAverages(from: Date, to: Date, productId?: number) {
  const orders = await prisma.order.findMany({
    where: {
      tenantId: resolveTenantId(), deletedAt: null, status: 'delivered', createdAt: { gte: from, lt: to },
      ...(productId !== undefined ? { orderItems: { some: { productId } } } : {}),
    },
    select: {
      totalAmount: true, deliveryFee: true, landedCostTotal: true,
      orderItems: { select: { productId: true, quantity: true, totalPrice: true, product: { select: { cogs: true, productType: true } } } },
    },
  });
  let n = 0;
  let revenue = Money.ZERO;
  let cost = Money.ZERO;
  let fee = Money.ZERO;
  for (const o of orders) {
    const itemCost = (i: (typeof o.orderItems)[number]) => Money.mul(Money.orZero(i.product.cogs), i.quantity);
    if (productId === undefined) {
      n += 1;
      revenue = Money.add(revenue, Money.orZero(o.totalAmount));
      cost = Money.add(cost, o.landedCostTotal != null ? Money.parse(o.landedCostTotal) : Money.sum(o.orderItems.map(itemCost)));
      fee = Money.add(fee, Money.orZero(o.deliveryFee));
      continue;
    }
    const items = o.orderItems.filter((i) => !(Money.orZero(i.totalPrice).isZero() && i.product.productType === 'digital'));
    if (!items.some((i) => i.productId === productId)) continue;
    n += 1;
    const costs = items.map(itemCost);
    const orderCost = o.landedCostTotal != null ? Money.parse(o.landedCostTotal) : Money.sum(costs);
    const revenueShares = shares(Money.orZero(o.totalAmount), items.map((i) => Money.orZero(i.totalPrice)));
    const costShares = shares(orderCost, costs.map((c, k) => (c.isZero() ? Money.mul(FREE_ITEM_WEIGHT, items[k].quantity) : c)));
    const feeShares = shares(Money.orZero(o.deliveryFee), items.map((i) => Money.orZero(i.totalPrice)));
    items.forEach((i, k) => {
      if (i.productId !== productId) return;
      revenue = Money.add(revenue, revenueShares[k]);
      cost = Money.add(cost, costShares[k]);
      fee = Money.add(fee, feeShares[k]);
    });
  }
  if (n === 0) return null;
  return { revenuePer: Money.div(revenue, n), costPer: Money.div(cost, n), feePer: Money.div(fee, n) };
}

/** Max CPA with unrounded store-currency numbers (T11 compares CPA to these). `to` is the last day of the range (YYYY-MM-DD). */
export async function maxCpaRaw(input: { to: string; productId?: number }): Promise<MaxCpaRaw> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);
  const days = cohortDays(input.to);
  const from = startOfDay(days.from, zone);
  const to = startOfDay(days.to, zone);
  const [rate, averages] = await Promise.all([
    rates(tenantId, from, to, { productId: input.productId }),
    deliveredAverages(from, to, input.productId),
  ]);
  const yieldPct = rate.orderToCashYield.value;
  const closedOrders = rate.deliverySuccessRate.detail?.closed ?? 0;
  const base = { closedOrders, cohort: days };
  if (yieldPct === null || !averages) return { ...base, available: false, yieldPct: null, profit: null, max: null, message: NOT_ENOUGH_CLOSED };
  const { profit, max, message } = maxCpaMath({ ...averages, yieldPct });
  return { ...base, available: true, yieldPct, profit, max, message };
}

function maxCpaView(raw: MaxCpaRaw, ctx: AccountContext | null): MaxCpa {
  return {
    available: raw.available, yieldPct: raw.yieldPct, message: raw.message, closedOrders: raw.closedOrders, cohort: raw.cohort,
    profitBeforeAds: raw.profit ? moneyView(raw.profit, ctx, { tenth: true }) : null,
    maxCpa: raw.max ? moneyView(raw.max, ctx, { tenth: true }) : null,
  };
}

export async function maxCpa(input: { to: string; productId?: number }): Promise<MaxCpa> {
  const [raw, ctx] = await Promise.all([maxCpaRaw(input), accountContext(input.to)]);
  return maxCpaView(raw, ctx);
}

// ---------------------------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------------------------

/** Meta spend of days [from, to] in the store currency: each (account, day) converted at its day rate, like the ledger. */
export async function spendInRange(range: { from: string; to: string; campaignKeys?: Set<string> }) {
  const store = await getCurrency();
  const tenantId = resolveTenantId();
  const rows = await prisma.metaSpendDay.findMany({
    where: { date: { gte: utcDateOfYmd(range.from), lte: utcDateOfYmd(range.to) } },
    select: { adAccountId: true, campaignId: true, date: true, currency: true, spend: true },
  });
  const byDay = new Map<string, { currency: string; ymd: string; original: Money.Money }>();
  for (const r of rows) {
    if (range.campaignKeys && !range.campaignKeys.has(`${r.adAccountId}:${r.campaignId}`)) continue;
    const ymd = r.date.toISOString().slice(0, 10);
    const key = `${r.adAccountId}|${ymd}`;
    const day = byDay.get(key) ?? { currency: r.currency, ymd, original: Money.ZERO };
    day.original = Money.add(day.original, r.spend);
    byDay.set(key, day);
  }
  const rateOf = new Map<string, Promise<Money.Money | null>>();
  const rateFor = (currency: string, ymd: string) => {
    if (currency === store) return Promise.resolve(Money.parse(1));
    const key = `${currency}|${ymd}`;
    if (!rateOf.has(key)) rateOf.set(key, rateOn(tenantId, currency, store, ymd).then((f) => f?.rate ?? null));
    return rateOf.get(key)!;
  };
  let spend = Money.ZERO;
  let waitingForRate = 0;
  const originals = new Map<string, Money.Money>();
  await Promise.all([...byDay.values()].map(async (d) => {
    const rate = await rateFor(d.currency, d.ymd);
    if (!rate) { waitingForRate += 1; return; }
    spend = Money.add(spend, convertSpend(d.original, rate));
    originals.set(d.currency, Money.add(originals.get(d.currency) ?? Money.ZERO, d.original));
  }));
  return { spend, waitingForRate, originals };
}

export interface TileSet {
  from: string;
  to: string;
  spend: MoneyView;
  /** Days of spend left out because no FX rate exists for them yet (they are not in the ledger either). */
  spendDaysWaitingForRate: number;
  ordersPlaced: number;
  confirmed: number;
  /** Delivered in the range, by delivery date. */
  delivered: number;
  /** Spend / (orders placed x cohort yield). Null with a message when there is no yield or no order. */
  projectedCostPerDelivered: { value: MoneyView | null; message: string | null };
  actualCostPerDelivered: { label: string; value: MoneyView | null };
  maxCpa: MaxCpa;
}

async function tilesFor(from: string, to: string): Promise<TileSet> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);
  const start = startOfDay(from, zone);
  const end = startOfDay(shiftYmd(to, 1), zone);
  const placedWhere = { tenantId, deletedAt: null, status: { notIn: DIGITAL }, createdAt: { gte: start, lt: end } };

  const [spent, ctx, cpa, ordersPlaced, confirmed, delivered] = await Promise.all([
    spendInRange({ from, to }),
    accountContext(to),
    maxCpaRaw({ to }),
    prisma.order.count({ where: placedWhere }),
    prisma.order.count({ where: { ...placedWhere, status: { in: CONFIRMED } } }),
    prisma.order.count({ where: { tenantId, deletedAt: null, status: 'delivered', deliveryDate: { gte: start, lt: end } } }),
  ]);
  const store = await getCurrency();
  // The ad account figure of spend is the sum of what Meta reported, not the store amount x one rate.
  const originals = [...spent.originals.entries()];
  const spend: MoneyView = {
    ...moneyView(spent.spend, null),
    ...(originals.length === 1 && originals[0][0] !== store
      ? { account: Money.toApi(originals[0][1]), accountCurrency: originals[0][0] }
      : {}),
  };

  let projected: TileSet['projectedCostPerDelivered'];
  if (cpa.yieldPct === null) projected = { value: null, message: NOT_ENOUGH_CLOSED };
  else if (ordersPlaced === 0 || cpa.yieldPct === 0) projected = { value: null, message: null };
  else {
    const deliveredProjected = Money.mul(ordersPlaced, Money.div(cpa.yieldPct, 100));
    projected = { value: moneyView(Money.div(spent.spend, deliveredProjected), ctx, { tenth: true }), message: null };
  }

  return {
    from, to, spend, spendDaysWaitingForRate: spent.waitingForRate, ordersPlaced, confirmed, delivered,
    projectedCostPerDelivered: projected,
    actualCostPerDelivered: { label: ACTUAL_COST_LABEL, value: delivered > 0 ? moneyView(Money.div(spent.spend, delivered), ctx, { tenth: true }) : null },
    maxCpa: maxCpaView(cpa, ctx),
  };
}

/** The tiles of [from, to] (YYYY-MM-DD, both inclusive) and of the period of the same length just before it. */
export async function tiles(range: { from: string; to: string }): Promise<TileSet & { previous: TileSet }> {
  const length = Math.round((utcDateOfYmd(range.to).getTime() - utcDateOfYmd(range.from).getTime()) / 86_400_000) + 1;
  const previousTo = shiftYmd(range.from, -1);
  const [current, previous] = await Promise.all([tilesFor(range.from, range.to), tilesFor(shiftYmd(previousTo, 1 - length), previousTo)]);
  return { ...current, previous };
}
