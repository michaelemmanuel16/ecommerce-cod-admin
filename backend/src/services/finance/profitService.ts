/**
 * M5-T26 (COD-52, F-924, F-925, F-926, F-721): profit by product, the order cohort card, the cost of failed deliveries
 * and the cost of one refused delivery. Every range is [from, to) as instants (readRange). Money is an API string.
 *
 * Limits: an order in another currency is counted at its face amount (the ledger statements convert, this table does
 * not); Meta spend has no campaign-to-product mapping before M8 (F-1003), so all of it is "Meta spend with no product".
 */
import prisma from '../../utils/prisma';
import * as Money from '../../utils/money';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { getStoreTimeZone, localDate } from '../kpi/dates';
import { getTenantId, resolveTenantId } from '../../utils/tenantContext';
import { rates } from '../kpi/rates';
import { resolveFee } from '../feeRuleService';
import { incomeStatementOver } from './statementsService';

const COST_MISSING = 'Cost missing';

/**
 * Product rows use delivered orders plus paid digital orders at face value (no returns, no currency conversion). The totals
 * come from the ledger, and the difference shows in `notMatchedToProductRow`. One shared revenue definition per order is a follow-up.
 */
function deliveredWhere(from: Date, to: Date) {
  return {
    tenantId: resolveTenantId(),
    deletedAt: null,
    AND: [
      { OR: [{ deliveryDate: { gte: from, lt: to } }, { deliveryDate: null, updatedAt: { gte: from, lt: to } }] },
      { OR: [{ status: 'delivered' as const }, { status: 'digital_delivered' as const, paymentStatus: 'paid' as const, totalAmount: { gt: 0 } }] },
    ],
  };
}

