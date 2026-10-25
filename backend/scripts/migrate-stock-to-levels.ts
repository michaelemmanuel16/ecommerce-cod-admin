import { Prisma, OrderStatus } from '@prisma/client';
import prisma, { prismaBase, TransactionClient } from '../src/utils/prisma';
import { runInTenant } from '../src/utils/tenantContext';
import { withSoftDeleted } from '../src/utils/prismaExtensions';
import { getSystemUserId } from '../src/services/systemUserService';
import { fullName } from '../src/utils/nameUtils';
import { rebuildCache } from '../src/services/stockService';
import { grantAdminUpdateStock } from '../src/services/tenantDefaultsService';
import { assertNotProduction, hasFlag, option } from './lib/scriptArgs';

// M4-T03 / M4-T04 (COD-38, F-650, F-660, F-657). Moves the legacy stock numbers into StockLocation / StockLevel.
// Per tenant, inside the tenant context. A tenant that already has StockLevel rows is skipped (second run changes nothing).
// Flags: --dry-run, --tenant <id>, --default-location "<name>" (default "Logiswift"), --allow-production.
//
// What "stock" meant before this script (read from agentInventoryService, orderSideEffects.legacyStockHook,
// publicOrderService):
//   Product.stockQuantity = warehouse units only (allocateStock lowers it, AgentStock.quantity rises by the same).
//   AgentStock.quantity   = units an agent holds, not yet on an order.
//   Entering out_for_delivery took the units: from AgentStock.quantity (into totalInTransit) when the agent had enough,
//   else from Product.stockQuantity. The state machine seam skips this when the dispatch came through deliveryService
//   (skipLegacyStock; the history row carries metadata.deliveryId). Leaving out_for_delivery gave them back.
//   A COD checkout-form order lowered Product.stockQuantity by the package quantity at creation and never gave it back
//   (cancel included). Paid (Paystack) orders do not.
// From T07 stock leaves a location once, at delivered, and units of an open order count as on hand at the holder.
// So this script puts back every unit the legacy code took for an order that is still open:
//   (a) out_for_delivery orders: every order line, unless the dispatch came through deliveryService
//   (b) open COD checkout-form orders that are confirmed or later: the package line (the creation decrement).
//       An order still in pending_confirmation (or payment_pending / payment_failed) is not put back: stale unpaid
//       checkouts would inflate stock. The statuses that count are CHECKOUT_RESTORE_STATUSES below.
// "Before" per product = Product.stockQuantity + all AgentStock.quantity + (a) + (b).
// "After" per product = sum of all StockLevel rows + units of open in_transit transfers. They must be equal.
// AgentStock.totalInTransit is NOT used (it drifts and is negative in places); it is printed as information only.
// AgentStock is never written.
// After the sum check the script rebuilds Product.stockQuantity from the levels (stockService.rebuildCache), so the cache
// is the sum of on-hand over the locations. The report prints the cache before and after per product.

const CLOSED: OrderStatus[] = ['delivered', 'digital_delivered', 'cancelled', 'returned'];
/** Open statuses from confirmed on (order state machine). Only these get the (b) put-back. */
const CHECKOUT_RESTORE_STATUSES: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'failed_delivery'];
const KASAPA = 'Kasapa Express';
const NOTE_A = 'Migration: stock moved from out-for-delivery to delivery';
const NOTE_B = 'Migration: checkout decrement moved to delivery';
const NOTE_OPEN = 'Migration: opening balance';

interface MigrateOptions {
  dryRun: boolean;
  defaultLocation: string;
  log?: (line: string) => void;
  /** Test seam: runs inside the transaction after the writes, before the sums are checked. */
  beforeVerify?: (tx: TransactionClient, tenantId: string) => Promise<void>;
}

interface ProductRow {
  productId: number;
  name: string;
  warehouse: number;
  agents: number;
  correctionA: number;
  correctionB: number;
  before: number;
  after: number;
  difference: number;
  inTransitCounter: number;
  /** Product.stockQuantity after the rebuild (before it was the old warehouse number). */
  cacheAfter: number;
}

interface TenantReport {
  tenantId: string;
  alreadyMigrated: boolean;
  ok: boolean;
  linked3pl: Array<{ location: string; user: string | null; setCompany: boolean }>;
  locations: string[];
  rows: ProductRow[];
  ordersA: number;
  ordersB: number;
  /** (b) units by the status the order is in now. */
  unitsBByStatus: Record<string, number>;
  unitsA: Map<number, number>;
  unitsB: Map<number, number>;
  skippedDeliveryDispatch: number;
  oldTransfersToUpdate: number;
  estimateDeliveredDoubleDecrement: number;
  /** What the run does (dry run) or did to admin products:update_stock on the stored permissions. */
  adminUpdateStock: 'granted' | 'already there' | 'no stored list';
}

