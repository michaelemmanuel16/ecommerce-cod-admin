import { Prisma, StockLocationType, TransferStatus, TransferType } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { withSoftDeleted } from '../utils/prismaExtensions';
import * as Money from '../utils/money';
import { RESERVING } from './stockService';
import { TRANSFER_INCLUDE, present as presentTransfer } from './transferService';
import { openFindingOnce } from './findingService';
import { getStoreTimeZone, parseBound } from './kpi/dates';

/**
 * Inventory read APIs (F-651, F-652, F-603, F-659, F-656, M4-T15). Nothing here is stored: on hand comes from the levels,
 * reserved from the orders at the holder, in transit from open transfers, delivered / returned / allocated from the
 * movement rows. The one write is the Finding of a missing return (`returnsSummary`).
 */

const key = (a: number, b: number) => `${a}:${b}`;
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

/**
 * Reserved units per (holder user, product): orders in a reserving status at the order's delivery partner (F-651).
 * Raw SQL for the grouping by holder; its WHERE must follow `reservedWhere` in stockService (per-product totals use getReservedMany).
 */
export async function reservedByHolder(productId?: number): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ userId: number; productId: number; units: bigint }>>(Prisma.sql`
    SELECT o.delivery_agent_id AS "userId", i.product_id AS "productId", SUM(i.quantity) AS units
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.tenant_id = ${resolveTenantId()} AND o.deleted_at IS NULL AND o.delivery_agent_id IS NOT NULL
      AND o.status::text IN (${Prisma.join(RESERVING)})
      ${productId != null ? Prisma.sql`AND i.product_id = ${productId}` : Prisma.empty}
    GROUP BY 1, 2`);
  return new Map(rows.map((r) => [key(r.userId, r.productId), num(r.units)]));
}

/** Units sent to a (location, product) that the receiver has not confirmed: open transfers, and the short part of a dispute. */
async function incomingUnits(productId?: number): Promise<Map<string, number>> {
  const open = await prisma.inventoryTransfer.findMany({
    where: { status: { in: ['in_transit', 'disputed'] }, toLocationId: { not: null }, ...(productId != null ? { productId } : {}) },
    select: { toLocationId: true, productId: true, quantity: true, receivedQuantity: true, status: true },
  });
  const out = new Map<string, number>();
  for (const t of open) {
    const k = key(t.toLocationId!, t.productId);
    out.set(k, (out.get(k) ?? 0) + (t.status === 'disputed' ? t.quantity - (t.receivedQuantity ?? 0) : t.quantity));
  }
  return out;
}

interface CountRow {
  countId: number; lineId: number; locationId: number; productId: number; counted: number; source: string; date: string; createdAt: Date;
}

/** The latest whole-location count line per (location, product); with `productId`, only for that product. */
async function latestCountLines(productId?: number): Promise<CountRow[]> {
  const rows = await prisma.$queryRaw<Array<{ countId: number; lineId: number; locationId: number; productId: number; counted: number; source: string; date: string; createdAt: Date }>>(Prisma.sql`
    SELECT DISTINCT ON (c.location_id, l.product_id)
      c.id AS "countId", l.id AS "lineId", c.location_id AS "locationId", l.product_id AS "productId", l.counted_quantity AS counted,
      c.source::text AS source, TO_CHAR(c.count_date, 'YYYY-MM-DD') AS date, c.created_at AS "createdAt"
    FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id
    WHERE l.tenant_id = ${resolveTenantId()}
      -- Not the one-line count a 3PL-dashboard receive writes (shipmentService.receiveShipment): it counts the arrival (shipped
      -- against counted), not the whole location. It links its shipment.
      AND c.shipment_id IS NULL${productId != null ? Prisma.sql` AND l.product_id = ${productId}` : Prisma.empty}
    ORDER BY c.location_id, l.product_id, c.count_date DESC, c.id DESC`);
  return rows;
}

