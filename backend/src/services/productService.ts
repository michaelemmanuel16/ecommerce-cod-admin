import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { withSoftDeleted } from '../utils/prismaExtensions';
import * as Money from '../utils/money';
import { PHYSICAL, RESERVING, createProductWithStock, getLocation, getOnHandMany, getReservedMany } from './stockService';
import { productDeliveredUnits } from './kpi/products';
import { DAY_MS, MONTH_RE, getStoreTimeZone, localDate, monthRange } from './kpi/dates';
import { ratePercent } from './kpi/rates';
import { canSeeCost } from '../utils/costAccess';

/**
 * Products API (F-600, F-601, F-602, M4-T16). Stock figures are computed from the levels and the orders, never stored:
 * on hand and reserved over the holders, days of cover from the last 14 days of deliveries, delivered units from the one
 * KPI function. Cost and margin go only to roles that may see cost.
 */

/** Days of cover under which a product is "low stock" when it has no setting of its own (F-601). M7 reads the setting. */
export const DEFAULT_LOW_STOCK_DAYS = 14;
const COVER_WINDOW_DAYS = 14;
/** The product without its cost fields, for roles that may not see them. */
export function withoutCost<T extends { cogs?: unknown; marginPct?: unknown }>(product: T): Omit<T, 'cogs' | 'marginPct'> {
  const { cogs: _cogs, marginPct: _margin, ...rest } = product;
  return rest;
}
/** Apply the role rule to a product row or a list of them. */
export const forRole = <T extends { cogs?: unknown; marginPct?: unknown }>(role: string | undefined, product: T) => (canSeeCost(role) ? product : withoutCost(product));

const wholePercent = (num: Money.MoneyInput, den: Money.MoneyInput): number | null =>
  Money.parse(den).isZero() ? null : Money.roundHalfUp(Money.mul(Money.div(num, den), 100), 0).toNumber();

/** A physical product with cost 0 or none has no cost set: it has no margin and stays out of the average. A digital product at cost 0 is 100%, which is real. */
const hasCost = (p: { productType: string; cogs: Money.MoneyInput | null | undefined }) => p.productType === 'digital' || !Money.orZero(p.cogs).isZero();

/** Margin before delivery: (price - cost) / price, whole percent. Null when the price is 0 or a physical product has no cost set. */
export function marginPercent(price: Money.MoneyInput, cost: Money.MoneyInput | null | undefined, productType = 'physical'): number | null {
  return hasCost({ productType, cogs: cost }) ? wholePercent(Money.sub(price, Money.orZero(cost)), price) : null;
}

/** On hand divided by the average units delivered per day over the last 14 days. Null when nothing sold ("No sales"). */
export function daysOfCover(onHand: number, unitsLast14: number): number | null {
  if (unitsLast14 <= 0) return null;
  return Money.roundHalfUp(Money.div(onHand, Money.div(unitsLast14, COVER_WINDOW_DAYS)), 1).toNumber();
}

export type ProductStatus = 'archived' | 'digital' | 'out_of_stock' | 'low_stock' | 'active';

/** Status tag of a row (F-600): Archived, Digital, Out of stock (physical, 0 or less on hand), Low stock, else Active. */
export function productStatus(p: { isActive: boolean; productType: string }, onHand: number, cover: number | null, lowDays: number): ProductStatus {
  if (!p.isActive) return 'archived';
  if (p.productType === 'digital') return 'digital';
  if (onHand <= 0) return 'out_of_stock';
  return cover != null && cover < lowDays ? 'low_stock' : 'active';
}

/** [from, to) of `month` (YYYY-MM), default the current store-zone month. 400 for a bad month. */
function monthWindow(month?: string) {
  const zone = getStoreTimeZone(resolveTenantId());
  const ym = month ?? localDate(new Date(), zone).slice(0, 7);
  const m = MONTH_RE.exec(ym);
  if (!m) throw new AppError('month must be YYYY-MM', 400);
  return { month: ym, ...monthRange(Number(m[1]), Number(m[2]), zone) };
}

type Row = Prisma.ProductGetPayload<object>;