type Loc = { key: string; name: string; type: 'partner_3pl' | 'agent' | 'in_transit'; userId: number | null; id?: number; needsLink?: boolean; setCompany?: boolean };

const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export async function migrateTenant(tenantId: string, opts: MigrateOptions): Promise<TenantReport> {
  return runInTenant(tenantId, () => withSoftDeleted(() => migrateInContext(tenantId, opts)));
}

async function migrateInContext(tenantId: string, opts: MigrateOptions): Promise<TenantReport> {
  const [products, agentStocks, users, existingLocs, levelCount] = await Promise.all([
    prisma.product.findMany({ select: { id: true, name: true, stockQuantity: true } }),
    prisma.agentStock.findMany({ select: { agentId: true, productId: true, quantity: true, totalInTransit: true } }),
    prisma.user.findMany({ where: { role: 'delivery_agent' }, select: { id: true, firstName: true, lastName: true, isActive: true, kind: true } }),
    prisma.stockLocation.findMany(),
    prisma.stockLevel.count(),
  ]);
  const alreadyMigrated = levelCount > 0;

  // ---- Orders that still hold legacy stock ----
  const openOrders = await prisma.order.findMany({
    where: { deletedAt: null, status: { notIn: CLOSED } },
    select: {
      id: true, status: true, source: true, paymentProvider: true, deliveryAgentId: true,
      orderItems: { select: { productId: true, quantity: true, itemType: true } },
      formSubmissions: { select: { id: true }, take: 1 },
    },
  });
  const ofd = openOrders.filter((o) => o.status === 'out_for_delivery');
  const viaDelivery = new Set<number>();
  if (ofd.length) {
    const hist = await prisma.orderHistory.findMany({
      where: { orderId: { in: ofd.map((o) => o.id) }, status: 'out_for_delivery' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { orderId: true, metadata: true },
    });
    const latest = new Map<number, unknown>();
    for (const h of hist) latest.set(h.orderId, h.metadata);
    for (const [orderId, meta] of latest) {
      if (meta && typeof meta === 'object' && (meta as Record<string, unknown>).deliveryId != null) viaDelivery.add(orderId);
    }
  }
  type Correction = { orderId: number; holderUserId: number | null; productId: number; quantity: number; note: string };
  const corrections: Correction[] = [];
  /** Adds the corrections of one kind; returns its order count, units per product and units by the order's status now. */
  const orderSet = (orders: typeof openOrders, note: string, pick: (o: (typeof openOrders)[number]) => Array<{ productId: number; quantity: number }>) => {
    const ids = new Set<number>();
    const units = new Map<number, number>();
    const byStatus: Record<string, number> = {};
    for (const o of orders) {
      const perProduct = new Map<number, number>();
      for (const l of pick(o)) add(perProduct, l.productId, l.quantity);
      for (const [productId, quantity] of perProduct) {
        if (quantity <= 0) continue;
        corrections.push({ orderId: o.id, holderUserId: o.deliveryAgentId, productId, quantity, note });
        add(units, productId, quantity);
        byStatus[o.status] = (byStatus[o.status] ?? 0) + quantity;
      }
      if (perProduct.size) ids.add(o.id);
    }
    return { orders: ids.size, units, byStatus };
  };
  const kindA = orderSet(ofd.filter((o) => !viaDelivery.has(o.id)), NOTE_A, (o) => o.orderItems);
  const kindB = orderSet(
    openOrders.filter((o) => CHECKOUT_RESTORE_STATUSES.includes(o.status) && o.source === 'checkout_form' && o.paymentProvider == null && o.formSubmissions.length > 0),
    NOTE_B, (o) => o.orderItems.filter((i) => i.itemType === 'package'));
  const unitsA = kindA.units;
  const unitsB = kindB.units;

  // Delivered COD checkout orders were lowered at creation and again at delivery. Printed as a note, never changed.
  const deliveredPublic = await prisma.orderItem.aggregate({
    _sum: { quantity: true },
    where: { itemType: 'package', order: { tenantId, status: 'delivered', source: 'checkout_form', paymentProvider: null, deletedAt: null, formSubmissions: { some: {} } } },
  });

  // ---- Locations ----
  const userById = new Map(users.map((u) => [u.id, u]));
  const locByName = new Map(existingLocs.map((l) => [l.name, l]));
  const locByUser = new Map(existingLocs.filter((l) => l.userId != null).map((l) => [l.userId as number, l]));
  const locs: Loc[] = [];
  const keyOfUser = new Map<number, string>();
  const threePl: Array<{ location: string; user: string | null; setCompany: boolean }> = [];
  for (const name of [...new Set([opts.defaultLocation, KASAPA])]) {
    const existing = locByName.get(name);
    let userId = existing?.userId ?? null;
    if (userId == null) {
      const match = users.find((u) => !keyOfUser.has(u.id) && !locByUser.has(u.id) && fullName(u).toLowerCase().startsWith(name.toLowerCase()));
      userId = match?.id ?? null;
    }
    if (userId != null) keyOfUser.set(userId, `3pl:${name}`);
    // A user the script links to a 3PL location is a company: the partners API reads the type from User.kind.
    const setCompany = existing?.userId == null && userId != null && userById.get(userId)?.kind !== 'company';
    locs.push({ key: `3pl:${name}`, name, type: 'partner_3pl', userId, id: existing?.id, needsLink: existing != null && existing.userId == null && userId != null, setCompany });
    const linked = userId != null ? userById.get(userId) : undefined;
    threePl.push({ location: name, user: linked ? `${fullName(linked)} (user ${linked.id})` : null, setCompany });
  }
  const defaultKey = `3pl:${opts.defaultLocation}`;

  const needAgent = new Set<number>();
  for (const u of users) if (!keyOfUser.has(u.id) && u.isActive) needAgent.add(u.id);
  for (const s of agentStocks) if (!keyOfUser.has(s.agentId)) needAgent.add(s.agentId);
  for (const c of corrections) if (c.holderUserId != null && !keyOfUser.has(c.holderUserId)) needAgent.add(c.holderUserId);
  const missingUsers = [...needAgent].filter((id) => !userById.has(id));
  if (missingUsers.length) {
    const more = await prisma.user.findMany({ where: { id: { in: missingUsers } }, select: { id: true, firstName: true, lastName: true, isActive: true, kind: true } });
    for (const u of more) userById.set(u.id, u);
  }
  const takenNames = new Set([...locByName.keys(), ...locs.map((l) => l.name)]);
  for (const id of [...needAgent].sort((a, b) => a - b)) {
    const u = userById.get(id);
    if (!u) continue;
    const existing = locByUser.get(id);
    let name = existing?.name ?? fullName(u);
    if (!existing && takenNames.has(name)) name = `${name} (${id})`;
    takenNames.add(name);
    locs.push({ key: `agent:${id}`, name, type: 'agent', userId: id, id: existing?.id });
    keyOfUser.set(id, `agent:${id}`);
  }
  const existingTransit = existingLocs.find((l) => l.type === 'in_transit');
  locs.push({ key: 'transit', name: existingTransit?.name ?? 'In transit', type: 'in_transit', userId: null, id: existingTransit?.id });
  const holderKey = (userId: number | null) => (userId != null ? keyOfUser.get(userId) ?? defaultKey : defaultKey);

  // ---- Levels (plan) ----
  type Level = { key: string; productId: number; base: number; extra: number };
  const levels = new Map<string, Level>();
  const bump = (key: string, productId: number, field: 'base' | 'extra', v: number) => {
    const id = `${key}|${productId}`;
    const l = levels.get(id) ?? { key, productId, base: 0, extra: 0 };
    l[field] += v;
    levels.set(id, l);
  };
  for (const p of products) if (p.stockQuantity !== 0) bump(defaultKey, p.id, 'base', p.stockQuantity);
  for (const s of agentStocks) if (s.quantity !== 0) bump(holderKey(s.agentId), s.productId, 'base', s.quantity);
  for (const c of corrections) bump(holderKey(c.holderUserId), c.productId, 'extra', c.quantity);

  // ---- Sums ----
  const openTransit = await sumInTransit(prisma);
  const warehouse = new Map(products.map((p) => [p.id, p.stockQuantity]));
  const agentQty = new Map<number, number>();
  const counter = new Map<number, number>();
  for (const s of agentStocks) { add(agentQty, s.productId, s.quantity); add(counter, s.productId, s.totalInTransit); }
  const planned = new Map<number, number>();
  for (const l of levels.values()) add(planned, l.productId, l.base + l.extra);

  const oldTransfersToUpdate = await prisma.inventoryTransfer.count({ where: { fromLocationId: null, toLocationId: null } });
  const buildRows = (afterOf: (productId: number) => number): ProductRow[] => products.map((p) => {
    const w = warehouse.get(p.id) ?? 0;
    const a = agentQty.get(p.id) ?? 0;
    const ca = unitsA.get(p.id) ?? 0;
    const cb = unitsB.get(p.id) ?? 0;
    const before = w + a + ca + cb;
    const after = afterOf(p.id);
    return { productId: p.id, name: p.name, warehouse: w, agents: a, correctionA: ca, correctionB: cb, before, after, difference: after - before, inTransitCounter: counter.get(p.id) ?? 0, cacheAfter: planned.get(p.id) ?? 0 };
  }).filter((r) => r.before !== 0 || r.after !== 0 || r.inTransitCounter !== 0);

  const report: TenantReport = {
    tenantId, alreadyMigrated, ok: true, linked3pl: threePl, locations: locs.map((l) => `${l.name} [${l.type}${l.id ? '' : ', new'}]`),
    rows: [], ordersA: kindA.orders, ordersB: kindB.orders, unitsBByStatus: kindB.byStatus, unitsA, unitsB, skippedDeliveryDispatch: viaDelivery.size, oldTransfersToUpdate,
    estimateDeliveredDoubleDecrement: deliveredPublic._sum.quantity ?? 0,
    adminUpdateStock: await grantAdminUpdateStock(tenantId, prisma, true),
  };

  if (alreadyMigrated) {
    // A tenant migrated before the grant existed still gets it on a re-run.
    if (!opts.dryRun) await grantAdminUpdateStock(tenantId);
    return report;
  }

  report.rows = buildRows((id) => (planned.get(id) ?? 0) + (openTransit.get(id) ?? 0));
  if (report.rows.some((r) => r.difference !== 0)) report.ok = false;
  if (opts.dryRun || !report.ok) return report;

  // ---- Write, check the sums in the same transaction, roll back on any difference ----
  const verifyBefore = new Map(report.rows.map((r) => [r.productId, r.before]));
  await prisma.$transaction(async (tx) => {
    const systemUserId = await getSystemUserId(tenantId);
    const idOf = new Map<string, number>();
    for (const l of locs) {
      if (l.setCompany) await tx.user.update({ where: { id: l.userId! }, data: { kind: 'company' } });
      if (l.id) {
        idOf.set(l.key, l.id);
        if (l.needsLink) await tx.stockLocation.update({ where: { id: l.id }, data: { userId: l.userId } });
      } else {
        const created = await tx.stockLocation.create({ data: { tenantId, type: l.type, name: l.name, userId: l.userId } });
        idOf.set(l.key, created.id);
      }
    }
    const levelRows = [...levels.values()].filter((l) => l.base + l.extra !== 0);
    await tx.stockLevel.createMany({
      data: levelRows.map((l) => ({ tenantId, locationId: idOf.get(l.key)!, productId: l.productId, quantity: l.base + l.extra })),
    });
    const movement = (productId: number, quantity: number, toLocationId: number, notes: string, extra: Partial<Prisma.InventoryTransferUncheckedCreateInput> = {}) => ({
      tenantId, productId, quantity, transferType: 'opening' as const, toLocationId, notes, createdById: systemUserId, status: 'received' as const, ...extra,
    });
    await tx.inventoryTransfer.createMany({
      data: [
        ...levelRows.filter((l) => l.base > 0).map((l) => movement(l.productId, l.base, idOf.get(l.key)!, NOTE_OPEN)),
        ...corrections.map((c) => movement(c.productId, c.quantity, idOf.get(holderKey(c.holderUserId))!, c.note, { transferType: 'adjustment', orderId: c.orderId })),
      ],
    });
    await backfillTransfers(tx, new Map(locs.filter((l) => l.userId != null).map((l) => [l.userId as number, idOf.get(l.key)!])), idOf.get(defaultKey));

    if (opts.beforeVerify) await opts.beforeVerify(tx, tenantId);
    const sums = await tx.stockLevel.groupBy({ by: ['productId'], _sum: { quantity: true } });
    const after = new Map<number, number>();
    for (const s of sums) add(after, s.productId, s._sum.quantity ?? 0);
    for (const [productId, quantity] of await sumInTransit(tx)) add(after, productId, quantity);
    const wrong: string[] = [];
    for (const id of new Set([...verifyBefore.keys(), ...after.keys()])) {
      const b = verifyBefore.get(id) ?? 0;
      const a = after.get(id) ?? 0;
      if (a !== b) wrong.push(`product ${id}: before ${b}, after ${a}`);
    }
    if (wrong.length) throw new Error(`Stock sums differ after the write, rolled back: ${wrong.join('; ')}`);

    await grantAdminUpdateStock(tenantId, tx);
    const cache = await rebuildCache(tx);
    for (const r of report.rows) r.cacheAfter = cache.get(r.productId) ?? r.cacheAfter;
  }, { timeout: 600_000, maxWait: 30_000 });
  return report;
}

/** Units of open in_transit transfers per product. */
async function sumInTransit(client: Pick<TransactionClient, 'inventoryTransfer'>): Promise<Map<number, number>> {
  const rows = await client.inventoryTransfer.groupBy({ by: ['productId'], where: { status: 'in_transit' }, _sum: { quantity: true } });
  return new Map(rows.map((r) => [r.productId, r._sum.quantity ?? 0]));
}

/** Old rows: from / to location from the agent ids; the warehouse side (no agent) is the default location. Status stays `received`. */
async function backfillTransfers(client: TransactionClient, locOfUser: Map<number, number>, defaultLocationId: number | undefined) {
  if (defaultLocationId == null) return;
  const pairs = await client.inventoryTransfer.groupBy({
    by: ['fromAgentId', 'toAgentId'],
    where: { fromLocationId: null, toLocationId: null },
  });
  for (const p of pairs) {
    const from = p.fromAgentId != null ? locOfUser.get(p.fromAgentId) : defaultLocationId;
    const to = p.toAgentId != null ? locOfUser.get(p.toAgentId) : defaultLocationId;
    if (from == null || to == null) continue;
    await client.inventoryTransfer.updateMany({
      where: { fromLocationId: null, toLocationId: null, fromAgentId: p.fromAgentId, toAgentId: p.toAgentId },
      data: { fromLocationId: from, toLocationId: to, status: 'received' },
    });
  }
}

function printReport(r: TenantReport, opts: MigrateOptions, log: (s: string) => void) {
  log(`\nTenant ${r.tenantId}${r.alreadyMigrated ? ' - already migrated (levels exist), nothing written' : ''}`);
  log(`  default location (old warehouse number goes here): ${opts.defaultLocation}`);
  for (const t of r.linked3pl) log(`  3PL "${t.location}" linked to user: ${t.user ?? 'none (no matching delivery agent user)'}${t.setCompany ? ' - user kind set to company' : ''}`);
  log(`  admin products:update_stock: ${r.adminUpdateStock === 'granted' && !opts.dryRun ? 'granted' : r.adminUpdateStock === 'granted' ? 'would be granted' : r.adminUpdateStock}`);
  log(`  locations: ${r.locations.join('; ')}`);
  log(`  old transfers to get from/to locations: ${r.oldTransfersToUpdate}`);
  log(`  out_for_delivery correction (a): ${r.ordersA} orders, ${[...r.unitsA].map(([p, u]) => `product ${p}: ${u}`).join(', ') || 'no units'}` +
    (r.skippedDeliveryDispatch ? ` (${r.skippedDeliveryDispatch} orders dispatched through deliveryService took no stock, not corrected)` : ''));
  log(`  checkout decrement correction (b): ${r.ordersB} orders, ${[...r.unitsB].map(([p, u]) => `product ${p}: ${u}`).join(', ') || 'no units'}`);
  log(`    (b) units by order status now: ${JSON.stringify(r.unitsBByStatus)}`);
  log(`  note: ${r.estimateDeliveredDoubleDecrement} package units on delivered COD checkout orders were lowered at creation and again at delivery (upper bound of historic drift; not changed, the stock count fixes it)`);
  if (r.alreadyMigrated) return;
  log('  product | warehouse | agents | (a) | (b) | before | after | difference | totalInTransit counter (info only) | warehouse (cache before) -> cache after');
  for (const x of r.rows) log(`  ${x.productId} ${x.name} | ${x.warehouse} | ${x.agents} | ${x.correctionA} | ${x.correctionB} | ${x.before} | ${x.after} | ${x.difference} | ${x.inTransitCounter} | ${x.warehouse} -> ${x.cacheAfter}`);
  log(r.ok ? '  sums equal' : '  SUMS DIFFER');
}

async function main() {
  if (!assertNotProduction()) return;
  const opts: MigrateOptions = { dryRun: hasFlag('--dry-run'), defaultLocation: option('--default-location') ?? 'Logiswift' };
  const only = option('--tenant');
  const tenants = (await prismaBase.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).filter((t) => !only || t.id === only);
  console.log(opts.dryRun ? 'DRY RUN: nothing is written' : 'REAL RUN');
  let failed = false;
  for (const t of tenants) {
    try {
      const report = await migrateTenant(t.id, opts);
      printReport(report, opts, console.log);
      if (!report.ok) failed = true;
    } catch (e) {
      failed = true;
      console.error(`Tenant ${t.id}: ${(e as Error).message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prismaBase.$disconnect());
}