/**
 * Any change of the on-hand number at a (location, product) after the count was saved makes the count old ("Count is old", F-652).
 * Every on-hand change is an `InventoryTransfer` row (adjustments, receipts, order fulfilment and its reversal, transfers):
 * - the SOURCE of a move loses its units when the row is created, whatever the status is afterwards (an open transfer included);
 * - the DESTINATION gains them when the move is received (`receivedAt`), or at creation for a move that is received at once;
 *   a transfer still in transit to the location does not change its on-hand yet.
 * Two changes settle an old row and leave no time on it: a cancel, and a dispute resolved with "return to source". Both put units
 * back at the source, and their audit rows say when.
 * Left out: the movement an "Apply count" wrote (it is the count's own fix).
 */
async function oldCounts(counts: CountRow[]): Promise<Set<string>> {
  if (counts.length === 0) return new Set();
  const since = new Date(Math.min(...counts.map((c) => c.createdAt.getTime())));
  const productIds = [...new Set(counts.map((c) => c.productId))];
  const locationIds = [...new Set(counts.map((c) => c.locationId))];
  const select = { id: true, productId: true, fromLocationId: true, toLocationId: true, status: true, createdAt: true, receivedAt: true } as const;
  const [moves, settled] = await Promise.all([
    prisma.inventoryTransfer.findMany({
      where: {
        appliedCountLines: { none: {} },
        productId: { in: productIds },
        OR: [{ fromLocationId: { in: locationIds } }, { toLocationId: { in: locationIds } }],
        AND: [{ OR: [{ createdAt: { gt: since } }, { receivedAt: { gt: since } }] }],
      },
      select,
    }),
    prisma.auditLog.findMany({
      where: { resource: 'inventory_transfer', action: { in: ['cancel', 'resolve'] }, createdAt: { gt: since }, resourceId: { not: null } },
      select: { resourceId: true, createdAt: true },
    }),
  ]);
  const settledRows = settled.length === 0 ? [] : await prisma.inventoryTransfer.findMany({
    where: { id: { in: settled.map((a) => Number(a.resourceId)) }, productId: { in: productIds }, fromLocationId: { in: locationIds } },
    select,
  });
  const settledAt = new Map(settledRows.map((r) => [r.id, r]));

  const old = new Set<string>();
  for (const c of counts) {
    const after = (at: Date | null) => at != null && at > c.createdAt;
    const changed = moves.some((m) => m.productId === c.productId && (
      (m.fromLocationId === c.locationId && after(m.createdAt))
      || (m.toLocationId === c.locationId && (m.status === 'received' || m.status === 'disputed') && after(m.receivedAt ?? m.createdAt))
    )) || settled.some((a) => {
      const row = settledAt.get(Number(a.resourceId));
      return row != null && row.productId === c.productId && row.fromLocationId === c.locationId && after(a.createdAt);
    });
    if (changed) old.add(key(c.locationId, c.productId));
  }
  return old;
}

/**
 * Our records against the latest count of one (location, product). "Count is old" replaces the gap when stock moved after it.
 * `difference` is counted minus our records, the sign of StockCountLine.difference: -12 means 12 fewer units than our records say.
 */
function compare(count: CountRow, onHand: number, isOld: boolean) {
  const difference = count.counted - onHand;
  return {
    countId: count.countId, lineId: count.lineId, date: count.date, source: count.source, counted: count.counted,
    difference: isOld ? null : difference,
    status: isOld ? 'old' as const : difference === 0 ? 'matches' as const : 'off' as const,
  };
}

interface LevelRow {
  locationId: number; locationName: string; locationType: StockLocationType; locationActive: boolean;
  productId: number; productName: string; sku: string; archived: boolean;
  onHand: number; reserved: number; inTransit: number;
}

