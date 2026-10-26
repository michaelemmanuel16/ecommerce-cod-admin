/**
 * M5-T26 (COD-52, F-924, F-925, F-926, F-721): profit by product, the order cohort card, the cost of failed deliveries
 * and the cost of one refused delivery. Every range is [from, to) as instants (readRange). Money is an API string.
 *
 * Limits: an order in another currency is counted at its face amount (the ledger statements convert, this table does
 * not); Meta spend has no campaign-to-product mapping before M8 (F-1003), so all of it is "Meta spend with no product".
 */
import prisma from '../../utils/prisma';
import { withSoftDeleted } from '../../utils/prismaExtensions';
import * as Money from '../../utils/money';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { getStoreTimeZone, localDate, utcDateOfYmd } from '../kpi/dates';
import { getTenantId, resolveTenantId } from '../../utils/tenantContext';
import { rates } from '../kpi/rates';
import { incomeStatementOver, pct } from './statementsService';

const COST_MISSING = 'Cost missing';

/** Orders counted as delivered in a range: the revenue window of the KPI (delivery date, else last update for old rows). */
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
  const total = weights.reduce((t, w) => Money.add(t, w), Money.ZERO);
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
  /** Sums of the product rows (profit counts the rows that have a cost; see `costMissingProducts`). */
  totals: { delivered: number; revenue: string; productCost: string; fees: string; metaAds: string };
  metaSpendWithNoProduct: string;
  repCommission: string;
  /** Every other cost of the range (failed-delivery fees, other expenses), so the net result equals the income statement. */
  otherExpenses: string;
  netProfit: string;
  netMarginPct: number | null;
  /** Net profit / delivered orders of the whole range (the "-GH₵38" tile). Null when nothing was delivered. */
  profitPerDeliveredOrder: string | null;
  costMissingProducts: number;
}

