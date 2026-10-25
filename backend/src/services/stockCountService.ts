import { Prisma, StockCountSource, TransferReason } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { applyMovement, getLocation, lockProduct, LockedProduct } from './stockService';
import { openFindingOnce } from './findingService';
import { auditService } from './auditService';
import type { StockActor } from '../utils/stockActor';
import { getStoreTimeZone, localDate, parseYmd } from './kpi/dates';

/**
 * Stock counts (F-653, M4-T14). A count compares what a person counted at one location with our records. Each line freezes
 * the system quantity under the product lock. A line with a difference opens one `stock_gap` Finding (amount = difference
 * x product cost). "Apply count" writes a `count_adjustment` movement through `stockService.applyMovement` and marks the
 * Finding `explained`. "Keep investigating" is no call: the Finding stays open and our records stay.
 */

export const COUNT_SOURCES: StockCountSource[] = ['own_count', 'three_pl_dashboard', 'agent_count'];
export const COUNT_REASONS = ['physical_count_correction', 'damaged', 'lost_or_stolen', 'found_extra_stock', 'short_on_arrival', 'other'] as const;

export interface CreateCountInput {
  locationId: number;
  /** YYYY-MM-DD. Not in the future (store time zone). */
  countDate: string;
  source: StockCountSource;
  note?: string;
  lines: Array<{ productId: number; countedQuantity: number }>;
}

const COUNT_INCLUDE = {
  location: { select: { id: true, name: true, type: true } },
  countedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: {
    orderBy: { id: 'asc' },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      finding: { select: { id: true, status: true, amount: true } },
    },
  },
} satisfies Prisma.StockCountInclude;

type CountRow = Prisma.StockCountGetPayload<{ include: typeof COUNT_INCLUDE }>;

function present(count: CountRow) {
  return {
    ...count,
    lines: count.lines.map(({ finding, ...line }) => ({
      ...line,
      applied: line.appliedMovementId != null,
      finding: finding ? { ...finding, amount: finding.amount == null ? null : Money.toApi(finding.amount) } : null,
    })),
  };
}

/** Save a count. The system quantity of each line is read under the product lock, so it is the number at save time. */
export async function createCount(actor: StockActor, input: CreateCountInput) {
  if (!COUNT_SOURCES.includes(input.source)) throw new AppError(`source must be one of: ${COUNT_SOURCES.join(', ')}`, 400);
  let day: ReturnType<typeof parseYmd>;
  try {
    day = parseYmd(String(input.countDate));
  } catch {
    throw new AppError('countDate must be a date, YYYY-MM-DD', 400);
  }
  const tenantId = resolveTenantId();
  if (input.countDate > localDate(new Date(), getStoreTimeZone(tenantId))) throw new AppError('The count date cannot be in the future', 400);
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new AppError('A count needs at least one product', 400);
  if (new Set(input.lines.map((l) => l.productId)).size !== input.lines.length) throw new AppError('A product can be in a count only once', 400);
  for (const l of input.lines) {
    if (!Number.isInteger(l.countedQuantity) || l.countedQuantity < 0) throw new AppError('Counted quantity must be a whole number, 0 or more', 400);
  }
  const lines = [...input.lines].sort((a, b) => a.productId - b.productId); // fixed lock order, so two counts never deadlock

  const countId = await prisma.$transaction(async (tx) => {
    const location = await getLocation(tx, input.locationId);
    if (location.type === 'in_transit') throw new AppError('The in-transit location holds no stock to count', 400);

    const count = await tx.stockCount.create({
      data: { tenantId, locationId: location.id, countDate: new Date(Date.UTC(day.year, day.month - 1, day.day)), source: input.source, countedById: actor.id, note: input.note ?? null },
    });
    const products = new Map<number, LockedProduct>();
    for (const l of lines) products.set(l.productId, await lockProduct(tx, l.productId));
    const levels = new Map((await tx.stockLevel.findMany({ where: { locationId: location.id, productId: { in: lines.map((l) => l.productId) } } })).map((lv) => [lv.productId, lv.quantity]));

    for (const l of lines) {
      const product = products.get(l.productId)!;
      const systemQuantity = levels.get(l.productId) ?? 0;
      const difference = l.countedQuantity - systemQuantity;
      const line = await tx.stockCountLine.create({
        data: { tenantId, countId: count.id, productId: l.productId, systemQuantity, countedQuantity: l.countedQuantity, difference },
      });
      if (difference === 0) continue;
      const findingId = await openFindingOnce({
        tenantId, type: 'stock_gap', subjectType: 'stock_count_line', subjectId: String(line.id),
        amount: Money.mul(Math.abs(difference), Money.orZero(product.cogs)),
        note: `${location.name}: counted ${l.countedQuantity}, our records say ${systemQuantity} (${product.name})`,
      }, {}, tx);
      await tx.stockCountLine.update({ where: { id: line.id }, data: { findingId } });
    }
    await auditService.record({
      tx, actorId: actor.id, actorKind: 'person', channel: 'app', action: 'create', resource: 'stock_count', resourceId: String(count.id),
      metadata: { locationId: location.id, source: input.source, lines: lines.length },
    });
    return count.id;
  });
  return getCount(countId);
}