/** One row per (location, product) that has stock, reserved or incoming units, or (with `extra`) a count. */
async function levelRows(f: { locationId?: number; productId?: number; type?: StockLocationType; activeOnly?: boolean }, extra: CountRow[] = []): Promise<LevelRow[]> {
  const [levels, reserved, incoming] = await Promise.all([
    prisma.stockLevel.findMany({
      where: {
        ...(f.productId != null ? { productId: f.productId } : {}),
        location: { type: f.type ?? { not: 'in_transit' }, ...(f.locationId != null ? { id: f.locationId } : {}), ...(f.activeOnly ? { isActive: true } : {}) },
      },
      include: { location: true, product: { select: { name: true, sku: true, isActive: true } } },
    }),
    reservedByHolder(f.productId),
    incomingUnits(f.productId),
  ]);
  const rows = new Map<string, LevelRow>();
  const userOf = new Map<number, number | null>();
  const add = (loc: { id: number; name: string; type: StockLocationType; isActive: boolean; userId: number | null }, prod: { id: number; name: string; sku: string; isActive: boolean }, onHand: number) => {
    userOf.set(loc.id, loc.userId);
    rows.set(key(loc.id, prod.id), {
      locationId: loc.id, locationName: loc.name, locationType: loc.type, locationActive: loc.isActive,
      productId: prod.id, productName: prod.name, sku: prod.sku, archived: !prod.isActive, onHand, reserved: 0, inTransit: 0,
    });
  };
  for (const l of levels) add(l.location, { id: l.productId, ...l.product }, l.quantity);
  // Incoming units and counts at a pair that has no level row yet
  const missing = [...incoming.keys(), ...extra.map((c) => key(c.locationId, c.productId))].filter((k) => !rows.has(k));
  if (missing.length > 0) {
    const pairs = [...new Set(missing)].map((k) => k.split(':').map(Number) as [number, number]).filter(([loc, prod]) => (f.locationId == null || loc === f.locationId) && (f.productId == null || prod === f.productId));
    const [locs, prods] = await Promise.all([
      prisma.stockLocation.findMany({ where: { id: { in: [...new Set(pairs.map((p) => p[0]))] }, type: f.type ?? { not: 'in_transit' }, ...(f.activeOnly ? { isActive: true } : {}) } }),
      withSoftDeleted(() => prisma.product.findMany({ where: { id: { in: [...new Set(pairs.map((p) => p[1]))] } }, select: { id: true, name: true, sku: true, isActive: true } })),
    ]);
    const locById = new Map(locs.map((l) => [l.id, l]));
    const prodById = new Map(prods.map((p) => [p.id, p]));
    for (const [loc, prod] of pairs) {
      if (locById.has(loc) && prodById.has(prod)) add(locById.get(loc)!, prodById.get(prod)!, 0);
    }
  }
  for (const [k, row] of rows) {
    const userId = userOf.get(row.locationId);
    row.reserved = userId != null ? reserved.get(key(userId, row.productId)) ?? 0 : 0;
    row.inTransit = incoming.get(k) ?? 0;
  }
  return [...rows.values()].sort((a, b) => a.productName.localeCompare(b.productName) || a.locationName.localeCompare(b.locationName));
}

/** `scopeLocationId` is set for a delivery agent: their own location, whatever the query asked (the route has refused another one). */
export async function levels(f: { locationId?: number; productId?: number; scopeLocationId?: number }) {
  const rows = await levelRows({ locationId: f.scopeLocationId ?? f.locationId, productId: f.productId });
  return { levels: rows.filter((r) => r.onHand !== 0 || r.reserved > 0 || r.inTransit > 0) };
}

export interface OverviewFilters { productId?: number; type?: StockLocationType; onlyDifferences?: boolean }

