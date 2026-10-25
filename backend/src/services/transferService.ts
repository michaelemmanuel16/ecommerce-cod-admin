import { TransferReason, TransferType } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { applyMovement, getLocation, lockProduct } from './stockService';
import { openFindingOnce } from './findingService';
import { auditService } from './auditService';
import type { StockActor } from '../utils/stockActor';

/**
 * Transfers and adjustments (F-654, F-655, M4-T09). A transfer is one `InventoryTransfer` row: the source level goes down
 * when it is created, the units sit on the row while it is `in_transit`, and the receiver confirms a counted quantity.
 * Every level change goes through `stockService.applyMovement`. Each call runs in one transaction.
 */

/** An open transfer older than this shows the tag "Overdue" (M4 decision: 3 days). */
export const OVERDUE_DAYS = 3;

export const CREATE_TYPES = ['allocation', 'agent_transfer', 'return_to_warehouse'] as const;
export const DISPUTE_REASONS = ['short_in_package', 'damaged', 'not_received'] as const;
export const RETURN_REASONS = ['failed_deliveries', 'customer_refused', 'damaged', 'agent_stopped_delivering', 'other'] as const;
export const ADJUST_REASONS = ['physical_count_correction', 'damaged', 'lost_or_stolen', 'found_extra_stock', 'other'] as const;

export interface CreateTransferInput {
  type: (typeof CREATE_TYPES)[number];
  productId: number;
  quantity: number;
  fromLocationId: number;
  toLocationId: number;
  reason?: TransferReason;
  note?: string;
}

