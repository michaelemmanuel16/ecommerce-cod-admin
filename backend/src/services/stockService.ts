import { OrderStatus, Prisma, StockLocation, StockLocationType, TransferReason, TransferStatus, TransferType } from '@prisma/client';
import prisma, { PrismaClientExtended, TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { fullName } from '../utils/nameUtils';
import * as Money from '../utils/money';
import { getSystemUserId } from './systemUserService';
import { openFindingOnce } from './findingService';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { GLAutomationService } from './glAutomationService';

/**
 * Stock (F-651, F-657, F-305, M4-T06/T07). This file is the only writer of `StockLevel.quantity` and `Product.stockQuantity`
 * (stockWriteGrep.test.ts). Every change writes or updates a movement row in `InventoryTransfer` and changes the level
 * in the caller's transaction. Negative on-hand is allowed (R11). Units of an open in-transit transfer sit on the
 * transfer row, in no level.
 */

type Db = TransactionClient | PrismaClientExtended;

/** Location types that hold stock the seller can use. The in-transit system location holds none. */
export const PHYSICAL: StockLocationType[] = ['own_store', 'partner_3pl', 'agent'];
/** Orders whose units are reserved at the holder (F-651). */
export const RESERVING: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'];

export interface MovementInput {
  type: TransferType;
  productId: number;
  /** Always above 0. */
  quantity: number;
  createdById: number;
  fromLocationId?: number | null;
  toLocationId?: number | null;
  status?: TransferStatus;
  reason?: TransferReason | null;
  notes?: string | null;
  orderId?: number | null;
  shipmentId?: number | null;
  /** Identifies one order line (F-657). Always set for `order_fulfillment`. */
  itemKey?: string | null;
  /** Lower the source level. Default: true when `fromLocationId` is set. */
  debit?: boolean;
  /** Raise the destination level. Default: true when `toLocationId` is set and the status is not `in_transit`. */
  credit?: boolean;
  /** Refuse with "Only N available" when the source holds fewer units (transfers). Fulfilment never sets it. */
  requireOnHand?: boolean;
  /** The product row the caller already locked with `lockProduct`; the movement does not lock or read it again. */
  lockedProduct?: LockedProduct;
  /** Skip the cache refresh for this movement. The caller refreshes once per product with `refreshCache` (fulfilOrder, reverseOrder). */
  refreshCache?: boolean;
  /**
   * Settle an existing transfer row instead of writing a new one: only the level legs run and `row` is applied to
   * the row. Used by receive, resolve and cancel (M4-T09).
   */
  settle?: { transferId: number; row: Prisma.InventoryTransferUncheckedUpdateInput };
}

export interface LockedProduct { id: number; productType: string; cogs: Prisma.Decimal | null; name: string }

/**
 * Lock the product row and read it, in one statement (404 when it is not in this tenant). Every stock change of one
 * product waits here, so level checks, sums and the cache are consistent. A digital product has no stock: it is refused.
 */
export async function lockProduct(tx: TransactionClient, productId: number): Promise<LockedProduct> {
  const rows = await tx.$queryRaw<LockedProduct[]>`
    SELECT id, product_type AS "productType", cogs, name FROM products
    WHERE id = ${productId} AND tenant_id = ${resolveTenantId()} FOR UPDATE`;
  if (rows.length === 0) throw new AppError('Product not found', 404);
  if (rows[0].productType === 'digital') throw new AppError(`"${rows[0].name}" is a digital product and has no stock`, 400);
  return rows[0];
}

/** A stock location of this tenant (404 otherwise), with its user when `withUser`. */
export async function getLocation(db: Db, id: number, withUser = false): Promise<StockLocation & { user?: { id: number; isActive: boolean } | null }> {
  const location = await db.stockLocation.findUnique({ where: { id }, include: withUser ? { user: { select: { id: true, isActive: true } } } : undefined });
  if (!location) throw new AppError('Stock location not found', 404);
  return location;
}

async function changeLevel(tx: TransactionClient, tenantId: string, locationId: number, productId: number, delta: number): Promise<number> {
  const level = await tx.stockLevel.upsert({
    where: { locationId_productId: { locationId, productId } },
    create: { tenantId, locationId, productId, quantity: delta },
    update: { quantity: { increment: delta } },
  });
  return level.quantity;
}

/** The cache: sum of on-hand over active physical locations. The caller holds the product lock. */
export async function refreshCache(tx: TransactionClient, productId: number): Promise<number> {
  const total = await getOnHand(productId, undefined, tx);
  await tx.product.update({ where: { id: productId }, data: { stockQuantity: total } });
  return total;
}

/**
 * Write one movement and change the levels together, in the caller's transaction. Returns the movement row
 * (the settled row when `settle` is set) and the new quantity of each level it changed (null when it changed none).
 */
export async function applyMovement(tx: TransactionClient, input: MovementInput) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new AppError('Quantity must be a whole number above 0', 400);
  const from = input.fromLocationId ?? null;
  const to = input.toLocationId ?? null;
  const status = input.status ?? 'received';
  const debit = input.debit ?? from != null;
  const credit = input.credit ?? (to != null && status !== 'in_transit');
  if ((from == null && to == null) || (debit && from == null) || (credit && to == null)) throw new AppError('A movement needs the location it changes', 400);

  if (!input.lockedProduct) await lockProduct(tx, input.productId);
  const tenantId = resolveTenantId();
  const ids = [from, to].filter((id): id is number => id != null);
  const found = await tx.stockLocation.findMany({ where: { id: { in: ids } } });
  if (new Set(ids).size !== found.length) throw new AppError('Stock location not found', 404);
  const source = found.find((l) => l.id === from);

  if (debit && input.requireOnHand) {
    const level = await tx.stockLevel.findUnique({ where: { locationId_productId: { locationId: from!, productId: input.productId } } });
    const onHand = level?.quantity ?? 0;
    if (onHand < input.quantity) throw new AppError(`Only ${Math.max(onHand, 0)} available at ${source!.name}`, 400);
  }
  const fromQuantity = debit ? await changeLevel(tx, tenantId, from!, input.productId, -input.quantity) : null;
  const toQuantity = credit ? await changeLevel(tx, tenantId, to!, input.productId, input.quantity) : null;

  let row;
  if (input.settle) {
    row = await tx.inventoryTransfer.update({ where: { id: input.settle.transferId }, data: input.settle.row });
  } else {
    row = await tx.inventoryTransfer.create({
      data: {
        tenantId,
        transferType: input.type,
        productId: input.productId,
        quantity: input.quantity,
        fromLocationId: from,
        toLocationId: to,
        status,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        orderId: input.orderId ?? null,
        shipmentId: input.shipmentId ?? null,
        itemKey: input.itemKey ?? null,
        createdById: input.createdById,
      },
    });
  }
  if ((debit || credit) && input.refreshCache !== false) await refreshCache(tx, input.productId);
  return { row, fromQuantity, toQuantity };
}