/** Delivered / (delivered + failed + returned) on closed orders that hold the product, closed in the window (orders, not units). */
async function deliverySuccess(ids: number[], from: Date, to: Date): Promise<Map<number, number | null>> {
  const rows = await prisma.$queryRaw<Array<{ productId: number; delivered: bigint; closed: bigint }>>(Prisma.sql`
    SELECT i.product_id AS "productId",
           COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'delivered') AS delivered,
           COUNT(DISTINCT o.id) AS closed
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.tenant_id = ${resolveTenantId()} AND o.deleted_at IS NULL AND o.status IN ('delivered', 'failed_delivery', 'returned')
      AND i.product_id IN (${Prisma.join(ids)})
      AND (CASE o.status WHEN 'delivered' THEN COALESCE(o.delivery_date, o.updated_at)
                         WHEN 'returned' THEN COALESCE(o.returned_at, o.updated_at)
                         ELSE o.updated_at END) >= ${from}
      AND (CASE o.status WHEN 'delivered' THEN COALESCE(o.delivery_date, o.updated_at)
                         WHEN 'returned' THEN COALESCE(o.returned_at, o.updated_at)
                         ELSE o.updated_at END) < ${to}
    GROUP BY 1`);
  return new Map(rows.map((r) => [r.productId, ratePercent(Number(r.delivered), Number(r.closed))]));
}

/** Days of cover and the delivered-last-14-days figure of one product. */
function coverOf(p: { productType: string }, onHand: number, units14: number): number | null {
  return p.productType === 'digital' ? null : daysOfCover(onHand, units14);
}

/** Units delivered per product over the last 14 days, for the given ids. */
async function recentUnits(ids: number[]): Promise<Map<number, number>> {
  const now = new Date();
  const recent = await productDeliveredUnits(resolveTenantId(), ids, new Date(now.getTime() - COVER_WINDOW_DAYS * DAY_MS), now);
  return new Map((recent.byProduct ?? []).map((l) => [l.productId, l.units]));
}

/** The computed figures for a set of products in one month. Every read is limited to these products. */
async function figures(products: Row[], window: { from: Date; to: Date }) {
  const ids = products.map((p) => p.id);
  if (ids.length === 0) return [];
  const [onHand, reserved, inMonth, last14, success] = await Promise.all([
    getOnHandMany(ids),
    getReservedMany(ids),
    productDeliveredUnits(resolveTenantId(), ids, window.from, window.to),
    recentUnits(ids),
    deliverySuccess(ids, window.from, window.to),
  ]);
  const monthUnits = new Map((inMonth.byProduct ?? []).map((l) => [l.productId, l.units]));

  return products.map((p) => {
    const digital = p.productType === 'digital';
    const stock = onHand.get(p.id) ?? 0;
    const cover = coverOf(p, stock, last14.get(p.id) ?? 0);
    const lowDays = p.lowStockDays ?? DEFAULT_LOW_STOCK_DAYS;
    return {
      ...p,
      onHandTotal: digital ? null : stock,
      reservedTotal: digital ? null : reserved.get(p.id) ?? 0,
      daysOfCover: cover,
      lowStockDaysEffective: digital ? null : lowDays,
      deliveredInPeriod: monthUnits.get(p.id) ?? 0,
      deliverySuccess: digital ? null : success.get(p.id) ?? null,
      marginPct: marginPercent(p.price, p.cogs, p.productType),
      status: productStatus(p, stock, cover, lowDays),
    };
  });
}

export type TabName = 'active' | 'archived' | 'all';

export interface ListFilters { search?: string; category?: string; isActive?: boolean; tab?: TabName; month?: string; page: number; limit: number }

/** GET /api/products. Without `tab` the list is the active products, as before. `counts` are the tab counts. */
export async function listProducts(f: ListFilters) {
  const window = monthWindow(f.month);
  const where: Prisma.ProductWhereInput = {};
  if (f.search) where.OR = [{ name: { contains: f.search, mode: 'insensitive' } }, { sku: { contains: f.search, mode: 'insensitive' } }, { category: { contains: f.search, mode: 'insensitive' } }];
  if (f.category) where.category = f.category;
  const tab = f.tab ?? (f.isActive === false ? 'archived' : 'active');
  if (tab !== 'all') where.isActive = tab === 'active';
  else if (f.isActive !== undefined) where.isActive = f.isActive;

  const [rows, total, tabs] = await withSoftDeleted(() => Promise.all([
    prisma.product.findMany({ where, skip: (f.page - 1) * f.limit, take: f.limit, orderBy: { createdAt: 'desc' } }),
    prisma.product.count({ where }),
    prisma.product.groupBy({ by: ['isActive'], _count: { _all: true } }),
  ]));
  const active = tabs.find((t) => t.isActive)?._count._all ?? 0;
  const archived = tabs.find((t) => !t.isActive)?._count._all ?? 0;
  return {
    products: await figures(rows, window),
    pagination: { page: f.page, limit: f.limit, total, pages: Math.ceil(total / f.limit) },
    counts: { active, archived, all: active + archived },
    month: window.month,
  };
}