export async function profitByProduct(from: Date, to: Date): Promise<ProfitByProduct> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(getTenantId());
  const [orders, statement] = await Promise.all([
    prisma.order.findMany({
      where: deliveredWhere(from, to),
      select: {
        id: true, status: true, totalAmount: true, deliveryFee: true, landedCostTotal: true,
        orderItems: { select: { productId: true, quantity: true, totalPrice: true, product: { select: { cogs: true, productType: true } } } },
      },
    }),
    incomeStatementOver(from, to),
  ]);

  const productIds = [...new Set(orders.flatMap((o) => o.orderItems.map((i) => i.productId)))];
  const products = productIds.length
    ? await withSoftDeleted(() => prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true, cogs: true, productType: true } }))
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  // Paystack fee of each digital order: the 5060 debit of its digital_sale entry.
  const digitalIds = orders.filter((o) => o.status === 'digital_delivered').map((o) => o.id);
  const paystackByOrder = new Map<number, Money.Money>();
  if (digitalIds.length > 0) {
    const lines = await prisma.accountTransaction.findMany({
      where: { tenantId, account: { code: GL_ACCOUNTS.PAYSTACK_FEES }, journalEntry: { isVoided: false, sourceType: 'digital_sale', sourceId: { in: digitalIds } } },
      select: { debitAmount: true, creditAmount: true, journalEntry: { select: { sourceId: true } } },
    });
    for (const l of lines) {
      const id = l.journalEntry.sourceId as number;
      paystackByOrder.set(id, Money.add(paystackByOrder.get(id) ?? Money.ZERO, Money.sub(l.debitAmount, l.creditAmount)));
    }
  }

  type Acc = { orders: Set<number>; units: number; revenue: Money.Money; cost: Money.Money; fees: Money.Money };
  const acc = new Map<number, Acc>();
  const slot = (id: number): Acc => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { orders: new Set(), units: 0, revenue: Money.ZERO, cost: Money.ZERO, fees: Money.ZERO }));
    return a;
  };
  for (const order of orders) {
    // A free bundled digital item (price 0) is not a sale of its own: it adds no revenue, cost or count.
    const items = order.orderItems.filter((i) => !(Money.orZero(i.totalPrice).isZero() && i.product.productType === 'digital'));
    if (items.length === 0) continue;
    const revenueShares = shares(Money.orZero(order.totalAmount), items.map((i) => Money.orZero(i.totalPrice)));
    const itemCost = items.map((i) => Money.mul(Money.orZero(i.product.cogs), i.quantity));
    const orderCost = order.landedCostTotal != null ? Money.parse(order.landedCostTotal) : itemCost.reduce((t, c) => Money.add(t, c), Money.ZERO);
    const costShares = shares(orderCost, itemCost.map((c, k) => (c.isZero() ? Money.mul(Money.parse('0.0001'), items[k].quantity) : c)));
    const orderFee = order.status === 'digital_delivered' ? paystackByOrder.get(order.id) ?? Money.ZERO : Money.orZero(order.deliveryFee);
    const feeShares = shares(orderFee, items.map((i) => Money.orZero(i.totalPrice)));
    items.forEach((item, k) => {
      const a = slot(item.productId);
      a.orders.add(order.id);
      a.units += item.quantity;
      a.revenue = Money.add(a.revenue, revenueShares[k]);
      a.cost = Money.add(a.cost, costShares[k]);
      a.fees = Money.add(a.fees, feeShares[k]);
    });
  }

  const rows: ProductProfitRow[] = [...acc.entries()].map(([productId, a]) => {
    const product = productById.get(productId);
    const type = product?.productType ?? 'physical';
    const costMissing = type !== 'digital' && !Money.isNonZero(product?.cogs);
    const delivered = a.orders.size;
    const profit = costMissing ? null : Money.sub(Money.sub(a.revenue, a.cost), a.fees);
    return {
      productId, sku: product?.sku ?? '', name: product?.name ?? '', productType: type,
      delivered, units: a.units,
      revenue: Money.toApi(a.revenue),
      productCost: costMissing ? null : Money.toApi(a.cost),
      costMissing, costNote: costMissing ? COST_MISSING : null,
      fees: Money.toApi(a.fees),
      metaAds: Money.toApi(Money.ZERO),
      profit: profit ? Money.toApi(profit) : null,
      marginPct: profit ? pct(profit, a.revenue) : null,
      profitPerDeliveredOrder: profit && delivered > 0 ? Money.toApi(Money.roundHalfUp(Money.div(profit, delivered), 2)) : null,
    };
  }).sort((x, y) => Money.compare(y.revenue, x.revenue) || x.productId - y.productId);

  const sumRows = (pick: (r: ProductProfitRow) => string | null) => rows.reduce((t, r) => Money.add(t, pick(r) ?? 0), Money.ZERO);
  const revenue = sumRows((r) => r.revenue);
  const cost = [...acc.values()].reduce((t, a) => Money.add(t, a.cost), Money.ZERO);
  const fees = sumRows((r) => r.fees);
  const meta = Money.parse(statement.metaSpend);
  const commission = Money.parse(statement.repCommission);
  // Everything else the ledger carries: fees on failed orders, Paystack on physical orders, other expenses, and any cost
  // difference between the ledger and the order rows. The net result then matches the income statement.
  const other = Money.sub(Money.sub(Money.sub(Money.sub(Money.parse(statement.totalExpenses), cost), fees), meta), commission);
  const net = Money.sub(Money.sub(Money.sub(Money.sub(Money.sub(revenue, cost), fees), meta), commission), other);
  const deliveredOrders = orders.length;

  return {
    from: localDate(from, zone), to: localDate(new Date(to.getTime() - 1), zone),
    products: rows,
    totals: { delivered: deliveredOrders, revenue: Money.toApi(revenue), productCost: Money.toApi(cost), fees: Money.toApi(fees), metaAds: Money.toApi(Money.ZERO) },
    metaSpendWithNoProduct: Money.toApi(meta),
    repCommission: Money.toApi(commission),
    otherExpenses: Money.toApi(other),
    netProfit: Money.toApi(net),
    netMarginPct: pct(net, revenue),
    profitPerDeliveredOrder: deliveredOrders > 0 ? Money.toApi(Money.roundHalfUp(Money.div(net, deliveredOrders), 2)) : null,
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
    /** The two ways to read the range: net result by delivery date, projected profit by order cohort. */
    byDeliveryDate: string; byOrderCohort: string;
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

  const yieldKpi = (await rates(tenantId, from, to)).orderToCashYield;
  if (yieldKpi.value === null) return notEnough;
  const yieldPct = yieldKpi.value;

  const cohort = { tenantId, deletedAt: null, createdAt: { gte: from, lt: to }, status: { notIn: ['payment_pending', 'payment_failed', 'digital_delivered'] as ('payment_pending' | 'payment_failed' | 'digital_delivered')[] } };
  const [placed, delivered, statement] = await Promise.all([
    prisma.order.count({ where: cohort }),
    prisma.order.findMany({
      where: { ...cohort, status: 'delivered' },
      select: { id: true, totalAmount: true, deliveryFee: true, landedCostTotal: true, orderItems: { select: { quantity: true, product: { select: { cogs: true } } } } },
    }),
    incomeStatementOver(from, to),
  ]);
  if (delivered.length === 0) return notEnough;

  const n = delivered.length;
  const avg = (total: Money.Money) => Money.div(total, n);
  const revenuePer = avg(delivered.reduce((t, o) => Money.add(t, o.totalAmount), Money.ZERO));
  const costPer = avg(delivered.reduce((t, o) => Money.add(t, o.landedCostTotal != null
    ? o.landedCostTotal
    : o.orderItems.reduce((c, i) => Money.add(c, Money.mul(Money.orZero(i.product.cogs), i.quantity)), Money.ZERO)), Money.ZERO));
  const feePer = avg(delivered.reduce((t, o) => Money.add(t, Money.orZero(o.deliveryFee)), Money.ZERO));
  const commission = await prisma.commissionEntry.aggregate({
    where: { tenantId, orderId: { in: delivered.map((o) => o.id) }, status: { not: 'void' } },
    _sum: { amount: true },
  });
  const commissionPer = avg(Money.orZero(commission._sum.amount));

  const projected = Money.roundHalfUp(Money.mul(placed, Money.div(yieldPct, 100)), 0).toNumber();
  const revenue = Money.mul(projected, revenuePer);
  const cost = Money.mul(projected, costPer);
  const fees = Money.mul(projected, feePer);
  const rep = Money.mul(projected, commissionPer);
  const ads = Money.parse(statement.metaSpend);
  const profit = Money.sub(Money.sub(Money.sub(Money.sub(revenue, cost), fees), rep), ads);

  return {
    ...labels, available: true,
    yieldPct, yieldLabel: `Projected at ${Money.roundHalfUp(yieldPct, 0).toString()}% yield`,
    ordersPlaced: placed, projectedDelivered: projected,
    revenue: Money.toApi(revenue), productCost: Money.toApi(cost), fees: Money.toApi(fees),
    metaAds: Money.toApi(ads), repCommission: Money.toApi(rep),
    profitBeforeOtherExpenses: Money.toApi(profit), marginPct: pct(profit, revenue),
    profitPerDeliveredOrder: projected > 0 ? Money.toApi(Money.roundHalfUp(Money.div(profit, projected), 2)) : null,
    byDeliveryDate: statement.netProfit, byOrderCohort: Money.toApi(profit),
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

/** Cost of one unit lost in a return: the product's landed cost per unit (kept current by each received shipment). */
async function landedCostByProduct(productIds: number[]): Promise<Map<number, Money.Money>> {
  if (productIds.length === 0) return new Map();
  const products = await withSoftDeleted(() => prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, cogs: true } }));
  return new Map(products.map((p) => [p.id, Money.orZero(p.cogs)]));
}

