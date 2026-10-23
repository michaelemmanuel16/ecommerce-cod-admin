import { FxSource, Prisma, StockCountSource, UserRole } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { getCurrency } from '../utils/currency';
import * as Money from '../utils/money';
import { GLAutomationService } from './glAutomationService';
import { rateOn } from './fxService';
import { openFindingOnce } from './findingService';
import { applyMovement, getLocation, getOnHand, lockProduct, PHYSICAL } from './stockService';

/**
 * Incoming shipments (F-604 to F-608, F-611, M4-T11/T12). A shipment is one product from one supplier in one currency (F-605).
 * It is edited and deleted only while `pending`. Receiving it is one transaction under a row lock: a `receipt` movement for
 * the counted quantity (through stockService), the landed cost, the weighted-average product cost, one ledger entry for the
 * full total, and a supplier claim for the short units. A claim is settled (money recovered) or written off.
 */

export const COUNT_SOURCES = ['own_count', 'three_pl_dashboard', 'agent_count'] as const;
export const CLAIM_ACTIONS = ['settle', 'write_off'] as const;

export interface ShipmentActor {
  id: number;
  role: UserRole;
}

export interface ShipmentInput {
  productId?: number;
  supplier?: string | null;
  quantity?: number;
  unitCost?: Money.MoneyInput;
  shippingCost?: Money.MoneyInput;
  customsDuties?: Money.MoneyInput;
  otherCosts?: Money.MoneyInput;
  currency?: string | null;
  /** A hand-typed rate (store currency per 1 unit of the shipment currency). Source becomes `manual`. */
  fxRate?: Money.MoneyInput | null;
  expectedArrivalDate?: string | null;
  notes?: string | null;
}

export interface ReceiveInput {
  locationId: number;
  receivedAt: string | Date;
  quantityCounted: number;
  countSource: (typeof COUNT_SOURCES)[number];
  note?: string | null;
  fxRate?: Money.MoneyInput | null;
}

export type ClaimInput = { action: 'settle'; amountRecovered: Money.MoneyInput } | { action: 'write_off'; note?: string | null };