/**
 * Rebuild `Product.stockQuantity` from the levels, for the given products or all of them (physical ones only).
 * The stock migration calls it once so the cache starts right (M4-T06). Returns the new value per product.
 */
export async function rebuildCache(tx: TransactionClient, productIds?: number[]): Promise<Map<number, number>> {
  const products = await tx.product.findMany({
    where: { productType: { not: 'digital' }, ...(productIds ? { id: { in: productIds } } : {}) },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const out = new Map<number, number>();
  for (const p of products) {
    await lockProduct(tx, p.id);
    out.set(p.id, await refreshCache(tx, p.id));
  }
  return out;
}

/** Levels that count as on hand: active physical locations. */
const onHandLevels = { location: { isActive: true, type: { in: PHYSICAL } } } satisfies Prisma.StockLevelWhereInput;

/**
 * The orders that reserve units (F-651): reserving status, not deleted, at a delivery partner. With `holderUserId`, only
 * that partner's orders. The raw SQL in inventoryReadService.reservedByHolder must follow this filter.
 */
export const reservedWhere = (holderUserId?: number): Prisma.OrderWhereInput => ({
  deletedAt: null, status: { in: RESERVING }, deliveryAgentId: holderUserId != null ? holderUserId : { not: null },
});

/** On-hand units per product over the active physical locations (all products when `productIds` is left out). Products with none are absent. */
export async function getOnHandMany(productIds?: number[], db: Db = prisma): Promise<Map<number, number>> {
  const rows = await db.stockLevel.groupBy({
    by: ['productId'], _sum: { quantity: true },
    where: { ...onHandLevels, ...(productIds ? { productId: { in: productIds } } : {}) },
  });
  return new Map(rows.map((r) => [r.productId, r._sum.quantity ?? 0]));
}

/** Reserved units per product over all holders. Products with none are absent. */
export async function getReservedMany(productIds?: number[], db: Db = prisma): Promise<Map<number, number>> {
  const rows = await db.orderItem.groupBy({
    by: ['productId'], _sum: { quantity: true },
    where: { ...(productIds ? { productId: { in: productIds } } : {}), order: reservedWhere() },
  });
  return new Map(rows.map((r) => [r.productId, r._sum.quantity ?? 0]));
}

/** On-hand units of a product: at one location, or summed over the active physical locations. */
export async function getOnHand(productId: number, locationId?: number, db: Db = prisma): Promise<number> {
  if (locationId == null) return (await getOnHandMany([productId], db)).get(productId) ?? 0;
  const sum = await db.stockLevel.aggregate({ _sum: { quantity: true }, where: { productId, locationId } });
  return sum._sum.quantity ?? 0;
}

/**
 * Reserved units of a product: order lines in confirmed, preparing, ready for pickup or out for delivery, at the order's
 * delivery partner. With `locationId`, only the orders of the partner at that location. Orders with no partner reserve nothing.
 */
export async function getReserved(productId: number, locationId?: number, db: Db = prisma): Promise<number> {
  if (locationId == null) return (await getReservedMany([productId], db)).get(productId) ?? 0;
  const location = await db.stockLocation.findUnique({ where: { id: locationId }, select: { userId: true } });
  if (location?.userId == null) return 0;
  const sum = await db.orderItem.aggregate({ _sum: { quantity: true }, where: { productId, order: reservedWhere(location.userId) } });
  return sum._sum.quantity ?? 0;
}

/** On hand less reserved, over all holders. May be below 0. */
export async function getAvailableToSell(productId: number, db: Db = prisma): Promise<number> {
  return (await getAvailableMany([productId], db)).get(productId) ?? 0;
}

/**
 * On hand less reserved for many products at once. Physical products only: a digital product has no stock, so its id is
 * absent from the answer (and so is an unknown id). A physical product with no stock reads 0.
 */
export async function getAvailableMany(productIds: number[], db: Db = prisma): Promise<Map<number, number>> {
  const ids = [...new Set(productIds)];
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const readPhysical = () => withSoftDeleted(() => db.product.findMany({ where: { id: { in: ids }, productType: { not: 'digital' } }, select: { id: true } }));
  let physical, onHand, reserved;
  if (db === prisma) {
    [physical, onHand, reserved] = await Promise.all([readPhysical(), getOnHandMany(ids, db), getReservedMany(ids, db)]);
  } else {
    // One after the other: an interactive transaction runs one query at a time
    physical = await readPhysical();
    onHand = await getOnHandMany(ids, db);
    reserved = await getReservedMany(ids, db);
  }
  for (const { id } of physical) out.set(id, (onHand.get(id) ?? 0) - (reserved.get(id) ?? 0));
  return out;
}

/**
 * Create a product row and, when `opening` is given, its opening stock: one `opening` movement that raises the level and
 * the cache (F-601, M4-T16). The cache starts at 0 here, so this file stays the only one that names `stockQuantity` on a write.
 */
export async function createProductWithStock(
  tx: TransactionClient,
  data: Omit<Prisma.ProductUncheckedCreateInput, 'stockQuantity'>,
  opening?: { locationId: number; quantity: number; createdById: number },
) {
  const product = await tx.product.create({ data: { ...data, stockQuantity: 0 } });
  if (opening && opening.quantity > 0) {
    const locked = await lockProduct(tx, product.id);
    await applyMovement(tx, { type: 'opening', productId: product.id, quantity: opening.quantity, createdById: opening.createdById, toLocationId: opening.locationId, lockedProduct: locked });
    return tx.product.findUniqueOrThrow({ where: { id: product.id } });
  }
  return product;
}

/** The stock location of a delivery partner user. A partner with none gets one, so a delivery is never blocked (R11). */
async function holderLocation(tx: TransactionClient, tenantId: string, userId: number) {
  const existing = await tx.stockLocation.findFirst({ where: { userId } });
  if (existing) return existing;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, firstName: true, lastName: true, kind: true } });
  if (!user) throw new AppError('Delivery partner not found', 404);
  const name = fullName(user);
  const taken = await tx.stockLocation.findFirst({ where: { name } });
  return tx.stockLocation.create({
    data: { tenantId, type: user.kind === 'company' ? 'partner_3pl' : 'agent', name: taken ? `${name} (${user.id})` : name, userId },
  });
}