export async function overview(f: OverviewFilters) {
  const [locations, counts] = await Promise.all([
    prisma.stockLocation.findMany({ where: { isActive: true, type: { not: 'in_transit' } }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    latestCountLines(),
  ]);
  const [old, rows] = await Promise.all([oldCounts(counts), levelRows({ activeOnly: true }, counts)]);

  const countOf = new Map(counts.map((c) => [key(c.locationId, c.productId), c]));
  const table = rows.map((r) => {
    const c = countOf.get(key(r.locationId, r.productId));
    return { ...r, count: c ? compare(c, r.onHand, old.has(key(r.locationId, r.productId))) : null };
  }).filter((r) => r.onHand !== 0 || r.reserved > 0 || r.inTransit > 0 || r.count != null);

  const cards = locations.map((loc) => {
    const mine = table.filter((r) => r.locationId === loc.id);
    // The latest count of this location: every line of it, compared with our records now
    const latestId = counts.filter((c) => c.locationId === loc.id).sort((a, b) => b.date.localeCompare(a.date) || b.countId - a.countId)[0]?.countId;
    const lines = latestId == null ? [] : mine.filter((r) => r.count?.countId === latestId);
    const comparable = lines.filter((r) => r.count!.status !== 'old');
    const first = lines[0]?.count;
    return {
      id: loc.id, name: loc.name, type: loc.type, address: loc.address, userId: loc.userId,
      onHand: mine.reduce((s, r) => s + r.onHand, 0),
      reserved: mine.reduce((s, r) => s + r.reserved, 0),
      products: mine.filter((r) => r.onHand !== 0).length,
      inTransit: mine.reduce((s, r) => s + r.inTransit, 0),
      latestCount: first ? {
        countId: first.countId, date: first.date, source: first.source,
        unitsOff: comparable.reduce((s, r) => s + Math.abs(r.count!.difference ?? 0), 0),
        isOld: comparable.length === 0,
      } : null,
    };
  });

  const filtered = table.filter((r) => (f.productId == null || r.productId === f.productId) && (f.type == null || r.locationType === f.type)
    && (!f.onlyDifferences || r.count?.status === 'off'));
  return { hasOwnStore: locations.some((l) => l.type === 'own_store'), locations: cards, stockByLocation: filtered };
}

/** Per holder of one product: allocated, in transit, delivered, returned, on hand, value; a total row (F-603). */
export async function holders(productId: number) {
  const [product, levelRowsList, locations, moves, counts] = await Promise.all([
    withSoftDeleted(() => prisma.product.findFirst({ where: { id: productId }, select: { id: true, name: true, sku: true, productType: true, cogs: true, isActive: true } })),
    levelRows({ productId }),
    prisma.stockLocation.findMany({ where: { type: { not: 'in_transit' } }, orderBy: { name: 'asc' } }),
    prisma.inventoryTransfer.findMany({
      where: { productId, status: { not: 'cancelled' } },
      select: { transferType: true, fromLocationId: true, toLocationId: true, quantity: true, receivedQuantity: true, status: true, reversedAt: true },
    }),
    latestCountLines(productId),
  ]);
  if (!product) throw new AppError('Product not found', 404);
  if (product.productType === 'digital') throw new AppError('A digital product has no stock to hold', 400);
  const old = await oldCounts(counts);
  const cost = Money.orZero(product.cogs);

  const allocated = new Map<number, number>();
  const delivered = new Map<number, number>();
  const returned = new Map<number, number>();
  const bump = (m: Map<number, number>, loc: number | null, n: number) => { if (loc != null) m.set(loc, (m.get(loc) ?? 0) + n); };
  const IN: TransferType[] = ['allocation', 'agent_transfer', 'receipt', 'opening'];
  for (const m of moves) {
    // Units that reached the holder: a settled row counts what was received, an open one counts nothing yet.
    const credited = m.status === 'in_transit' ? 0 : m.receivedQuantity ?? (m.status === 'disputed' ? 0 : m.quantity);
    if (IN.includes(m.transferType)) bump(allocated, m.toLocationId, credited);
    if (m.transferType === 'order_fulfillment' && m.reversedAt == null) bump(delivered, m.fromLocationId, m.quantity);
    if (m.transferType === 'return_to_warehouse') bump(returned, m.fromLocationId, m.quantity);
  }

  const byLocation = new Map(levelRowsList.map((r) => [r.locationId, r]));
  const rows = locations.flatMap((loc) => {
    const level = byLocation.get(loc.id);
    const row = {
      locationId: loc.id, name: loc.name, type: loc.type, isActive: loc.isActive,
      allocated: allocated.get(loc.id) ?? 0, inTransit: level?.inTransit ?? 0, delivered: delivered.get(loc.id) ?? 0,
      returned: returned.get(loc.id) ?? 0, onHand: level?.onHand ?? 0, reserved: level?.reserved ?? 0,
    };
    const c = counts.find((x) => x.locationId === loc.id && x.productId === productId);
    const active = row.onHand !== 0 || row.inTransit > 0 || row.allocated > 0 || row.delivered > 0 || row.returned > 0;
    return loc.isActive || active ? [{ ...row, active, value: Money.toApi(Money.mul(row.onHand, cost)), count: c ? compare(c, row.onHand, old.has(key(loc.id, productId))) : null }] : [];
  });
  const shown = rows.filter((r) => r.active).map(({ active: _a, ...r }) => r);
  const total = shown.reduce(
    (t, r) => ({ allocated: t.allocated + r.allocated, inTransit: t.inTransit + r.inTransit, delivered: t.delivered + r.delivered, returned: t.returned + r.returned, onHand: t.onHand + r.onHand, reserved: t.reserved + r.reserved }),
    { allocated: 0, inTransit: 0, delivered: 0, returned: 0, onHand: 0, reserved: 0 },
  );
  return {
    product: { id: product.id, name: product.name, sku: product.sku, archived: !product.isActive },
    holders: shown,
    total: { ...total, value: Money.toApi(Money.mul(total.onHand, cost)) },
    // On hand over the active physical locations: what the cached product total holds
    productTotal: levelRowsList.filter((r) => r.locationActive).reduce((sum, r) => sum + r.onHand, 0),
    // Active holders with none of this product (F-603 note)
    holdersWithNone: rows.filter((r) => !r.active && r.isActive).map((r) => r.name),
  };
}

/** The createdAt filter of a from / to pair of store-zone days (inclusive of `to`). 400 for a bad day. */
function dateRange(f: { from?: string; to?: string }): Prisma.DateTimeFilter | undefined {
  if (!f.from && !f.to) return undefined;
  const zone = getStoreTimeZone(resolveTenantId());
  try {
    return { ...(f.from ? { gte: parseBound(f.from, 'from', zone) } : {}), ...(f.to ? { lt: parseBound(f.to, 'to', zone) } : {}) };
  } catch {
    throw new AppError('from and to must be dates, YYYY-MM-DD', 400);
  }
}

export interface TransferFilters {
  type?: TransferType; status?: TransferStatus; locationId?: number; productId?: number; from?: string; to?: string;
  page: number; limit: number;
  /** A delivery agent's own location: only moves into or out of it, whatever `locationId` says. */
  scopeLocationId?: number;
  /** Run the total and the per-type counts (the history modal). Recent transfers, the agent screen and exports skip them. */
  includeCounts?: boolean;
}

/** The filters without the type: the tab counts are the other filters' counts per type. */
function baseWhere(f: Omit<TransferFilters, 'page' | 'limit'>): Prisma.InventoryTransferWhereInput {
  const range = dateRange(f);
  const location = f.scopeLocationId ?? f.locationId;
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.productId != null ? { productId: f.productId } : {}),
    ...(location != null ? { OR: [{ fromLocationId: location }, { toLocationId: location }] } : {}),
    ...(range ? { createdAt: range } : {}),
  };
}