const INCLUDE = {
  product: { select: { id: true, name: true, sku: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  receivedBy: { select: { id: true, firstName: true, lastName: true } },
  destinationLocation: { select: { id: true, name: true, type: true } },
} as const;

/** Total in the shipment currency: quantity x unit cost + shipping + customs + other. */
function computeTotal(unitCost: Money.Money, quantity: number, shipping: Money.Money, customs: Money.Money, other: Money.Money): Money.Money {
  return Money.roundHalfUp(Money.sum([Money.mul(unitCost, quantity), shipping, customs, other]), 4);
}

/** Money from request input. Empty or invalid input is zero. */
const moneyInput = (value: unknown): Money.Money => Money.tryParse(value) ?? Money.ZERO;

type Row = Prisma.InventoryShipmentGetPayload<{ include: typeof INCLUDE }>;

/**
 * The shipment as the API returns it. `currency` is the effective one. `totalCost` stays in that currency; `totalCostStore`
 * is the store-currency amount (stored once received, else the total at the stored rate). `landedCostPerUnit` is stored once
 * received; before that it is the total in store currency over the units shipped (the live figure of F-604).
 */
function present(row: Row, storeCurrency: string) {
  const currency = row.currency ?? storeCurrency;
  const rate = row.fxRate ? Money.parse(row.fxRate) : Money.parse(1);
  const totalCostStore = row.totalCostStore ?? Money.roundHalfUp(Money.mul(row.totalCost, rate), 4);
  const units = row.quantityCounted ?? row.quantity;
  const landedCostPerUnit = row.landedCostPerUnit ?? (units > 0 ? Money.roundHalfUp(Money.div(totalCostStore, units), 4) : null);
  return { ...row, currency, storeCurrency, totalCostStore, landedCostPerUnit };
}

async function audit(tx: TransactionClient, actor: ShipmentActor, action: string, resourceId: number, metadata: Prisma.InputJsonObject) {
  await tx.auditLog.create({
    data: {
      tenantId: resolveTenantId(), userId: actor.id, actorKind: 'person', channel: 'app',
      action, resource: 'inventory_shipment', resourceId: String(resourceId), metadata,
    },
  });
}

/** Row lock on the shipment, so a receive, an edit, a delete and a claim of the same shipment run one after the other. */
async function lockShipment(tx: TransactionClient, id: number) {
  const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM inventory_shipments WHERE id = ${id} AND tenant_id = ${resolveTenantId()} FOR UPDATE`;
  if (locked.length === 0) throw new AppError('Shipment not found', 404);
  return tx.inventoryShipment.findUniqueOrThrow({ where: { id }, include: { product: true } });
}

function parseCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) throw new AppError('currency must be a 3-letter currency code', 400);
  return value.toUpperCase();
}

function parseRate(value: unknown): Money.Money {
  const rate = Money.tryParse(value);
  if (!rate || !rate.gt(0)) throw new AppError('fxRate must be a number above 0', 400);
  return rate;
}

const ymd = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Rate of a shipment currency into the store currency on a day. A hand-typed rate wins (`manual`). The store currency
 * itself needs none. A foreign currency with no stored rate is a 400 with a message that says what to do.
 */
async function resolveRate(tenantId: string, currency: string, storeCurrency: string, date: Date, manual?: unknown): Promise<{ fxRate: Money.Money | null; fxRateSource: FxSource | null }> {
  if (currency === storeCurrency) return { fxRate: null, fxRateSource: null };
  if (manual != null && manual !== '') return { fxRate: parseRate(manual), fxRateSource: 'manual' };
  const found = await rateOn(tenantId, currency, storeCurrency, date);
  if (!found) throw new AppError(`No exchange rate from ${currency} to ${storeCurrency} for ${ymd(date)}. Add a rate in Settings or type one for this shipment.`, 400);
  return { fxRate: found.rate, fxRateSource: found.source };
}

/** The store-currency rate to multiply by (1 for the store currency). */
const factor = (fxRate: Money.Money | null) => fxRate ?? Money.parse(1);

export async function listShipments(filters: { status?: string; productId?: number } = {}) {
  const where: Prisma.InventoryShipmentWhereInput = {};
  if (filters.status === 'pending') where.status = 'pending';
  else if (filters.status === 'received' || filters.status === 'arrived') where.status = { in: ['received', 'arrived'] };
  if (filters.productId) where.productId = filters.productId;
  const [rows, storeCurrency] = await Promise.all([
    prisma.inventoryShipment.findMany({ where, include: INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    getCurrency(),
  ]);
  return rows.map((r) => present(r, storeCurrency));
}

/** The three tiles of the Incoming shipments tab: pending count, units on the way, cost to land them in store currency. */
export async function summary() {
  const [pending, storeCurrency] = await Promise.all([
    prisma.inventoryShipment.findMany({ where: { status: 'pending' }, select: { quantity: true, totalCost: true, fxRate: true } }),
    getCurrency(),
  ]);
  const costToLand = Money.sum(pending.map((s) => Money.mul(s.totalCost, s.fxRate ?? 1)));
  return {
    pendingCount: pending.length,
    unitsOnTheWay: pending.reduce((n, s) => n + s.quantity, 0),
    costToLand: Money.toApi(Money.roundHalfUp(costToLand, 2)),
    currency: storeCurrency,
  };
}

export async function getShipment(id: number) {
  const row = await prisma.inventoryShipment.findUnique({ where: { id }, include: INCLUDE });
  if (!row) throw new AppError('Shipment not found', 404);
  return present(row, await getCurrency());
}

export async function createShipment(actor: ShipmentActor, input: ShipmentInput) {
  const tenantId = resolveTenantId();
  const quantity = input.quantity;
  if (!input.productId || !Number.isInteger(quantity) || (quantity as number) < 1) throw new AppError('Product and quantity (>= 1) are required', 400);
  const product = await prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, productType: true, name: true } });
  if (!product) throw new AppError('Product not found', 404);
  if (product.productType === 'digital') throw new AppError(`"${product.name}" is a digital product and has no stock`, 400);

  const storeCurrency = await getCurrency();
  const currency = input.currency ? parseCurrency(input.currency) : storeCurrency;
  const { fxRate, fxRateSource } = await resolveRate(tenantId, currency, storeCurrency, new Date(), input.fxRate);
  const unitCost = moneyInput(input.unitCost);
  const shipping = moneyInput(input.shippingCost);
  const customs = moneyInput(input.customsDuties);
  const other = moneyInput(input.otherCosts);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.inventoryShipment.create({
      data: {
        productId: product.id, supplier: input.supplier || null, quantity: quantity as number,
        unitCost, shippingCost: shipping, customsDuties: customs, otherCosts: other,
        totalCost: computeTotal(unitCost, quantity as number, shipping, customs, other),
        currency: currency === storeCurrency ? null : currency, fxRate, fxRateSource,
        expectedArrivalDate: input.expectedArrivalDate ? new Date(input.expectedArrivalDate) : null,
        notes: input.notes || null, createdById: actor.id,
      },
    });
    await audit(tx, actor, 'create', row.id, { productId: product.id, quantity: row.quantity, currency, total: Money.toApi(row.totalCost) });
    return row;
  });
  return getShipment(created.id);
}

export async function updateShipment(actor: ShipmentActor, id: number, input: ShipmentInput) {
  const tenantId = resolveTenantId();
  const storeCurrency = await getCurrency();
  const peek = await prisma.inventoryShipment.findUnique({ where: { id }, select: { id: true, status: true, currency: true, fxRate: true, fxRateSource: true, createdAt: true } });
  if (!peek) throw new AppError('Shipment not found', 404);
  if (peek.status !== 'pending') throw new AppError('Only a pending shipment can be edited', 409);

  // A new currency, or a typed rate, or an automatic rate: look the rate up again (at the day the shipment was added).
  const currency = input.currency !== undefined ? (input.currency ? parseCurrency(input.currency) : storeCurrency) : (peek.currency ?? storeCurrency);
  const keepsManual = peek.fxRateSource === 'manual' && currency === (peek.currency ?? storeCurrency) && input.fxRate == null;
  const rate = keepsManual
    ? { fxRate: peek.fxRate ? Money.parse(peek.fxRate) : null, fxRateSource: peek.fxRateSource }
    : await resolveRate(tenantId, currency, storeCurrency, peek.createdAt, input.fxRate);

  await prisma.$transaction(async (tx) => {
    const shipment = await lockShipment(tx, id);
    if (shipment.status !== 'pending') throw new AppError('Only a pending shipment can be edited', 409);
    const quantity = input.quantity !== undefined ? input.quantity : shipment.quantity;
    if (!Number.isInteger(quantity) || (quantity as number) < 1) throw new AppError('Quantity must be a whole number above 0', 400);
    const unitCost = input.unitCost !== undefined ? moneyInput(input.unitCost) : Money.parse(shipment.unitCost);
    const shipping = input.shippingCost !== undefined ? moneyInput(input.shippingCost) : Money.parse(shipment.shippingCost);
    const customs = input.customsDuties !== undefined ? moneyInput(input.customsDuties) : Money.parse(shipment.customsDuties);
    const other = input.otherCosts !== undefined ? moneyInput(input.otherCosts) : Money.parse(shipment.otherCosts);
    const totalCost = computeTotal(unitCost, quantity as number, shipping, customs, other);
    await tx.inventoryShipment.update({
      where: { id },
      data: {
        supplier: input.supplier !== undefined ? (input.supplier || null) : undefined,
        quantity: quantity as number, unitCost, shippingCost: shipping, customsDuties: customs, otherCosts: other, totalCost,
        currency: currency === storeCurrency ? null : currency, fxRate: rate.fxRate, fxRateSource: rate.fxRateSource,
        expectedArrivalDate: input.expectedArrivalDate !== undefined ? (input.expectedArrivalDate ? new Date(input.expectedArrivalDate) : null) : undefined,
        notes: input.notes !== undefined ? (input.notes || null) : undefined,
      },
    });
    await audit(tx, actor, 'update', id, { quantity: quantity as number, currency, total: Money.toApi(totalCost), before: { quantity: shipment.quantity, total: Money.toApi(shipment.totalCost) } });
  });
  return getShipment(id);
}

export async function deleteShipment(actor: ShipmentActor, id: number) {
  await prisma.$transaction(async (tx) => {
    const shipment = await lockShipment(tx, id);
    if (shipment.status !== 'pending') throw new AppError('A received shipment cannot be deleted: it has stock and ledger entries', 409);
    await tx.inventoryShipment.delete({ where: { id } });
    await audit(tx, actor, 'delete', id, { productId: shipment.productId, quantity: shipment.quantity, total: Money.toApi(shipment.totalCost) });
  });
}

/**
 * Receive a shipment: once, atomically. The shipment row is locked first, then the product. Counted 0 to shipped; the units
 * counted go to `locationId` as one `receipt` movement. Landed cost per unit = total in store currency / counted (D2).
 */
export async function receiveShipment(actor: ShipmentActor, id: number, input: ReceiveInput) {
  const tenantId = resolveTenantId();
  const receivedAt = new Date(input.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) throw new AppError('receivedAt must be a date', 400);
  if (receivedAt.getTime() > Date.now()) throw new AppError('The received date cannot be in the future', 400);
  if (!Number.isInteger(input.quantityCounted) || input.quantityCounted < 0) throw new AppError('Counted quantity must be a whole number, 0 or more', 400);
  if (!COUNT_SOURCES.includes(input.countSource)) throw new AppError('countSource must be own_count, three_pl_dashboard or agent_count', 400);

  const storeCurrency = await getCurrency();
  const peek = await prisma.inventoryShipment.findUnique({ where: { id }, select: { currency: true, status: true } });
  if (!peek) throw new AppError('Shipment not found', 404);
  if (peek.status !== 'pending') throw new AppError(`This shipment is already ${peek.status}`, 409);
  const currency = peek.currency ?? storeCurrency;
  // The rate of the received date (F-606). Looked up before the lock; the shipment's currency is checked again under it.
  const { fxRate, fxRateSource } = await resolveRate(tenantId, currency, storeCurrency, receivedAt, input.fxRate);

  await prisma.$transaction(async (tx) => {
    const shipment = await lockShipment(tx, id);
    if (shipment.status !== 'pending') throw new AppError(`This shipment is already ${shipment.status}`, 409);
    if ((shipment.currency ?? storeCurrency) !== currency) throw new AppError('The shipment changed while you received it. Try again.', 409);
    const counted = input.quantityCounted;
    if (counted > shipment.quantity) throw new AppError(`Counted quantity cannot be above the ${shipment.quantity} shipped`, 400);

    const product = await lockProduct(tx, shipment.productId);
    const location = await getLocation(tx, input.locationId);
    if (!PHYSICAL.includes(location.type)) throw new AppError('Receive into an own store, a 3PL or an agent, not the in-transit location', 400);
    if (!location.isActive) throw new AppError(`${location.name} is not active`, 400);

    const short = shipment.quantity - counted;
    const totalCostStore = Money.roundHalfUp(Money.mul(shipment.totalCost, factor(fxRate)), 4);
    const landedCostPerUnit = counted > 0 ? Money.roundHalfUp(Money.div(totalCostStore, counted), 4) : null;

    // On hand before the receipt, under the product lock; a negative total counts as 0.
    const before = Math.max(await getOnHand(shipment.productId, undefined, tx), 0);
    if (counted > 0) {
      const { row } = await applyMovement(tx, {
        type: 'receipt', productId: shipment.productId, quantity: counted, createdById: actor.id,
        toLocationId: location.id, shipmentId: shipment.id, lockedProduct: product,
        notes: short > 0 ? `Shipment received, ${short} short` : 'Shipment received',
      });
      await tx.inventoryTransfer.update({ where: { id: row.id }, data: { receivedQuantity: counted, receivedAt, receivedById: actor.id } });

      // Weighted-average product cost (F-611). With no units on hand and none counted the old cost stays.
      const units = before + counted;
      const oldCost = Money.orZero(product.cogs);
      const average = units > 0
        ? Money.roundHalfUp(Money.div(Money.add(Money.mul(before, oldCost), Money.mul(counted, landedCostPerUnit!)), units), 4)
        : oldCost;
      await tx.product.update({ where: { id: shipment.productId }, data: { cogs: average } });
    }

    const unitCostStore = Money.mul(shipment.unitCost, factor(fxRate));
    const claimAmount = short > 0 ? Money.roundHalfUp(Money.mul(short, unitCostStore), 4) : Money.ZERO;
    const entry = await GLAutomationService.createInventoryPurchaseEntry(tx as any, shipment, totalCostStore, receivedAt, actor.id);

    await tx.inventoryShipment.update({
      where: { id },
      data: {
        status: 'received', receivedAt, receivedById: actor.id, destinationLocationId: location.id,
        quantityCounted: counted, shortQuantity: short, totalCostStore, landedCostPerUnit,
        fxRate, fxRateSource, glJournalEntryId: entry.id,
        claimStatus: short > 0 ? 'open' : 'none', claimAmount,
        notes: input.note ? (shipment.notes ? `${shipment.notes}\n${input.note}` : input.note) : undefined,
      },
    });
    if (short > 0) {
      await openFindingOnce({
        tenantId, type: 'stock_gap', subjectType: 'inventory_shipment', subjectId: String(id), amount: claimAmount,
        note: `Shipment ${id}: ${short} ${product.name} short (${counted} of ${shipment.quantity} counted)`,
      }, {}, tx);
    }
    if (input.countSource === 'three_pl_dashboard') {
      const count = await tx.stockCount.create({
        data: {
          tenantId, locationId: location.id, countDate: new Date(`${ymd(receivedAt)}T00:00:00.000Z`), source: input.countSource as StockCountSource,
          countedById: actor.id, note: `Shipment ${id} received`,
        },
      });
      await tx.stockCountLine.create({
        data: { tenantId, countId: count.id, productId: shipment.productId, systemQuantity: shipment.quantity, countedQuantity: counted, difference: counted - shipment.quantity },
      });
    }
    await audit(tx, actor, 'receive', id, {
      productId: shipment.productId, shipped: shipment.quantity, counted, short, locationId: location.id, countSource: input.countSource,
      totalCostStore: Money.toApi(totalCostStore), landedCostPerUnit: landedCostPerUnit ? Money.toApi(landedCostPerUnit) : null, claimAmount: Money.toApi(claimAmount),
    });
  }, { timeout: 30_000 });
  return getShipment(id);
}

/** Close the shipment's Finding (the gap is explained: recovered or written off). */
async function closeFinding(tx: TransactionClient, id: number, note: string) {
  await tx.finding.updateMany({
    where: { type: 'stock_gap', subjectType: 'inventory_shipment', subjectId: String(id), status: 'open' },
    data: { status: 'explained', note },
  });
}

/**
 * Settle or write off the supplier claim of a received shipment (F-608). Only an open claim. Settled with an amount
 * recovered: one ledger entry, DR 1010 cash / CR 1200 inventory, for that amount. Written off: no entry (the loss is already
 * in the landed cost per unit). Either way the Finding closes.
 */
export async function settleClaim(actor: ShipmentActor, id: number, input: ClaimInput) {
  if (!CLAIM_ACTIONS.includes(input.action)) throw new AppError('action must be settle or write_off', 400);
  await prisma.$transaction(async (tx) => {
    const shipment = await lockShipment(tx, id);
    if (shipment.claimStatus !== 'open') throw new AppError(`This shipment has no open claim (claim is ${shipment.claimStatus})`, 409);

    if (input.action === 'settle') {
      const recovered = Money.tryParse(input.amountRecovered);
      if (!recovered || !recovered.gt(0)) throw new AppError('amountRecovered must be above 0', 400);
      if (recovered.gt(shipment.claimAmount)) throw new AppError(`amountRecovered cannot be above the claim of ${Money.toApi(shipment.claimAmount)}`, 400);
      const entry = await GLAutomationService.createInventoryClaimEntry(tx as any, shipment, Money.roundHalfUp(recovered, 4), actor.id);
      await tx.inventoryShipment.update({
        where: { id },
        data: { claimStatus: 'settled', claimRecovered: Money.roundHalfUp(recovered, 4), claimJournalEntryId: entry.id },
      });
      await closeFinding(tx, id, `Claim on shipment ${id} settled: ${Money.toApi(recovered)} recovered`);
      await audit(tx, actor, 'claim_settle', id, { claimAmount: Money.toApi(shipment.claimAmount), amountRecovered: Money.toApi(recovered), journalEntryId: entry.id });
    } else {
      const note = (input as { note?: string | null }).note?.trim() || null;
      await tx.inventoryShipment.update({ where: { id }, data: { claimStatus: 'written_off', claimNote: note ?? shipment.claimNote } });
      await closeFinding(tx, id, `Claim on shipment ${id} written off${note ? `: ${note}` : ''}`);
      await audit(tx, actor, 'claim_write_off', id, { claimAmount: Money.toApi(shipment.claimAmount), note });
    }
  });
  return getShipment(id);
}