type FulfilOrder = { id: number; tenantId?: string | null; deliveryAgentId?: number | null };

/** Physical order lines. A line of a digital product moves no stock. */
async function physicalLines(tx: TransactionClient, orderId: number) {
  const lines = await tx.orderItem.findMany({
    where: { orderId, quantity: { gt: 0 } },
    select: { id: true, productId: true, quantity: true, product: { select: { productType: true, cogs: true, name: true } } },
    orderBy: { id: 'asc' },
  });
  return lines.filter((l) => l.product.productType !== 'digital');
}

/**
 * Stock leaves once per order, when it enters `delivered` (F-657). One `order_fulfillment` movement per order line,
 * from the holder at this moment. A line that already has an active movement is skipped, so a repeat adds nothing.
 * Not enough units does not block: on-hand goes negative and one open `stock_gap` Finding names the holder and product (R11).
 */
export async function fulfilOrder(tx: TransactionClient, order: FulfilOrder, actorUserId?: number | null): Promise<void> {
  const lines = await physicalLines(tx, order.id);
  if (lines.length === 0) return;
  if (order.deliveryAgentId == null) throw new AppError('Assign a delivery partner first', 409, 'INVALID_TRANSITION');
  const tenantId = resolveTenantId(order.tenantId);
  const holder = await holderLocation(tx, tenantId, order.deliveryAgentId);
  const createdById = actorUserId ?? (await getSystemUserId(tenantId));
  const active = new Set((await tx.inventoryTransfer.findMany({
    where: { orderId: order.id, transferType: 'order_fulfillment', reversedAt: null },
    select: { productId: true, itemKey: true },
  })).map((r) => `${r.productId}:${r.itemKey}`));

  const todo = lines.filter((line) => !active.has(`${line.productId}:${line.id}`));
  // Lock each product once, in id order, then hand the lock to every movement of that product
  const locked = new Map<number, LockedProduct>();
  for (const productId of [...new Set(todo.map((l) => l.productId))].sort((a, b) => a - b)) locked.set(productId, await lockProduct(tx, productId));

  const moved = new Set<number>();
  for (const line of todo) {
    const { fromQuantity } = await applyMovement(tx, {
      type: 'order_fulfillment', productId: line.productId, quantity: line.quantity, createdById,
      fromLocationId: holder.id, orderId: order.id, itemKey: String(line.id), refreshCache: false, lockedProduct: locked.get(line.productId),
    });
    moved.add(line.productId);
    if (fromQuantity != null && fromQuantity < 0) {
      await openFindingOnce({
        tenantId, type: 'stock_gap', subjectType: 'stock_level', subjectId: `${holder.id}:${line.productId}`,
        amount: Money.mul(-fromQuantity, Money.orZero(line.product.cogs)),
        note: `${holder.name} has ${fromQuantity} ${line.product.name}`,
      }, { updateAmount: true }, tx);
    }
  }
  for (const productId of moved) await refreshCache(tx, productId);
  // F-611: the cost of the units that left, at the product cost of this moment. The revenue entry books the same amount.
  if (moved.size > 0) {
    await tx.order.updateMany({ where: { id: order.id, landedCostTotal: null }, data: { landedCostTotal: GLAutomationService.calculateTotalCOGS(lines) } });
  }
}