/** GET /api/products/summary: the four tiles of the Products page. */
export async function productsSummary(monthParam?: string) {
  const window = monthWindow(monthParam);
  const [all, delivered] = await Promise.all([
    withSoftDeleted(() => prisma.product.findMany({ select: { id: true, price: true, cogs: true, isActive: true, productType: true, lowStockDays: true } })),
    productDeliveredUnits(resolveTenantId(), 'all', window.from, window.to),
  ]);
  const byProduct = delivered.byProduct ?? [];
  const priced = new Map(all.map((p) => [p.id, p]));

  const top = byProduct[0];
  let margin = Money.ZERO;
  let revenue = Money.ZERO;
  for (const line of byProduct) {
    const p = priced.get(line.productId);
    if (!p || !hasCost(p)) continue;
    margin = Money.add(margin, Money.mul(line.units, Money.sub(p.price, Money.orZero(p.cogs))));
    revenue = Money.add(revenue, Money.mul(line.units, p.price));
  }
  const active = all.filter((p) => p.isActive);
  return {
    month: window.month,
    activeProducts: { active: active.length, archived: all.length - active.length },
    bestSeller: top ? { productId: top.productId, name: top.name, sku: top.sku, units: top.units } : null,
    averageMargin: revenue.isZero() ? null : wholePercent(margin, revenue),
    lowStock: (await lowStockIds(active)).length,
  };
}

/** Ids of the active physical products whose days of cover are under their limit (one on-hand read, one 14-day read). */
async function lowStockIds(active: Array<{ id: number; isActive: boolean; productType: string; lowStockDays: number | null }>): Promise<number[]> {
  const physical = active.filter((p) => p.productType !== 'digital');
  if (physical.length === 0) return [];
  const ids = physical.map((p) => p.id);
  const [onHand, last14] = await Promise.all([getOnHandMany(ids), recentUnits(ids)]);
  return physical
    .filter((p) => {
      const stock = onHand.get(p.id) ?? 0;
      return productStatus(p, stock, coverOf(p, stock, last14.get(p.id) ?? 0), p.lowStockDays ?? DEFAULT_LOW_STOCK_DAYS) === 'low_stock';
    })
    .map((p) => p.id);
}

/** GET /api/products/low-stock: the active physical products under their days-of-cover limit, with the list columns, fewest days first. */
export async function lowStockProducts() {
  const active = await prisma.product.findMany({ where: { isActive: true, productType: { not: 'digital' } } });
  const low = new Set(await lowStockIds(active));
  const rows = await figures(active.filter((p) => low.has(p.id)), monthWindow());
  return rows.sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0) || a.id - b.id);
}

export async function getProduct(id: number) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new AppError('Product not found', 404);
  return { ...product, marginPct: marginPercent(product.price, product.cogs, product.productType) };
}

const FIELDS = [
  'sku', 'name', 'description', 'category', 'price', 'cogs', 'imageUrl', 'weight', 'dimensions', 'isActive', 'productType',
  'lowStockDays', 'lowStockThreshold', 'digitalFileUrl', 'digitalFileType', 'downloadLinkExpiryHours', 'maxDownloads',
] as const;

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

const refuseStockInput = (body: Record<string, unknown>) => {
  if ('stockQuantity' in body) throw new AppError('stockQuantity is not accepted. Give openingStock when you create a product, or use Adjust quantity in Inventory.', 400);
};

/** The location opening stock goes to when none is named: the first active 3PL, else the own store. */
async function defaultOpeningLocation(): Promise<number> {
  const first = (await prisma.stockLocation.findFirst({ where: { isActive: true, type: 'partner_3pl' }, orderBy: { id: 'asc' } }))
    ?? (await prisma.stockLocation.findFirst({ where: { isActive: true, type: 'own_store' }, orderBy: { id: 'asc' } }));
  if (!first) throw new AppError('Add a stock location first (Inventory), then give the starting stock', 400);
  return first.id;
}

