import { Prisma, StockLocationType, TransferStatus, TransferType } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { withSoftDeleted } from '../utils/prismaExtensions';
import * as Money from '../utils/money';
import { RESERVING, getOnHand } from './stockService';
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

/** Reserved units per (holder user, product): orders in a reserving status at the order's delivery partner (F-651). */
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

/** The latest count line per (location, product), newest count date first. */
async function latestCountLines(): Promise<CountRow[]> {
  const rows = await prisma.$queryRaw<Array<{ countId: number; lineId: number; locationId: number; productId: number; counted: number; source: string; date: string; createdAt: Date }>>(Prisma.sql`
    SELECT DISTINCT ON (c.location_id, l.product_id)
      c.id AS "countId", l.id AS "lineId", c.location_id AS "locationId", l.product_id AS "productId", l.counted_quantity AS counted,
      c.source::text AS source, TO_CHAR(c.count_date, 'YYYY-MM-DD') AS date, c.created_at AS "createdAt"
    FROM stock_count_lines l JOIN stock_counts c ON c.id = l.count_id
    WHERE l.tenant_id = ${resolveTenantId()}
    ORDER BY c.location_id, l.product_id, c.count_date DESC, c.id DESC`);
  return rows;
}

/**
 * Units moved at a (location, product) after the count was saved make the count old ("Count is old", F-652).
 * Left out: the movement an "Apply count" wrote (it is the count's own fix), and units still in transit (they sit on the
 * transfer row and are shown in their own column).
 */
async function oldCounts(counts: CountRow[]): Promise<Set<string>> {
  if (counts.length === 0) return new Set();
  const since = new Date(Math.min(...counts.map((c) => c.createdAt.getTime())));
  const moves = await prisma.inventoryTransfer.findMany({
    where: {
      appliedCountLines: { none: {} },
      productId: { in: [...new Set(counts.map((c) => c.productId))] },
      OR: [{ fromLocationId: { in: [...new Set(counts.map((c) => c.locationId))] } }, { toLocationId: { in: [...new Set(counts.map((c) => c.locationId))] } }],
      AND: [{ OR: [{ createdAt: { gt: since } }, { receivedAt: { gt: since } }] }],
    },
    select: { productId: true, fromLocationId: true, toLocationId: true, status: true, createdAt: true, receivedAt: true },
  });
  const old = new Set<string>();
  for (const c of counts) {
    const after = moves.some((m) => m.productId === c.productId && (m.fromLocationId === c.locationId || m.toLocationId === c.locationId)
      && ((m.status !== 'in_transit' && m.createdAt > c.createdAt) || (m.toLocationId === c.locationId && m.receivedAt != null && m.receivedAt > c.createdAt)));
    if (after) old.add(key(c.locationId, c.productId));
  }
  return old;
}

/** Our records against the latest count of one (location, product). "Count is old" replaces the gap when stock moved after it. */
function compare(count: CountRow, onHand: number, isOld: boolean) {
  const difference = onHand - count.counted;
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

export async function levels(f: { locationId?: number; productId?: number }) {
  const rows = await levelRows(f);
  return { levels: rows.filter((r) => r.onHand !== 0 || r.reserved > 0 || r.inTransit > 0) };
}

export interface OverviewFilters { productId?: number; type?: StockLocationType; onlyDifferences?: boolean }

export async function overview(f: OverviewFilters) {
  const [locations, counts] = await Promise.all([
    prisma.stockLocation.findMany({ where: { isActive: true, type: { not: 'in_transit' } }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    latestCountLines(),
  ]);
  const old = await oldCounts(counts);
  const rows = await levelRows({ activeOnly: true }, counts);

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
  const product = await withSoftDeleted(() => prisma.product.findFirst({ where: { id: productId }, select: { id: true, name: true, sku: true, productType: true, cogs: true, isActive: true } }));
  if (!product) throw new AppError('Product not found', 404);
  if (product.productType === 'digital') throw new AppError('A digital product has no stock to hold', 400);

  const [levelRowsList, locations, moves, counts] = await Promise.all([
    levelRows({ productId }),
    prisma.stockLocation.findMany({ where: { type: { not: 'in_transit' } }, orderBy: { name: 'asc' } }),
    prisma.inventoryTransfer.findMany({
      where: { productId, status: { not: 'cancelled' } },
      select: { transferType: true, fromLocationId: true, toLocationId: true, quantity: true, receivedQuantity: true, status: true, reversedAt: true },
    }),
    latestCountLines(),
  ]);
  const old = await oldCounts(counts.filter((c) => c.productId === productId));
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
    productTotal: await getOnHand(productId),
    // Active holders with none of this product (F-603 note)
    holdersWithNone: rows.filter((r) => !r.active && r.isActive).map((r) => r.name),
  };
}

export interface TransferFilters { type?: TransferType; status?: TransferStatus; locationId?: number; productId?: number; from?: string; to?: string; page: number; limit: number }

/** Movement history with filters and pagination (F-659). `typeCounts` are the tab counts for the other filters. */
export async function transfers(f: TransferFilters) {
  const zone = getStoreTimeZone(resolveTenantId());
  let range: Prisma.DateTimeFilter | undefined;
  try {
    range = f.from || f.to ? { ...(f.from ? { gte: parseBound(f.from, 'from', zone) } : {}), ...(f.to ? { lt: parseBound(f.to, 'to', zone) } : {}) } : undefined;
  } catch {
    throw new AppError('from and to must be dates, YYYY-MM-DD', 400);
  }
  const base: Prisma.InventoryTransferWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.productId != null ? { productId: f.productId } : {}),
    ...(f.locationId != null ? { OR: [{ fromLocationId: f.locationId }, { toLocationId: f.locationId }] } : {}),
    ...(range ? { createdAt: range } : {}),
  };
  const where: Prisma.InventoryTransferWhereInput = { ...base, ...(f.type ? { transferType: f.type } : {}) };
  const [rows, total, groups] = await Promise.all([
    prisma.inventoryTransfer.findMany({ where, include: TRANSFER_INCLUDE, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (f.page - 1) * f.limit, take: f.limit }),
    prisma.inventoryTransfer.count({ where }),
    prisma.inventoryTransfer.groupBy({ by: ['transferType'], where: base, _count: { _all: true } }),
  ]);
  const now = new Date();
  return {
    transfers: rows.map((r) => presentTransfer(r, now)),
    typeCounts: Object.fromEntries(groups.map((g) => [g.transferType, g._count._all])),
    pagination: { page: f.page, limit: f.limit, total, pages: Math.ceil(total / f.limit) },
  };
}

/**
 * Returns from 3PLs: sent, received, missing (F-656). "Sent" is the quantity of a `return_to_warehouse` transfer out of a 3PL:
 * it is entered by hand through POST /api/inventory/transfers (from the 3PL's return list) until an outside agent can post it.
 * Received is the count confirmed on the receiving side. A return still in transit is not counted yet. The period is the
 * date the return was recorded. Each return with missing units opens one `stock_gap` Finding (missing x cost).
 */
export async function returnsSummary(f: { from?: string; to?: string; partnerId?: number }) {
  const zone = getStoreTimeZone(resolveTenantId());
  let range: Prisma.DateTimeFilter | undefined;
  try {
    range = f.from || f.to ? { ...(f.from ? { gte: parseBound(f.from, 'from', zone) } : {}), ...(f.to ? { lt: parseBound(f.to, 'to', zone) } : {}) } : undefined;
  } catch {
    throw new AppError('from and to must be dates, YYYY-MM-DD', 400);
  }
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