/**
 * An order leaves `delivered` (returned, or moved back, F-657): every active fulfilment goes back to the location it came
 * from as an `order_reversal` movement, and the fulfilment is marked reversed. A repeat finds nothing to reverse.
 * An order delivered before M4 has no fulfilment row and reverses no stock.
 */
export async function reverseOrder(tx: TransactionClient, order: FulfilOrder, actorUserId?: number | null): Promise<void> {
  const active = await tx.inventoryTransfer.findMany({
    where: { orderId: order.id, transferType: 'order_fulfillment', reversedAt: null },
    orderBy: { id: 'asc' },
  });
  if (active.length === 0) return;
  // The booked landed cost goes with the delivery (F-611); the ledger reversal reads the amount from the entry it reverses.
  await tx.order.updateMany({ where: { id: order.id, landedCostTotal: { not: null } }, data: { landedCostTotal: null } });
  const createdById = actorUserId ?? (await getSystemUserId(resolveTenantId(order.tenantId)));
  for (const fulfilment of active) {
    await applyMovement(tx, {
      type: 'order_reversal', productId: fulfilment.productId, quantity: fulfilment.quantity, createdById,
      toLocationId: fulfilment.fromLocationId, orderId: order.id, itemKey: fulfilment.itemKey, refreshCache: false,
    });
  }
  await tx.inventoryTransfer.updateMany({ where: { id: { in: active.map((f) => f.id) } }, data: { reversedAt: new Date() } });
  for (const productId of new Set(active.map((f) => f.productId))) await refreshCache(tx, productId);
}