export async function createProduct(actorId: number, body: Record<string, unknown>) {
  refuseStockInput(body);
  const data = pick(body) as Omit<Prisma.ProductUncheckedCreateInput, 'stockQuantity'>;
  const opening = body.openingStock as { locationId?: number; quantity: number } | undefined;

  // Archived products keep their SKU in the unique index, so this check has to see past the soft-delete filter,
  // otherwise the create fails on the constraint with a 500 instead of this 400.
  const existing = await withSoftDeleted(() => prisma.product.findFirst({ where: { sku: data.sku } }));
  if (existing) {
    throw new AppError(existing.isActive === false ? 'An archived product already uses this SKU. Restore that product instead.' : 'Product with this SKU already exists', 400);
  }
  if (opening && data.productType === 'digital') throw new AppError('A digital product has no stock', 400);

  return prisma.$transaction(async (tx) => {
    let openingInput: { locationId: number; quantity: number; createdById: number } | undefined;
    if (opening && opening.quantity > 0) {
      const locationId = opening.locationId ?? (await defaultOpeningLocation());
      const location = await getLocation(tx, locationId);
      if (location.type === 'in_transit') throw new AppError('The in-transit location holds no stock', 400);
      if (!location.isActive) throw new AppError(`${location.name} is not active`, 400);
      openingInput = { locationId, quantity: opening.quantity, createdById: actorId };
    }
    return createProductWithStock(tx, { ...data, tenantId: resolveTenantId() }, openingInput);
  });
}

export async function updateProduct(id: number, body: Record<string, unknown>) {
  refuseStockInput(body);
  if ('openingStock' in body) throw new AppError('Starting stock can only be given when the product is created. Change stock with Allocate or Adjust quantity.', 400);
  const current = await withSoftDeleted(() => prisma.product.findFirst({ where: { id } }));
  if (!current) throw new AppError('Product not found', 404);
  const data = pick(body);
  if (data.sku !== undefined && data.sku !== current.sku) {
    if (await withSoftDeleted(() => prisma.product.findFirst({ where: { sku: data.sku as string, NOT: { id } } }))) throw new AppError('Product with this SKU already exists', 400);
  }
  if (data.productType !== undefined && data.productType !== current.productType && (await prisma.orderItem.count({ where: { productId: id } })) > 0) {
    throw new AppError('The product type cannot change once the product has orders', 409);
  }
  return prisma.product.update({ where: { id }, data: data as Prisma.ProductUncheckedUpdateInput });
}

/** Archive (F-602): the product leaves new orders and forms, keeps its history and stock. Says what it still holds. */
export async function archiveProduct(id: number) {
  const current = await withSoftDeleted(() => prisma.product.findFirst({ where: { id } }));
  if (!current) throw new AppError('Product not found', 404);
  const [openOrders, onHand] = await Promise.all([
    prisma.order.count({ where: { status: { in: ['pending_confirmation', ...RESERVING] }, orderItems: { some: { productId: id } } } }),
    prisma.stockLevel.aggregate({ _sum: { quantity: true }, where: { productId: id, location: { isActive: true, type: { in: PHYSICAL } } } }),
  ]);
  const product = current.isActive ? await prisma.product.update({ where: { id }, data: { isActive: false } }) : current;
  return { product, openOrders, unitsOnHand: onHand._sum.quantity ?? 0 };
}

export async function restoreProduct(id: number) {
  const current = await withSoftDeleted(() => prisma.product.findFirst({ where: { id } }));
  if (!current) throw new AppError('Product not found', 404);
  return current.isActive ? current : prisma.product.update({ where: { id }, data: { isActive: true } });
}

/** DELETE: only a product with no orders. The delete is the same soft delete as before (the row stays, inactive). */
export async function deleteProduct(id: number) {
  const current = await withSoftDeleted(() => prisma.product.findFirst({ where: { id } }));
  if (!current) throw new AppError('Product not found', 404);
  if ((await prisma.orderItem.count({ where: { productId: id } })) > 0) throw new AppError('This product has orders. Archive it instead.', 409);
  await prisma.product.update({ where: { id }, data: { isActive: false } });
}