/**
 * What failed and returned orders cost in [from, to): the fees kept on them (ledger 5070 entries of outcome failed or
 * returned, by order date, split by partner) plus the returned units that never arrived (sent less received on a return
 * transfer) at landed cost. A partner with no fee rule shows fee 0 and a hint.
 */
export async function failedDeliveryCost(from: Date, to: Date): Promise<FailedDeliveryCost> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(getTenantId());

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
      select: { orderId: true },
    }),
    prisma.inventoryTransfer.findMany({
      where: {
        tenantId, transferType: 'return_to_warehouse', status: { not: 'cancelled' }, receivedQuantity: { not: null },
        OR: [{ receivedAt: { gte: from, lt: to } }, { receivedAt: null, createdAt: { gte: from, lt: to } }],
      },
      select: { productId: true, quantity: true, receivedQuantity: true, fromLocation: { select: { userId: true } }, order: { select: { deliveryAgentId: true } } },
    }),
  ]);

  const orderIds = [...new Set([...feeLines.map((l) => l.journalEntry.sourceId as number), ...histories.map((h) => h.orderId)])];
  const orders = orderIds.length
    ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, deliveryAgentId: true } })
    : [];
  const partnerOfOrder = new Map(orders.map((o) => [o.id, o.deliveryAgentId]));
  const cost = await landedCostByProduct([...new Set(transfers.map((t) => t.productId))]);

  type Row = { fees: Money.Money; orders: Set<number>; units: number; lost: Money.Money };
  const byPartner = new Map<number | null, Row>();
  const row = (id: number | null): Row => {
    let r = byPartner.get(id);
    if (!r) byPartner.set(id, (r = { fees: Money.ZERO, orders: new Set(), units: 0, lost: Money.ZERO }));
    return r;
  };
  for (const l of feeLines) {
    const orderId = l.journalEntry.sourceId as number;
    const r = row(partnerOfOrder.get(orderId) ?? null);
    r.fees = Money.add(r.fees, Money.sub(l.debitAmount, l.creditAmount));
  }
  for (const h of histories) row(partnerOfOrder.get(h.orderId) ?? null).orders.add(h.orderId);
  for (const t of transfers) {
    const missing = t.quantity - (t.receivedQuantity ?? t.quantity);
    if (missing <= 0) continue;
    const r = row(t.fromLocation?.userId ?? t.order?.deliveryAgentId ?? null);
    r.units += missing;
    r.lost = Money.add(r.lost, Money.mul(missing, cost.get(t.productId) ?? Money.ZERO));
  }

  const partnerIds = [...byPartner.keys()].filter((id): id is number => id !== null);
  const [users, ruleCounts] = partnerIds.length
    ? await Promise.all([
      withSoftDeleted(() => prisma.user.findMany({ where: { id: { in: partnerIds } }, select: { id: true, firstName: true, lastName: true } })),
      prisma.feeRule.groupBy({ by: ['partnerUserId'], where: { tenantId, partnerUserId: { in: partnerIds }, validFrom: { lte: utcDateOfYmd(localDate(new Date(), zone)) } }, _count: { _all: true } }),
    ])
    : [[], []];
  const nameOf = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const hasRule = new Set(ruleCounts.map((r) => r.partnerUserId));

  const partners: FailedCostPartner[] = [...byPartner.entries()].map(([partnerId, r]) => ({
    partnerId,
    name: partnerId === null ? 'No partner' : nameOf.get(partnerId) ?? `Partner ${partnerId}`,
    failedOrders: r.orders.size,
    fees: Money.toApi(r.fees),
    unitsLost: r.units,
    lostCost: Money.toApi(r.lost),
    total: Money.toApi(Money.add(r.fees, r.lost)),
    hint: partnerId !== null && !hasRule.has(partnerId) ? 'No fee rule for this partner. The failed fee is 0.' : null,
  })).sort((a, b) => Money.compare(b.total, a.total) || (a.partnerId ?? 0) - (b.partnerId ?? 0));

  const sum = (pick: (p: FailedCostPartner) => string) => partners.reduce((t, p) => Money.add(t, pick(p)), Money.ZERO);
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
 * A fee not stamped yet is read from the partner's failed rule in force today; no rule gives 0. Units are lost only when a
 * return transfer of the order shows fewer received than sent. Customers and the failed-delivery card both read this.
 */