const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/** Movement history with filters and pagination (F-659). `typeCounts` and the total come only with `includeCounts`. */
export async function transfers(f: TransferFilters) {
  const base = baseWhere(f);
  const where: Prisma.InventoryTransferWhereInput = { ...base, ...(f.type ? { transferType: f.type } : {}) };
  const [rows, counted] = await Promise.all([
    prisma.inventoryTransfer.findMany({ where, include: TRANSFER_INCLUDE, orderBy: [...NEWEST_FIRST], skip: (f.page - 1) * f.limit, take: f.limit }),
    f.includeCounts
      ? Promise.all([
        prisma.inventoryTransfer.groupBy({ by: ['transferType'], where: base, _count: { _all: true } }),
        // With no type filter the total is the sum of the groups; only a type filter needs its own count
        f.type ? prisma.inventoryTransfer.count({ where }) : Promise.resolve(null),
      ])
      : null,
  ]);
  const now = new Date();
  const body = { transfers: rows.map((r) => presentTransfer(r, now)) };
  if (!counted) return { ...body, pagination: { page: f.page, limit: f.limit } };
  const [groups, typed] = counted;
  const total = typed ?? groups.reduce((sum, g) => sum + g._count._all, 0);
  return {
    ...body,
    typeCounts: Object.fromEntries(groups.map((g) => [g.transferType, g._count._all])),
    pagination: { page: f.page, limit: f.limit, total, pages: Math.ceil(total / f.limit) },
  };
}