export const TRANSFER_INCLUDE = {
  product: { select: { id: true, name: true, sku: true } },
  fromLocation: { select: { id: true, name: true, type: true } },
  toLocation: { select: { id: true, name: true, type: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

/** The transfer as the API returns it: the short quantity of a dispute and the Overdue tag (in transit and older than 3 days). A disputed transfer waits for the owner's resolve, so it is never overdue. */
export function present<T extends { status: string; quantity: number; receivedQuantity: number | null; createdAt: Date }>(row: T, now = new Date()) {
  return {
    ...row,
    shortQuantity: row.status === 'disputed' && row.receivedQuantity != null ? row.quantity - row.receivedQuantity : 0,
    overdue: row.status === 'in_transit' && now.getTime() - row.createdAt.getTime() > OVERDUE_DAYS * 24 * 3600 * 1000,
  };
}

/** Row lock on the transfer, so two receipts or a receipt and a cancel of the same transfer run one after the other. */
async function lockTransfer(tx: TransactionClient, id: number) {
  const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM inventory_transfers WHERE id = ${id} AND tenant_id = ${resolveTenantId()} FOR UPDATE`;
  if (locked.length === 0) throw new AppError('Transfer not found', 404);
  const row = await tx.inventoryTransfer.findUniqueOrThrow({ where: { id }, include: { fromLocation: true, toLocation: true, product: { select: { id: true, name: true, cogs: true } } } });
  if (!row.fromLocation || !row.toLocation) throw new AppError('Transfer not found', 404);
  return { ...row, fromLocation: row.fromLocation, toLocation: row.toLocation };
}

async function fresh(tx: TransactionClient, id: number) {
  return present(await tx.inventoryTransfer.findUniqueOrThrow({ where: { id }, include: TRANSFER_INCLUDE }));
}

/** Allocate, transfer between agents, or return: the source level goes down at once and the units wait in transit. */
export async function createTransfer(actor: StockActor, input: CreateTransferInput) {
  if (!CREATE_TYPES.includes(input.type)) throw new AppError('Type must be allocation, agent_transfer or return_to_warehouse', 400);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new AppError('Quantity must be a whole number above 0', 400);
  if (input.fromLocationId === input.toLocationId) throw new AppError('Cannot transfer to the same location', 400);

  return prisma.$transaction(async (tx) => {
    const product = await lockProduct(tx, input.productId);
    const from = await getLocation(tx, input.fromLocationId, true);
    const to = await getLocation(tx, input.toLocationId, true);
    for (const l of [from, to]) {
      if (l.type === 'in_transit') throw new AppError('The in-transit location cannot send or receive stock', 400);
      if (!l.isActive) throw new AppError(`${l.name} is not active`, 400);
    }
    if (to.user && !to.user.isActive) throw new AppError(`${to.name} is inactive and cannot receive new stock`, 400);
    if (input.type === 'allocation' && from.type === 'agent') throw new AppError('An allocation comes from a store or a 3PL; use a transfer or a return for an agent', 400);
    if (input.type === 'agent_transfer' && (from.type !== 'agent' || to.type !== 'agent')) throw new AppError('A transfer between agents needs two agents', 400);
    if (input.type === 'return_to_warehouse' && from.type !== 'agent' && from.type !== 'partner_3pl') throw new AppError('A return comes from an agent or a 3PL', 400);

    const { row } = await applyMovement(tx, {
      type: input.type as TransferType, productId: input.productId, quantity: input.quantity, createdById: actor.id,
      fromLocationId: from.id, toLocationId: to.id, status: 'in_transit', requireOnHand: true, lockedProduct: product,
      reason: input.reason ?? null, notes: input.note ?? null,
    });
    // The agent is told the stock is on its way (inbox row; the push comes from the notification layer).
    if (to.type === 'agent' && to.userId != null) {
      await tx.notification.create({
        data: {
          tenantId: resolveTenantId(), userId: to.userId, type: 'stock', title: 'Stock waiting for you',
          message: `${input.quantity} ${product.name} are waiting for you`,
          data: { transferId: row.id, productId: product.id, quantity: input.quantity, fromLocationId: from.id },
        },
      });
    }
    await auditService.record({
      tx, actorId: actor.id, actorKind: 'person', channel: 'app', action: 'create', resource: 'inventory_transfer', resourceId: String(row.id),
      metadata: { type: input.type, productId: input.productId, quantity: input.quantity, fromLocationId: from.id, toLocationId: to.id },
    });
    return fresh(tx, row.id);
  });
}

/**
 * The receiver confirms with a counted quantity (default: all that was sent). Equal is `received`; below is `disputed` with
 * a reason (the short units stay in transit until the owner resolves it); above is refused. An agent confirms only stock
 * addressed to them; the owner, an admin or a stock keeper may confirm for anyone, which is how a 3PL or a store is received.
 */
export async function receiveTransfer(actor: StockActor, id: number, input: { quantity?: number; reason?: TransferReason }) {
  return prisma.$transaction(async (tx) => {
    const transfer = await lockTransfer(tx, id);
    const own = transfer.toLocation.userId != null && transfer.toLocation.userId === actor.id;
    // The route lets a non-agent in only with products:update_stock; an agent confirms only their own stock.
    if (actor.role === 'delivery_agent' && !own) throw new AppError('You can only confirm stock addressed to you', 403);
    if (transfer.status !== 'in_transit') throw new AppError(`This transfer is already ${transfer.status}`, 409);

    const counted = input.quantity ?? transfer.quantity;
    if (!Number.isInteger(counted) || counted < 0) throw new AppError('Counted quantity must be a whole number, 0 or more', 400);
    if (counted > transfer.quantity) throw new AppError(`Received quantity cannot be above the ${transfer.quantity} sent`, 400);
    const short = counted < transfer.quantity;
    if (short && !DISPUTE_REASONS.includes(input.reason as (typeof DISPUTE_REASONS)[number])) {
      throw new AppError('A reason is required when you receive less than was sent: short in package, damaged or not received', 400);
    }

    const row = {
      status: short ? 'disputed' : 'received', receivedQuantity: counted, receivedAt: new Date(), receivedById: actor.id,
      reason: short ? input.reason! : null,
    } as const;
    if (counted > 0) {
      await applyMovement(tx, {
        type: transfer.transferType, productId: transfer.productId, quantity: counted, createdById: actor.id,
        toLocationId: transfer.toLocationId, settle: { transferId: id, row },
      });
    } else {
      await tx.inventoryTransfer.update({ where: { id }, data: row });
    }
    await auditService.record({
      tx, actorId: actor.id, actorKind: 'person', channel: 'app', action: 'receive', resource: 'inventory_transfer', resourceId: String(id),
      metadata: {
        quantitySent: transfer.quantity, quantityReceived: counted, status: row.status, reason: row.reason,
        locationId: transfer.toLocationId, onBehalf: !own,
      },
    });
    return fresh(tx, id);
  });
}

/**
 * Close a dispute. "Return to source" puts the short units back at the source level. "Write off" records the loss as an
 * `adjustment` with the dispute reason and a Finding with the cost. Either way the transfer ends `received`.
 */
export async function resolveTransfer(actor: StockActor, id: number, input: { action: 'return_to_source' | 'write_off'; note?: string }) {
  if (input.action !== 'return_to_source' && input.action !== 'write_off') throw new AppError('Action must be return_to_source or write_off', 400);
  return prisma.$transaction(async (tx) => {
    const transfer = await lockTransfer(tx, id);
    if (transfer.status !== 'disputed') throw new AppError('Only a disputed transfer can be resolved', 409);
    const short = transfer.quantity - (transfer.receivedQuantity ?? 0);

    if (input.action === 'return_to_source') {
      // Units a 3PL says it sent back never arrived; they are not at the 3PL to be put back.
      if (transfer.transferType === 'return_to_warehouse' && transfer.fromLocation.type === 'partner_3pl') {
        throw new AppError('Units that never arrived cannot go back to the 3PL; write them off', 400);
      }
      await applyMovement(tx, {
        type: transfer.transferType, productId: transfer.productId, quantity: short, createdById: actor.id,
        toLocationId: transfer.fromLocationId, settle: { transferId: id, row: { status: 'received' } },
      });
    } else {
      await applyMovement(tx, {
        type: 'adjustment', productId: transfer.productId, quantity: short, createdById: actor.id,
        fromLocationId: transfer.fromLocationId, debit: false, reason: transfer.reason,
        notes: `Write-off of transfer ${id}${input.note ? `: ${input.note}` : ''}`,
      });
      await tx.inventoryTransfer.update({ where: { id }, data: { status: 'received' } });
      await openFindingOnce({
        tenantId: resolveTenantId(), type: 'stock_gap', status: 'explained', subjectType: 'inventory_transfer', subjectId: String(id),
        amount: Money.mul(short, Money.orZero(transfer.product.cogs)),
        note: `Written off: ${short} ${transfer.product.name} short on transfer ${id}${input.note ? ` (${input.note})` : ''}`,
      }, { includeClosed: true }, tx);
    }
    await auditService.record({
      tx, actorId: actor.id, actorKind: 'person', channel: 'app', action: 'resolve', resource: 'inventory_transfer', resourceId: String(id),
      metadata: { action: input.action, shortQuantity: short, note: input.note ?? null },
    });
    return fresh(tx, id);
  });
}

/** The owner cancels an in-transit transfer: the units go back to the source level. */
export async function cancelTransfer(actor: StockActor, id: number) {
  return prisma.$transaction(async (tx) => {
    const transfer = await lockTransfer(tx, id);
    if (transfer.status !== 'in_transit') throw new AppError(`Only an in-transit transfer can be cancelled; this one is ${transfer.status}`, 409);
    await applyMovement(tx, {
      type: transfer.transferType, productId: transfer.productId, quantity: transfer.quantity, createdById: actor.id,
      toLocationId: transfer.fromLocationId, settle: { transferId: id, row: { status: 'cancelled' } },
    });
    await auditService.record({
      tx, actorId: actor.id, actorKind: 'person', channel: 'app', action: 'cancel', resource: 'inventory_transfer', resourceId: String(id),
      metadata: { quantity: transfer.quantity, locationId: transfer.fromLocationId },
    });
    return fresh(tx, id);
  });
}

export interface AdjustInput {
  locationId: number;
  productId: number;
  newQuantity: number;
  reason: (typeof ADJUST_REASONS)[number];
  note?: string;
}

/** Set the on-hand quantity of one product at one location to a counted number. Writes one `adjustment` movement. */
export async function adjustStock(actor: StockActor, input: AdjustInput) {
  if (!Number.isInteger(input.newQuantity) || input.newQuantity < 0) throw new AppError('New quantity must be a whole number, 0 or more', 400);
  if (!ADJUST_REASONS.includes(input.reason)) throw new AppError('Reason must be physical_count_correction, damaged, lost_or_stolen, found_extra_stock or other', 400);
  const note = input.note?.trim();
  if (input.reason === 'other' && !note) throw new AppError('A note is required when the reason is Other', 400);

  return prisma.$transaction(async (tx) => {
    // Lock the product before reading the level, so the difference below is computed on the number that will change.
    const product = await lockProduct(tx, input.productId);
    const location = await getLocation(tx, input.locationId);
    if (location.type === 'in_transit') throw new AppError('The in-transit location holds no stock to adjust', 400);
    const level = await tx.stockLevel.findUnique({ where: { locationId_productId: { locationId: location.id, productId: input.productId } } });
    const current = level?.quantity ?? 0;
    const diff = input.newQuantity - current;
    if (diff === 0) throw new AppError('No change', 400);

    const { row } = await applyMovement(tx, {
      lockedProduct: product,
      type: 'adjustment', productId: input.productId, quantity: Math.abs(diff), createdById: actor.id,
      ...(diff < 0 ? { fromLocationId: location.id } : { toLocationId: location.id }),
      reason: input.reason, notes: note ?? null,
    });
    const incoming = await tx.inventoryTransfer.aggregate({
      _sum: { quantity: true },
      where: { toLocationId: location.id, productId: input.productId, status: { in: ['in_transit', 'disputed'] } },
    });
    await auditService.record({
      tx, actorId: actor.id, actorKind: 'person', channel: 'app', action: 'adjust', resource: 'inventory_transfer', resourceId: String(row.id),
      metadata: { locationId: location.id, productId: input.productId, from: current, to: input.newQuantity, reason: input.reason },
    });
    const units = incoming._sum.quantity ?? 0;
    return {
      movement: await fresh(tx, row.id),
      previousQuantity: current,
      newQuantity: input.newQuantity,
      ...(units > 0 ? { warning: `${units} units are on their way to this location` } : {}),
    };
  });
}