export async function refusalCost(order: { id: number; deliveryFee?: Money.MoneyInput | null; deliveryAgentId?: number | null; totalAmount?: Money.MoneyInput | null }): Promise<RefusalCost> {
  const tenantId = resolveTenantId();
  let fee: Money.Money;
  if (order.deliveryFee !== null && order.deliveryFee !== undefined) {
    fee = Money.parse(order.deliveryFee);
  } else if (order.deliveryAgentId) {
    const today = utcDateOfYmd(localDate(new Date(), getStoreTimeZone(tenantId)));
    const rule = await prisma.feeRule.findFirst({
      where: { tenantId, partnerUserId: order.deliveryAgentId, outcome: 'failed', validFrom: { lte: today } },
      orderBy: { validFrom: 'desc' }, select: { basis: true, amount: true },
    });
    fee = !rule ? Money.ZERO
      : rule.basis === 'percent' ? Money.roundHalfUp(Money.mul(Money.orZero(order.totalAmount), Money.div(rule.amount, 100)), 2)
        : Money.parse(rule.amount);
  } else {
    fee = Money.ZERO;
  }

  const transfers = await prisma.inventoryTransfer.findMany({
    where: { tenantId, orderId: order.id, transferType: 'return_to_warehouse', status: { not: 'cancelled' }, receivedQuantity: { not: null } },
    select: { productId: true, quantity: true, receivedQuantity: true },
  });
  const cost = await landedCostByProduct([...new Set(transfers.map((t) => t.productId))]);
  let units = 0;
  let lost = Money.ZERO;
  for (const t of transfers) {
    const missing = t.quantity - (t.receivedQuantity ?? t.quantity);
    if (missing <= 0) continue;
    units += missing;
    lost = Money.add(lost, Money.mul(missing, cost.get(t.productId) ?? Money.ZERO));
  }
  return {
    failedFee: Money.toApi(fee), unitsLost: units,
    landedCostPerUnit: Money.toApi(units > 0 ? Money.div(lost, units) : Money.ZERO),
    lostCost: Money.toApi(lost), total: Money.toApi(Money.add(fee, lost)),
  };
}