export async function listCounts(f: { locationId?: number; page: number; limit: number }) {
  const where: Prisma.StockCountWhereInput = f.locationId != null ? { locationId: f.locationId } : {};
  const [rows, total] = await Promise.all([
    prisma.stockCount.findMany({ where, include: COUNT_INCLUDE, orderBy: [{ countDate: 'desc' }, { id: 'desc' }], skip: (f.page - 1) * f.limit, take: f.limit }),
    prisma.stockCount.count({ where }),
  ]);
  return { counts: rows.map(present), pagination: { page: f.page, limit: f.limit, total, pages: Math.ceil(total / f.limit) } };
}

export async function getCount(id: number) {
  const count = await prisma.stockCount.findUnique({ where: { id }, include: COUNT_INCLUDE });
  if (!count) throw new AppError('Stock count not found', 404);
  return present(count);
}

export interface ApplyInput { reason?: (typeof COUNT_REASONS)[number]; shipmentId?: number; note?: string }

/**
 * Apply one line: the difference found at count time goes onto the current level as one `count_adjustment` movement
 * (below: units out, above: units in). A second apply is refused (409). When the level is not the one the count froze,
 * the answer carries a warning, because stock moved after the count.
 */
export async function applyLine(actor: StockActor, countId: number, lineId: number, input: ApplyInput) {
  const result = await prisma.$transaction(async (tx) => {
    const found = await tx.stockCountLine.findFirst({ where: { id: lineId, countId }, include: { count: true } });
    if (!found) throw new AppError('Stock count line not found', 404);
    // Same lock as every other stock change of this product; the line is read again below, after the wait.
    const product = await lockProduct(tx, found.productId);
    const line = await tx.stockCountLine.findUniqueOrThrow({ where: { id: lineId } });
    if (line.appliedMovementId != null) throw new AppError('This count line is already applied', 409);
    if (line.difference === 0) throw new AppError('This line has no difference to apply', 400);

    const reason = input.reason ?? (line.difference > 0 ? 'found_extra_stock' : 'physical_count_correction');
    if (!COUNT_REASONS.includes(reason)) throw new AppError(`reason must be one of: ${COUNT_REASONS.join(', ')}`, 400);
    const note = input.note?.trim();
    if (reason === 'other' && !note) throw new AppError('A note is required when the reason is Other', 400);
    if (input.shipmentId != null) {
      if (reason !== 'short_on_arrival') throw new AppError('A shipment can only be linked when the reason is short_on_arrival', 400);
      const shipment = await tx.inventoryShipment.findUnique({ where: { id: input.shipmentId }, select: { productId: true } });
      if (!shipment) throw new AppError('Shipment not found', 404);
      if (shipment.productId !== line.productId) throw new AppError('That shipment is for a different product', 400);
    }
    if (reason === 'short_on_arrival' && line.difference > 0) throw new AppError('Short on arrival needs a count below our records', 400);

    const locationId = found.count.locationId;
    const level = await tx.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId: line.productId } } });
    const current = level?.quantity ?? 0;

    const { row } = await applyMovement(tx, {
      lockedProduct: product,
      type: 'count_adjustment', productId: line.productId, quantity: Math.abs(line.difference), createdById: actor.id,
      ...(line.difference < 0 ? { fromLocationId: locationId } : { toLocationId: locationId }),
      reason: reason as TransferReason, shipmentId: input.shipmentId ?? null, notes: note ?? null,
    });
    await tx.stockCountLine.update({ where: { id: lineId }, data: { appliedMovementId: row.id } });
    if (line.findingId != null) await tx.finding.update({ where: { id: line.findingId }, data: { status: 'explained' } });
    await auditService.record({
      tx, actorId: actor.id, actorKind: 'person', channel: 'app', action: 'apply', resource: 'stock_count', resourceId: String(countId),
      metadata: { lineId, productId: line.productId, difference: line.difference, reason, shipmentId: input.shipmentId ?? null, movementId: row.id },
    });
    return {
      movement: row,
      onHand: current + line.difference,
      ...(current !== line.systemQuantity ? { warning: 'Stock moved after this count. Check before applying.' } : {}),
    };
  });
  return { count: await getCount(countId), ...result };
}

