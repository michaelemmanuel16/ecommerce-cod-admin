import { OrderStatus, Prisma, StockLocation, StockLocationType, TransferReason, TransferStatus, TransferType } from '@prisma/client';
import prisma, { PrismaClientExtended, TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { fullName } from '../utils/nameUtils';
import * as Money from '../utils/money';
import { getSystemUserId } from './systemUserService';
import { openFindingOnce } from './findingService';

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
const RESERVING: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'];

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
 * product waits here, so level checks, sums and the cache are consistent. A digital product has no stock: it is refused
 * unless `allowDigital`.
 */
export async function lockProduct(tx: TransactionClient, productId: number, opts: { allowDigital?: boolean } = {}): Promise<LockedProduct> {
  const rows = await tx.$queryRaw<LockedProduct[]>`
    SELECT id, product_type AS "productType", cogs, name FROM products
    WHERE id = ${productId} AND tenant_id = ${resolveTenantId()} FOR UPDATE`;
  if (rows.length === 0) throw new AppError('Product not found', 404);
  if (rows[0].productType === 'digital' && !opts.allowDigital) throw new AppError(`"${rows[0].name}" is a digital product and has no stock`, 400);
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

/** On-hand units of a product: at one location, or summed over the active physical locations. */
export async function getOnHand(productId: number, locationId?: number, db: Db = prisma): Promise<number> {
  const sum = await db.stockLevel.aggregate({
    _sum: { quantity: true },
    where: locationId != null
      ? { productId, locationId }
      : { productId, location: { isActive: true, type: { in: PHYSICAL } } },
  });
  return sum._sum.quantity ?? 0;
}

/**
 * Reserved units of a product: order lines in confirmed, preparing, ready for pickup or out for delivery, at the order's
 * delivery partner. With `locationId`, only the orders of the partner at that location. Orders with no partner reserve nothing.
 */
export async function getReserved(productId: number, locationId?: number, db: Db = prisma): Promise<number> {
  let holder: Prisma.OrderWhereInput = { deliveryAgentId: { not: null } };
  if (locationId != null) {
    const location = await db.stockLocation.findUnique({ where: { id: locationId }, select: { userId: true } });
    if (location?.userId == null) return 0;
    holder = { deliveryAgentId: location.userId };
  }
  const sum = await db.orderItem.aggregate({
    _sum: { quantity: true },
    where: { productId, order: { deletedAt: null, status: { in: RESERVING }, ...holder } },
  });
  return sum._sum.quantity ?? 0;
}

/** On hand less reserved, over all holders. May be below 0. */
export async function getAvailableToSell(productId: number, db: Db = prisma): Promise<number> {
  if (db === prisma) {
    const [onHand, reserved] = await Promise.all([getOnHand(productId, undefined, db), getReserved(productId, undefined, db)]);
    return onHand - reserved;
  }
  return (await getOnHand(productId, undefined, db)) - (await getReserved(productId, undefined, db));
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

  const moved = new Set<number>();
  for (const line of lines) {
    const itemKey = String(line.id);
    if (active.has(`${line.productId}:${itemKey}`)) continue;
    const { fromQuantity } = await applyMovement(tx, {
      type: 'order_fulfillment', productId: line.productId, quantity: line.quantity, createdById,
      fromLocationId: holder.id, orderId: order.id, itemKey, refreshCache: false,
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
}

/**
 * An order leaves `delivered` (returned, or moved back, F-657): every active fulfilment goes back to the location it came
 * from as an `order_reversal` movement, and the fulfilment is marked reversed. A repeat finds nothing to reverse.
 * An order delivered before M4 has no fulfilment row and reverses nothing.
 */
export async function reverseOrder(tx: TransactionClient, order: FulfilOrder, actorUserId?: number | null): Promise<void> {
  const active = await tx.inventoryTransfer.findMany({
    where: { orderId: order.id, transferType: 'order_fulfillment', reversedAt: null },
    orderBy: { id: 'asc' },
  });
  if (active.length === 0) return;
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