/** Every move the filters match, newest first, in batches (the CSV export). */
export async function* transferBatches(f: Omit<TransferFilters, 'page' | 'limit'>, size = 500) {
  const where: Prisma.InventoryTransferWhereInput = { ...baseWhere(f), ...(f.type ? { transferType: f.type } : {}) };
  for (let skip = 0; ; skip += size) {
    const rows = await prisma.inventoryTransfer.findMany({ where, include: TRANSFER_INCLUDE, orderBy: [...NEWEST_FIRST], skip, take: size });
    if (rows.length > 0) yield rows;
    if (rows.length < size) return;
  }
}

/**
 * Returns from 3PLs: sent, received, missing (F-656). "Sent" is the quantity of a `return_to_warehouse` transfer out of a 3PL:
 * it is entered by hand through POST /api/inventory/transfers (from the 3PL's return list) until an outside agent can post it.
 * Received is the count confirmed on the receiving side. A return still in transit is not counted yet. The period is the
 * date the return was recorded. Each return with missing units opens one `stock_gap` Finding (missing x cost).
 */
export async function returnsSummary(f: { from?: string; to?: string; partnerId?: number }) {
  const range = dateRange(f);
  const returns = await prisma.inventoryTransfer.findMany({
    where: {
      transferType: 'return_to_warehouse', status: { in: ['received', 'disputed'] },
      fromLocation: { type: 'partner_3pl', ...(f.partnerId != null ? { userId: f.partnerId } : {}) },
      ...(range ? { createdAt: range } : {}),
    },
    include: { fromLocation: { select: { id: true, name: true, userId: true } }, product: { select: { id: true, name: true, cogs: true } } },
    orderBy: { id: 'asc' },
  });

  const partners = new Map<number, { locationId: number; partnerId: number | null; name: string; sent: number; received: number; missing: number; value: Money.Money }>();
  for (const r of returns) {
    const received = r.receivedQuantity ?? r.quantity;
    const missing = r.quantity - received;
    const loc = r.fromLocation!;
    const p = partners.get(loc.id) ?? { locationId: loc.id, partnerId: loc.userId, name: loc.name, sent: 0, received: 0, missing: 0, value: Money.ZERO };
    p.sent += r.quantity;
    p.received += received;
    p.missing += missing;
    p.value = Money.add(p.value, Money.mul(missing, Money.orZero(r.product.cogs)));
    partners.set(loc.id, p);
    if (missing > 0) {
      await openFindingOnce({
        tenantId: resolveTenantId(), type: 'stock_gap', subjectType: 'return_missing', subjectId: String(r.id),
        amount: Money.mul(missing, Money.orZero(r.product.cogs)),
        note: `${loc.name} sent back ${r.quantity} ${r.product.name}; ${received} received, ${missing} missing`,
      });
    }
  }
  const list = [...partners.values()].map((p) => ({ ...p, value: Money.toApi(p.value) }));
  return {
    partners: list,
    total: {
      sent: list.reduce((s, p) => s + p.sent, 0), received: list.reduce((s, p) => s + p.received, 0), missing: list.reduce((s, p) => s + p.missing, 0),
      value: Money.toApi(Money.sum([...partners.values()].map((p) => p.value))),
    },
  };
}


/** The stock location a delivery agent holds, or null when the account has none. */
export async function locationOfUser(userId: number): Promise<number | null> {
  const loc = await prisma.stockLocation.findFirst({ where: { userId }, select: { id: true } });
  return loc?.id ?? null;
}

/** The audit rows of one transfer, oldest first: who sent, received, resolved or cancelled it, and when (F-659). */
export async function transferTrail(id: number) {
  const exists = await prisma.inventoryTransfer.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new AppError('Transfer not found', 404);
  const rows = await prisma.auditLog.findMany({
    where: { resource: 'inventory_transfer', resourceId: String(id) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  return {
    trail: rows.map((r) => ({ id: r.id, action: r.action, at: r.createdAt, by: r.user, details: r.metadata })),
  };
}