/** Split `amount` over weights; the last share takes the rounding rest so the shares add up to `amount` exactly. */
function shares(amount: Money.Money, weights: Money.Money[]): Money.Money[] {
  const total = Money.sum(weights);
  let left = amount;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return left;
    const part = total.isZero() ? Money.div(amount, weights.length) : Money.mul(amount, Money.div(w, total));
    const rounded = Money.roundHalfUp(part, 4);
    left = Money.sub(left, rounded);
    return rounded;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// F-924 profit by product
// ---------------------------------------------------------------------------------------------------------------------

export interface ProductProfitRow {
  productId: number;
  sku: string;
  name: string;
  productType: string;
  /** Delivered orders that hold this product. */
  delivered: number;
  units: number;
  revenue: string;
  /** Null when the product has no cost (see `costMissing`). */
  productCost: string | null;
  costMissing: boolean;
  costNote: string | null;
  /** Delivery fee kept by the partner on those orders (physical) or Paystack fee (digital). */
  fees: string;
  /** Always 0 until a campaign is mapped to a product (F-1003). */
  metaAds: string;
  /** Before rep commission. Null when the cost is missing. */
  profit: string | null;
  marginPct: number | null;
  profitPerDeliveredOrder: string | null;
}

export interface ProfitByProduct {
  from: string;
  to: string;
  products: ProductProfitRow[];
  /** The ledger's totals for the range (income statement). Fees are delivery fees plus Paystack fees. */
  totals: { delivered: number; revenue: string; productCost: string; fees: string; metaAds: string };
  /** Ledger figure less the sum of the product rows, so the rows plus this line equal the totals. */
  notMatchedToProductRow: { revenue: string; productCost: string; fees: string };
  metaSpendWithNoProduct: string;
  repCommission: string;
  /** The ledger's other expenses (5100 and the retired accounts). */
  otherExpenses: string;
  netProfit: string;
  netMarginPct: number | null;
  /** Ledger net profit / delivered orders of the range (the "-GH₵38" tile). Null when nothing was delivered. */
  profitPerDeliveredOrder: string | null;
  costMissingProducts: number;
}

export async function profitByProduct(from: Date, to: Date): Promise<ProfitByProduct> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(getTenantId());
  const [orders, statement, paystackLines] = await Promise.all([
    prisma.order.findMany({
      where: deliveredWhere(from, to),
      select: {
        id: true, status: true, totalAmount: true, deliveryFee: true, landedCostTotal: true,
        orderItems: { select: { productId: true, quantity: true, totalPrice: true, product: { select: { sku: true, name: true, cogs: true, productType: true } } } },
      },
    }),
    incomeStatementOver(from, to),
    // Paystack fee of each digital order: the 5060 debit of its digital_sale entry.
    prisma.accountTransaction.findMany({
      where: { tenantId, account: { code: GL_ACCOUNTS.PAYSTACK_FEES }, journalEntry: { isVoided: false, sourceType: 'digital_sale', entryDate: { gte: from, lt: to } } },
      select: { debitAmount: true, creditAmount: true, journalEntry: { select: { sourceId: true } } },
    }),
  ]);
  const paystackByOrder = new Map<number, Money.Money>();
  for (const l of paystackLines) {
    const id = l.journalEntry.sourceId as number;
    paystackByOrder.set(id, Money.add(paystackByOrder.get(id) ?? Money.ZERO, Money.sub(l.debitAmount, l.creditAmount)));
  }

  type Acc = { orders: Set<number>; units: number; revenue: Money.Money; cost: Money.Money; fees: Money.Money; product: { sku: string; name: string; cogs: Money.MoneyInput | null; productType: string } };
  const acc = new Map<number, Acc>();
  for (const order of orders) {
    // A free bundled digital item (price 0) is not a sale of its own: it adds no revenue, cost or count.
    const items = order.orderItems.filter((i) => !(Money.orZero(i.totalPrice).isZero() && i.product.productType === 'digital'));
    if (items.length === 0) continue;
    const revenueShares = shares(Money.orZero(order.totalAmount), items.map((i) => Money.orZero(i.totalPrice)));
    const itemCost = items.map((i) => Money.mul(Money.orZero(i.product.cogs), i.quantity));
    const orderCost = order.landedCostTotal != null ? Money.parse(order.landedCostTotal) : Money.sum(itemCost);
    const costShares = shares(orderCost, itemCost.map((c, k) => (c.isZero() ? Money.mul(Money.parse('0.0001'), items[k].quantity) : c)));
    const orderFee = order.status === 'digital_delivered' ? paystackByOrder.get(order.id) ?? Money.ZERO : Money.orZero(order.deliveryFee);
    const feeShares = shares(orderFee, items.map((i) => Money.orZero(i.totalPrice)));
    items.forEach((item, k) => {
      let a = acc.get(item.productId);
      if (!a) acc.set(item.productId, (a = { orders: new Set(), units: 0, revenue: Money.ZERO, cost: Money.ZERO, fees: Money.ZERO, product: item.product }));
      a.orders.add(order.id);
      a.units += item.quantity;
      a.revenue = Money.add(a.revenue, revenueShares[k]);
      a.cost = Money.add(a.cost, costShares[k]);
      a.fees = Money.add(a.fees, feeShares[k]);
    });
  }

  const rows: ProductProfitRow[] = [...acc.entries()].map(([productId, a]) => {
    const costMissing = a.product.productType !== 'digital' && !Money.isNonZero(a.product.cogs);
    const delivered = a.orders.size;
    const profit = costMissing ? null : Money.sub(a.revenue, Money.add(a.cost, a.fees));
    return {
      productId, sku: a.product.sku, name: a.product.name, productType: a.product.productType,
      delivered, units: a.units,
      revenue: Money.toApi(a.revenue),
      productCost: costMissing ? null : Money.toApi(a.cost),
      costMissing, costNote: costMissing ? COST_MISSING : null,
      fees: Money.toApi(a.fees),
      metaAds: Money.toApi(Money.ZERO),
      profit: profit ? Money.toApi(profit) : null,
      marginPct: profit ? Money.percentOrNull(profit, a.revenue) : null,
      profitPerDeliveredOrder: profit && delivered > 0 ? Money.toApi(Money.roundHalfUp(Money.div(profit, delivered), 2)) : null,
    };
  }).sort((x, y) => Money.compare(y.revenue, x.revenue) || x.productId - y.productId);

  // The totals are the ledger's. A row is built from orders, so the two can differ (returns, other currencies, fees on
  // failed orders): the difference is shown as its own line instead of being hidden.
  const ledgerFees = Money.add(statement.deliveryFees, statement.paystackFees);
  const accs = [...acc.values()];
  const rowSum = (pick: (a: Acc) => Money.Money) => Money.sum(accs.map(pick));
  const delivered = orders.length;
  return {
    from: localDate(from, zone), to: localDate(new Date(to.getTime() - 1), zone),
    products: rows,
    totals: { delivered, revenue: statement.revenue, productCost: statement.productCost, fees: Money.toApi(ledgerFees), metaAds: Money.toApi(Money.ZERO) },
    notMatchedToProductRow: {
      revenue: Money.toApi(Money.sub(statement.revenue, rowSum((a) => a.revenue))),
      productCost: Money.toApi(Money.sub(statement.productCost, rowSum((a) => a.cost))),
      fees: Money.toApi(Money.sub(ledgerFees, rowSum((a) => a.fees))),
    },
    metaSpendWithNoProduct: statement.metaSpend,
    repCommission: statement.repCommission,
    otherExpenses: statement.otherExpenses,
    netProfit: statement.netProfit,
    netMarginPct: statement.netMarginPct,
    profitPerDeliveredOrder: delivered > 0 ? Money.toApi(Money.roundHalfUp(Money.div(statement.netProfit, delivered), 2)) : null,
    costMissingProducts: rows.filter((r) => r.costMissing).length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// F-925 order cohort card
// ---------------------------------------------------------------------------------------------------------------------

export const NOT_ENOUGH_CLOSED = 'Not enough closed orders';

export type CohortProfit =
  | { from: string; to: string; available: false; message: typeof NOT_ENOUGH_CLOSED }
  | {
    from: string; to: string; available: true;
    yieldPct: number; yieldLabel: string;
    ordersPlaced: number; projectedDelivered: number;
    revenue: string; productCost: string; fees: string; metaAds: string; repCommission: string;
    profitBeforeOtherExpenses: string; marginPct: number | null;
    profitPerDeliveredOrder: string | null;
    /** The other way to read the range: net result by delivery date (the card's own figure is the cohort projection). */
    byDeliveryDate: string;
  };

/**
 * Projected profit of the orders placed in [from, to) at the yield of the closed day cohorts (F-1008): delivered = placed x
 * yield; revenue, product cost and fee are that many orders at the cohort's average delivered order; commission is its
 * average per delivered order; ads are the Meta spend booked in the range. No closed cohort, or no delivered order to
 * average, gives "Not enough closed orders" and no number.
 */
export async function cohortProfit(from: Date, to: Date): Promise<CohortProfit> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(getTenantId());
  const labels = { from: localDate(from, zone), to: localDate(new Date(to.getTime() - 1), zone) };
  const notEnough: CohortProfit = { ...labels, available: false, message: NOT_ENOUGH_CLOSED };

  const cohort = { tenantId, deletedAt: null, createdAt: { gte: from, lt: to }, status: { notIn: ['payment_pending', 'payment_failed', 'digital_delivered'] as ('payment_pending' | 'payment_failed' | 'digital_delivered')[] } };
  const deliveredCohort = { ...cohort, status: 'delivered' as const };
  const [rate, placed, sums, commission, unstamped, statement] = await Promise.all([
    rates(tenantId, from, to),
    prisma.order.count({ where: cohort }),
    prisma.order.aggregate({ where: deliveredCohort, _count: { _all: true }, _sum: { totalAmount: true, deliveryFee: true, landedCostTotal: true } }),
    prisma.commissionEntry.aggregate({ where: { tenantId, status: { not: 'void' }, order: deliveredCohort }, _sum: { amount: true } }),
    // Orders delivered before the landed cost was stamped on them: cost them at the product's current cost
    prisma.orderItem.findMany({ where: { order: { ...deliveredCohort, landedCostTotal: null } }, select: { quantity: true, product: { select: { cogs: true } } } }),
    incomeStatementOver(from, to),
  ]);
  const yieldPct = rate.orderToCashYield.value;
  const n = sums._count._all;
  if (yieldPct === null || n === 0) return notEnough;

  const avg = (total: Money.MoneyInput) => Money.div(total, n);
  const revenuePer = avg(Money.orZero(sums._sum.totalAmount));
  const costPer = avg(Money.add(Money.orZero(sums._sum.landedCostTotal), Money.sum(unstamped.map((i) => Money.mul(Money.orZero(i.product.cogs), i.quantity)))));
  const feePer = avg(Money.orZero(sums._sum.deliveryFee));
  const commissionPer = avg(Money.orZero(commission._sum.amount));

  const projected = Money.roundHalfUp(Money.mul(placed, Money.div(yieldPct, 100)), 0).toNumber();
  const revenue = Money.mul(projected, revenuePer);
  const cost = Money.mul(projected, costPer);
  const fees = Money.mul(projected, feePer);
  const rep = Money.mul(projected, commissionPer);
  const ads = Money.parse(statement.metaSpend);
  const profit = Money.sub(revenue, Money.sum([cost, fees, rep, ads]));

  return {
    ...labels, available: true,
    yieldPct, yieldLabel: `Projected at ${Money.roundHalfUp(yieldPct, 0).toString()}% yield`,
    ordersPlaced: placed, projectedDelivered: projected,
    revenue: Money.toApi(revenue), productCost: Money.toApi(cost), fees: Money.toApi(fees),
    metaAds: Money.toApi(ads), repCommission: Money.toApi(rep),
    profitBeforeOtherExpenses: Money.toApi(profit), marginPct: Money.percentOrNull(profit, revenue),
    profitPerDeliveredOrder: projected > 0 ? Money.toApi(Money.roundHalfUp(Money.div(profit, projected), 2)) : null,
    byDeliveryDate: statement.netProfit,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// F-926 cost of failed deliveries, F-721 cost of a refused delivery
// ---------------------------------------------------------------------------------------------------------------------

export interface FailedCostPartner {
  partnerId: number | null;
  name: string;
  failedOrders: number;
  /** Fees the partner kept on failed and returned orders (5070, outcome failed or returned). */
  fees: string;
  unitsLost: number;
  lostCost: string;
  total: string;
  hint: string | null;
}

export interface FailedDeliveryCost {
  from: string;
  to: string;
  partners: FailedCostPartner[];
  fees: string;
  unitsLost: number;
  lostCost: string;
  total: string;
}

/** Return transfers we count for units lost: the same status filter as the stock-gap Findings (inventoryReadService). */
const COUNTED_RETURN = { transferType: 'return_to_warehouse' as const, status: { in: ['received' as const, 'disputed' as const] }, receivedQuantity: { not: null } };

/** Units sent back by a partner and never received, at the product's landed cost per unit (Product.cogs, kept current by each received shipment). */
function lostUnits(transfers: Array<{ quantity: number; receivedQuantity: number | null; product: { cogs: Money.MoneyInput | null } }>): { units: number; value: Money.Money } {
  let units = 0;
  const values: Money.Money[] = [];
  for (const t of transfers) {
    const missing = t.quantity - t.receivedQuantity!;
    if (missing <= 0) continue;
    units += missing;
    values.push(Money.mul(missing, Money.orZero(t.product.cogs)));
  }
  return { units, value: Money.sum(values) };
}

/**
 * What failed and returned orders cost in [from, to): the fees kept on them (ledger 5070 entries of outcome failed or
 * returned, by entry date, split by partner) plus the returned units that never arrived (sent less received on a return
 * transfer) at landed cost. A partner with no fee rule shows fee 0 and a hint.
 */
export async function failedDeliveryCost(from: Date, to: Date): Promise<FailedDeliveryCost> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(getTenantId());
  const partnerSelect = { select: { id: true, firstName: true, lastName: true } } as const;

  const [feeLines, histories, transfers] = await Promise.all([
    prisma.accountTransaction.findMany({
      where: {
        tenantId, account: { code: GL_ACCOUNTS.DELIVERY_FEES },
        journalEntry: {
          isVoided: false, sourceType: 'delivery_fee', entryDate: { gte: from, lt: to },
          OR: [{ externalRef: { startsWith: 'failed:' } }, { externalRef: { startsWith: 'returned:' } }],
        },
      },
      select: { debitAmount: true, creditAmount: true, journalEntry: { select: { sourceId: true } } },
    }),
    prisma.orderHistory.findMany({
      where: { tenantId, status: { in: ['failed_delivery', 'returned'] }, createdAt: { gte: from, lt: to } },
      select: { orderId: true, order: { select: { deliveryAgent: partnerSelect } } },
    }),
    prisma.inventoryTransfer.findMany({
      where: { tenantId, ...COUNTED_RETURN, OR: [{ receivedAt: { gte: from, lt: to } }, { receivedAt: null, createdAt: { gte: from, lt: to } }] },
      select: {
        quantity: true, receivedQuantity: true, product: { select: { cogs: true } },
        fromLocation: { select: { user: partnerSelect } }, order: { select: { deliveryAgent: partnerSelect } },
      },
    }),
  ]);
  // The fee lines carry the order id; its partner comes from the order
  const feeOrders = await prisma.order.findMany({
    where: { id: { in: [...new Set(feeLines.map((l) => l.journalEntry.sourceId as number))] } },
    select: { id: true, deliveryAgent: partnerSelect },
  });
  const partnerOfOrder = new Map(feeOrders.map((o) => [o.id, o.deliveryAgent]));

  type Partner = { id: number; firstName: string; lastName: string } | null;
  type Row = { partner: Partner; fees: Money.Money[]; orders: Set<number>; transfers: typeof transfers };
  const byPartner = new Map<number | null, Row>();
  const row = (partner: Partner | undefined): Row => {
    const id = partner?.id ?? null;
    let r = byPartner.get(id);
    if (!r) byPartner.set(id, (r = { partner: partner ?? null, fees: [], orders: new Set(), transfers: [] }));
    return r;
  };
  for (const l of feeLines) row(partnerOfOrder.get(l.journalEntry.sourceId as number)).fees.push(Money.sub(l.debitAmount, l.creditAmount));
  for (const h of histories) row(h.order.deliveryAgent).orders.add(h.orderId);
  for (const t of transfers) row(t.fromLocation?.user ?? t.order?.deliveryAgent).transfers.push(t);

  const today = new Date();
  const partners: FailedCostPartner[] = await Promise.all([...byPartner.values()].map(async (r) => {
    const fees = Money.sum(r.fees);
    const lost = lostUnits(r.transfers);
    const noRule = r.partner !== null && !(await resolveFee(prisma, r.partner.id, 'failed', today, 0, tenantId)).hasRule;
    return {
      partnerId: r.partner?.id ?? null,
      name: r.partner ? `${r.partner.firstName} ${r.partner.lastName}`.trim() : 'No partner',
      failedOrders: r.orders.size,
      fees: Money.toApi(fees),
      unitsLost: lost.units,
      lostCost: Money.toApi(lost.value),
      total: Money.toApi(Money.add(fees, lost.value)),
      hint: noRule ? 'No fee rule for this partner. The failed fee is 0.' : null,
    };
  }));
  partners.sort((a, b) => Money.compare(b.total, a.total) || (a.partnerId ?? 0) - (b.partnerId ?? 0));

  const sum = (pick: (p: FailedCostPartner) => string) => Money.sum(partners.map(pick));
  return {
    from: localDate(from, zone), to: localDate(new Date(to.getTime() - 1), zone),
    partners,
    fees: Money.toApi(sum((p) => p.fees)),
    unitsLost: partners.reduce((t, p) => t + p.unitsLost, 0),
    lostCost: Money.toApi(sum((p) => p.lostCost)),
    total: Money.toApi(sum((p) => p.total)),
  };
}

export interface RefusalCost { failedFee: string; unitsLost: number; landedCostPerUnit: string; lostCost: string; total: string }

/**
 * F-721: cost of one refused delivery = the failed fee stamped on the order + units lost in its return x landed cost.
 * A fee not stamped yet is read from the partner's failed rule in force today (feeRuleService.resolveFee); no rule gives 0.
 * Units are lost only when a return transfer of the order shows fewer received than sent. Customers and the failed-delivery
 * card both read this.
 */
export async function refusalCost(order: { id: number; deliveryFee?: Money.MoneyInput | null; deliveryAgentId?: number | null; totalAmount?: Money.MoneyInput | null }): Promise<RefusalCost> {
  const tenantId = resolveTenantId();
  const [fee, transfers] = await Promise.all([
    order.deliveryFee !== null && order.deliveryFee !== undefined ? Money.parse(order.deliveryFee)
      : order.deliveryAgentId ? resolveFee(prisma, order.deliveryAgentId, 'failed', new Date(), Money.orZero(order.totalAmount), tenantId).then((r) => r.fee)
        : Money.ZERO,
    prisma.inventoryTransfer.findMany({
      where: { tenantId, orderId: order.id, ...COUNTED_RETURN },
      select: { quantity: true, receivedQuantity: true, product: { select: { cogs: true } } },
    }),
  ]);
  const lost = lostUnits(transfers);
  return {
    failedFee: Money.toApi(fee), unitsLost: lost.units,
    landedCostPerUnit: Money.toApi(lost.units > 0 ? Money.div(lost.value, lost.units) : Money.ZERO),
    lostCost: Money.toApi(lost.value), total: Money.toApi(Money.add(fee, lost.value)),
  };
}
