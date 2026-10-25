/**
 * M4-T09 / M4-T10 (F-654, F-655, F-651): transfers and adjustments through the routes. Every state move, the 403 and 400
 * cases, the old write routes (404) and old GET routes (answer), and a second tenant that must never see the first one's stock.
 * Two throwaway tenants on the test DB.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { cacheOf, levelAt, stockUp } from './helpers/stock';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(),
  hasSocketInstance: jest.fn(() => true),
}));

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let tenantId: string;
let otherTenantId: string;
const U: Record<string, { id: number; token: string }> = {};
let copybook: number;
let ebook: number;
let store: number;
let swift: number;
let kofi: number;
let esi: number;
let idle: number;
let otherStore: number;
let otherProduct: number;
let otherOwner: { id: number; token: string };

const mkUser = async (label: string, role: any, extra: Record<string, unknown> = {}) => {
  const u = await prismaBase.user.create({
    data: { email: `tr-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId, ...extra },
  });
  U[label] = { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
  return u;
};
const location = (name: string, type: any, userId?: number, extra: Record<string, unknown> = {}) =>
  prismaBase.stockLocation.create({ data: { tenantId, name, type, userId, ...extra } }).then((l) => l.id);

const post = (who: string, path: string, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/inventory${path}`).set(bearer(U[who].token)).send(body);
const allocate = (who: string, to: number, quantity: number, extra: Record<string, unknown> = {}) =>
  post(who, '/transfers', { type: 'allocation', productId: copybook, quantity, fromLocationId: swift, toLocationId: to, ...extra });
const level = (locationId: number, productId = copybook) => levelAt(locationId, productId);
const cache = (id = copybook) => cacheOf(id);
/** On hand over every physical location of the tenant (what the cache holds). */
const total = async () => (await prismaBase.stockLevel.aggregate({
  _sum: { quantity: true }, where: { tenantId, productId: copybook, location: { isActive: true, type: { not: 'in_transit' } } },
}))._sum.quantity ?? 0;

beforeAll(async () => {
  tenantId = (await createTenant('Transfers Api')).id;
  otherTenantId = (await createTenant('Transfers Api Other')).id;
  await mkUser('owner', 'super_admin');
  await mkUser('keeper', 'inventory_manager');
  await mkUser('admin', 'admin');
  await mkUser('manager', 'manager');
  await mkUser('rep', 'sales_rep');
  const swiftUser = await mkUser('swift', 'delivery_agent', { kind: 'company' });
  const kofiUser = await mkUser('kofi', 'delivery_agent');
  const esiUser = await mkUser('esi', 'delivery_agent');
  const idleUser = await mkUser('idle', 'delivery_agent', { isActive: false });
  const product = (sku: string, extra: Record<string, unknown> = {}) =>
    prismaBase.product.create({ data: { sku: `TR-${sku}-${SUFFIX}`, name: sku, category: 'x', price: 50, cogs: 10, stockQuantity: 0, tenantId, ...extra } }).then((p) => p.id);
  copybook = await product('Copybook');
  ebook = await product('Ebook', { productType: 'digital' });
  store = await location('Own store', 'own_store');
  swift = await location('Swift', 'partner_3pl', swiftUser.id);
  kofi = await location('Kofi', 'agent', kofiUser.id);
  esi = await location('Esi', 'agent', esiUser.id);
  idle = await location('Idle', 'agent', idleUser.id);
  await stockUp(tenantId, copybook, 1000, { locationId: swift });

  const other = await prismaBase.user.create({ data: { email: `tr-other-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Other', lastName: 'Owner', role: 'super_admin', tenantId: otherTenantId } });
  otherOwner = { id: other.id, token: generateAccessToken({ id: other.id, email: other.email, role: 'super_admin', tenantId: otherTenantId }) };
  otherStore = (await prismaBase.stockLocation.create({ data: { tenantId: otherTenantId, name: 'Other store', type: 'own_store' } })).id;
  otherProduct = (await prismaBase.product.create({ data: { sku: `TR-OTHER-${SUFFIX}`, name: 'Other copybook', category: 'x', price: 5, stockQuantity: 0, tenantId: otherTenantId } })).id;
  await stockUp(otherTenantId, otherProduct, 40, { locationId: otherStore });
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('POST /api/inventory/transfers (create)', () => {
  it('an allocation lowers the source at once, waits in transit, tells the agent and leaves an audit row', async () => {
    const res = await allocate('owner', kofi, 20, { note: 'Monday round' });
    expect(res.status).toBe(201);
    expect(res.body.transfer).toMatchObject({
      status: 'in_transit', transferType: 'allocation', quantity: 20, notes: 'Monday round', overdue: false, shortQuantity: 0,
      fromLocation: { name: 'Swift' }, toLocation: { name: 'Kofi' }, product: { name: 'Copybook' },
    });
    expect([await level(swift), await level(kofi), await cache()]).toEqual([980, 0, 980]);
    const note = await prismaBase.notification.findFirstOrThrow({ where: { tenantId, userId: U.kofi.id, type: 'stock' } });
    expect(note.message).toBe('20 Copybook are waiting for you');
    expect(await prismaBase.auditLog.count({ where: { tenantId, resource: 'inventory_transfer', resourceId: String(res.body.transfer.id), action: 'create', userId: U.owner.id } })).toBe(1);
  });

  it('a stock keeper may create; a manager, a rep and an agent may not; no token is 401', async () => {
    expect((await allocate('keeper', esi, 1)).status).toBe(201);
    for (const who of ['manager', 'rep', 'kofi']) expect((await allocate(who, esi, 1)).status).toBe(403);
    expect((await request(app).post('/api/inventory/transfers').send({})).status).toBe(401);
  });

  it('refuses more than the source holds, with the number', async () => {
    const before = await level(swift);
    const res = await allocate('owner', esi, before + 1);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`Only ${before} available at Swift`);
    expect(await level(swift)).toBe(before);
  });

  it('400 for a bad body: type, quantity, ids, reason', async () => {
    const base = { type: 'allocation', productId: copybook, quantity: 1, fromLocationId: swift, toLocationId: esi };
    for (const bad of [{ type: 'adjustment' }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 'x' }, { productId: 'a' }, { toLocationId: 0 }, { reason: 'bored' }]) {
      expect((await post('owner', '/transfers', { ...base, ...bad })).status).toBe(400);
    }
  });

  it('refuses the same location, an inactive one, an inactive person, a digital product, and wrong location types', async () => {
    expect((await allocate('owner', swift, 1)).body.error).toBe('Cannot transfer to the same location');
    await prismaBase.stockLocation.update({ where: { id: store }, data: { isActive: false } });
    expect((await allocate('owner', store, 1)).status).toBe(400);
    await prismaBase.stockLocation.update({ where: { id: store }, data: { isActive: true } });
    expect((await allocate('owner', idle, 1)).status).toBe(400);
    expect((await post('owner', '/transfers', { type: 'allocation', productId: ebook, quantity: 1, fromLocationId: swift, toLocationId: esi })).status).toBe(400);
    expect((await post('owner', '/transfers', { type: 'agent_transfer', productId: copybook, quantity: 1, fromLocationId: swift, toLocationId: esi })).status).toBe(400);
    expect((await post('owner', '/transfers', { type: 'allocation', productId: copybook, quantity: 1, fromLocationId: kofi, toLocationId: esi })).status).toBe(400);
    const transit = await location('In transit', 'in_transit');
    expect((await allocate('owner', transit, 1)).status).toBe(400);
  });

  it('404 for a product or location that does not exist', async () => {
    expect((await post('owner', '/transfers', { type: 'allocation', productId: 999999, quantity: 1, fromLocationId: swift, toLocationId: esi })).status).toBe(404);
    expect((await allocate('owner', 999999, 1)).status).toBe(404);
  });
});

describe('admin role (F-654: owner, admin and stock keeper write stock)', () => {
  it('an admin can create a transfer and adjust; a manager gets 403 on both', async () => {
    const spare = await location('Admin spare', 'agent');
    const made = await allocate('admin', spare, 1);
    expect(made.status).toBe(201);
    await post('admin', `/transfers/${made.body.transfer.id}/cancel`);
    const now = await level(spare);
    expect((await post('admin', '/adjust', { locationId: spare, productId: copybook, newQuantity: now + 1, reason: 'found_extra_stock' })).status).toBe(200);
    expect((await allocate('manager', spare, 1)).status).toBe(403);
    expect((await post('manager', '/adjust', { locationId: spare, productId: copybook, newQuantity: now + 5, reason: 'found_extra_stock' })).status).toBe(403);
  });
});

describe('POST /api/inventory/transfers/:id/receive', () => {
  it('the agent confirms the full count: received, destination up, sums balance', async () => {
    const before = await total();
    const created = (await allocate('owner', kofi, 10)).body.transfer;
    expect(await total()).toBe(before - 10);
    const res = await post('kofi', `/transfers/${created.id}/receive`);
    expect(res.status).toBe(200);
    expect(res.body.transfer).toMatchObject({ status: 'received', receivedQuantity: 10, receivedById: U.kofi.id, shortQuantity: 0 });
    expect(await total()).toBe(before);
    expect(await level(kofi)).toBe(10);
    expect(await cache()).toBe(await total());
  });

  it('another agent cannot confirm it (403) and the transfer stays in transit', async () => {
    const created = (await allocate('owner', kofi, 2)).body.transfer;
    const res = await post('esi', `/transfers/${created.id}/receive`);
    expect(res.status).toBe(403);
    expect((await prismaBase.inventoryTransfer.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('in_transit');
    expect((await post('rep', `/transfers/${created.id}/receive`)).status).toBe(403);
    expect((await post('manager', `/transfers/${created.id}/receive`)).status).toBe(403);
    await post('owner', `/transfers/${created.id}/cancel`);
  });

  it('the owner or a stock keeper confirms for a 3PL or an own store, with an audit row that says so', async () => {
    const back = (await post('owner', '/transfers', { type: 'return_to_warehouse', productId: copybook, quantity: 5, fromLocationId: kofi, toLocationId: store, reason: 'failed_deliveries' })).body.transfer;
    expect(back.status).toBe('in_transit');
    const res = await post('keeper', `/transfers/${back.id}/receive`, { quantity: 5 });
    expect(res.status).toBe(200);
    expect(await level(store)).toBe(5);
    const row = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId, resource: 'inventory_transfer', resourceId: String(back.id), action: 'receive' } });
    expect(row).toMatchObject({ userId: U.keeper.id });
    expect(row.metadata).toMatchObject({ onBehalf: true, quantityReceived: 5, locationId: store });
  });

  it('below the sent quantity needs a reason and makes the transfer disputed; above is refused', async () => {
    const before = await total();
    const created = (await allocate('owner', esi, 20)).body.transfer;
    expect((await post('esi', `/transfers/${created.id}/receive`, { quantity: 18 })).status).toBe(400);
    expect((await post('esi', `/transfers/${created.id}/receive`, { quantity: 18, reason: 'bored' })).status).toBe(400);
    expect((await post('esi', `/transfers/${created.id}/receive`, { quantity: 21, reason: 'damaged' })).status).toBe(400);
    expect((await post('esi', `/transfers/${created.id}/receive`, { quantity: -1 })).status).toBe(400);
    expect((await prismaBase.inventoryTransfer.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('in_transit');
    const res = await post('esi', `/transfers/${created.id}/receive`, { quantity: 18, reason: 'short_in_package' });
    expect(res.status).toBe(200);
    expect(res.body.transfer).toMatchObject({ status: 'disputed', receivedQuantity: 18, reason: 'short_in_package', shortQuantity: 2 });
    expect(await level(esi)).toBe(18);
    expect(await total()).toBe(before - 2); // the 2 short units stay in transit
    expect(await cache()).toBe(await total());
    expect((await post('esi', `/transfers/${created.id}/receive`)).status).toBe(409); // already settled
  });

  it('a count of 0 is a dispute with no level change', async () => {
    const before = await level(esi);
    const created = (await allocate('owner', esi, 3)).body.transfer;
    const res = await post('owner', `/transfers/${created.id}/receive`, { quantity: 0, reason: 'not_received' });
    expect(res.body.transfer).toMatchObject({ status: 'disputed', receivedQuantity: 0, shortQuantity: 3 });
    expect(await level(esi)).toBe(before);
  });

  it('an in-transit transfer older than 3 days carries the Overdue tag, a younger one does not, and a disputed one never does', async () => {
    const old = (await allocate('owner', esi, 1)).body.transfer;
    const young = (await allocate('owner', esi, 1)).body.transfer;
    await prismaBase.inventoryTransfer.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000) } });
    await prismaBase.inventoryTransfer.update({ where: { id: young.id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) } });
    const listed = (await request(app).get('/api/inventory/transfers?status=in_transit&limit=100').set(bearer(U.owner.token))).body.transfers as Array<{ id: number; overdue: boolean }>;
    expect(listed.find((t) => t.id === old.id)?.overdue).toBe(true);
    expect(listed.find((t) => t.id === young.id)?.overdue).toBe(false);
    // A dispute waits for the owner's resolve; it is not late in transit
    const disputed = (await post('owner', `/transfers/${old.id}/receive`, { quantity: 0, reason: 'not_received' })).body.transfer;
    expect([disputed.status, disputed.overdue]).toEqual(['disputed', false]);
  });

  it('two receipts at once: one wins and the destination is credited once', async () => {
    const before = await level(esi);
    const created = (await allocate('owner', esi, 4)).body.transfer;
    const [a, b] = await Promise.all([post('esi', `/transfers/${created.id}/receive`), post('owner', `/transfers/${created.id}/receive`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await level(esi)).toBe(before + 4);
  });

  it('400 for a bad id, 404 for an unknown transfer', async () => {
    expect((await post('owner', '/transfers/abc/receive')).status).toBe(400);
    expect((await post('owner', '/transfers/999999/receive')).status).toBe(404);
  });
});

describe('POST /api/inventory/transfers/:id/resolve', () => {
  const dispute = async (to: number, sent: number, got: number) => {
    const t = (await allocate('owner', to, sent)).body.transfer;
    await post('owner', `/transfers/${t.id}/receive`, { quantity: got, reason: 'short_in_package' });
    return t.id as number;
  };

  it('return to source puts the short units back, closes the dispute as received and the sums balance', async () => {
    const before = await total();
    const id = await dispute(esi, 20, 18);
    expect(await total()).toBe(before - 2);
    const res = await post('owner', `/transfers/${id}/resolve`, { action: 'return_to_source', note: 'Counted again' });
    expect(res.status).toBe(200);
    expect(res.body.transfer.status).toBe('received');
    expect(await total()).toBe(before);
    expect(await cache()).toBe(before);
    expect(await prismaBase.auditLog.count({ where: { tenantId, resourceId: String(id), action: 'resolve' } })).toBe(1);
  });

  it('write off records an adjustment with the reason and a Finding for the cost, and closes the dispute', async () => {
    const before = await total();
    const id = await dispute(esi, 10, 7);
    const res = await post('keeper', `/transfers/${id}/resolve`, { action: 'write_off', note: 'Lost on the bus' });
    expect(res.status).toBe(200);
    expect(res.body.transfer.status).toBe('received');
    expect(await total()).toBe(before - 3); // 3 units are gone for good
    const movement = await prismaBase.inventoryTransfer.findFirstOrThrow({ where: { tenantId, transferType: 'adjustment', notes: { contains: `transfer ${id}` } } });
    expect(movement).toMatchObject({ quantity: 3, reason: 'short_in_package', fromLocationId: swift, status: 'received' });
    const finding = await prismaBase.finding.findFirstOrThrow({ where: { tenantId, type: 'stock_gap', subjectType: 'inventory_transfer', subjectId: String(id) } });
    expect(Number(finding.amount)).toBe(30);
    expect(await cache()).toBe(await total());
  });

  it('only a disputed transfer can be resolved (409); a bad action is 400; a rep is 403', async () => {
    const t = (await allocate('owner', esi, 1)).body.transfer;
    expect((await post('owner', `/transfers/${t.id}/resolve`, { action: 'write_off' })).status).toBe(409);
    expect((await post('owner', `/transfers/${t.id}/resolve`, { action: 'burn' })).status).toBe(400);
    expect((await post('rep', `/transfers/${t.id}/resolve`, { action: 'write_off' })).status).toBe(403);
    await post('owner', `/transfers/${t.id}/cancel`);
  });

  it('units a 3PL says it sent back that never arrived cannot go back to the 3PL; write-off still works', async () => {
    const back = (await post('owner', '/transfers', { type: 'return_to_warehouse', productId: copybook, quantity: 6, fromLocationId: swift, toLocationId: store, reason: 'customer_refused' })).body.transfer;
    await post('owner', `/transfers/${back.id}/receive`, { quantity: 4, reason: 'not_received' });
    const swiftBefore = await level(swift);
    const refused = await post('owner', `/transfers/${back.id}/resolve`, { action: 'return_to_source' });
    expect(refused.status).toBe(400);
    expect(await level(swift)).toBe(swiftBefore);
    const res = await post('owner', `/transfers/${back.id}/resolve`, { action: 'write_off' });
    expect(res.status).toBe(200);
    expect(res.body.transfer.status).toBe('received');
  });
});

describe('POST /api/inventory/transfers/:id/cancel', () => {
  it('returns the units to the source and ends cancelled; it cannot run twice or on a received transfer', async () => {
    const before = await total();
    const made = await allocate('owner', kofi, 7);
    expect([made.status, made.body.error]).toEqual([201, undefined]);
    const t = made.body.transfer;
    expect(await total()).toBe(before - 7);
    const res = await post('keeper', `/transfers/${t.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.transfer.status).toBe('cancelled');
    expect(await total()).toBe(before);
    expect(await cache()).toBe(before);
    expect((await post('owner', `/transfers/${t.id}/cancel`)).status).toBe(409);
    const done = (await allocate('owner', kofi, 1)).body.transfer;
    await post('kofi', `/transfers/${done.id}/receive`);
    expect((await post('owner', `/transfers/${done.id}/cancel`)).status).toBe(409);
  });

  it('an agent and a manager cannot cancel (403)', async () => {
    const t = (await allocate('owner', esi, 1)).body.transfer;
    expect((await post('esi', `/transfers/${t.id}/cancel`)).status).toBe(403);
    expect((await post('manager', `/transfers/${t.id}/cancel`)).status).toBe(403);
    await post('owner', `/transfers/${t.id}/cancel`);
  });
});

describe('concurrent creates', () => {
  it('two transfers cannot send more than the source holds', async () => {
    const source = await location('Small store', 'partner_3pl');
    await stockUp(tenantId, copybook, 10, { locationId: source });
    const send = () => post('owner', '/transfers', { type: 'allocation', productId: copybook, quantity: 7, fromLocationId: source, toLocationId: esi });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await level(source)).toBe(3);
  });
});

describe('POST /api/inventory/adjust', () => {
  const adjust = (who: string, body: Record<string, unknown>) => post(who, '/adjust', { locationId: kofi, productId: copybook, reason: 'physical_count_correction', ...body });

  it('sets the quantity down: one adjustment movement with the reason and who, level and cache follow', async () => {
    const now = await level(kofi);
    const res = await adjust('keeper', { newQuantity: now - 2, note: 'Counted with Kofi' });
    expect(res.status).toBe(200);
    expect(res.body.adjustment).toMatchObject({ previousQuantity: now, newQuantity: now - 2 });
    expect(res.body.adjustment.movement).toMatchObject({ transferType: 'adjustment', quantity: 2, reason: 'physical_count_correction', fromLocation: { name: 'Kofi' }, createdBy: { id: U.keeper.id } });
    expect(await level(kofi)).toBe(now - 2);
    expect(await cache()).toBe(await total());
    expect(await prismaBase.auditLog.count({ where: { tenantId, action: 'adjust', userId: U.keeper.id } })).toBeGreaterThan(0);
  });

  it('sets the quantity up, and to 0', async () => {
    const now = await level(kofi);
    const up = await adjust('owner', { newQuantity: now + 5, reason: 'found_extra_stock' });
    expect(up.body.adjustment.movement).toMatchObject({ quantity: 5, toLocation: { name: 'Kofi' }, fromLocation: null });
    expect(await level(kofi)).toBe(now + 5);
    expect((await adjust('owner', { newQuantity: 0, reason: 'lost_or_stolen' })).status).toBe(200);
    expect(await level(kofi)).toBe(0);
  });

  it('warns when stock is on its way to the location', async () => {
    const fresh = await location('Warn', 'agent');
    const t = (await allocate('owner', fresh, 3)).body.transfer;
    const res = await adjust('owner', { locationId: fresh, newQuantity: 4 });
    expect(res.body.adjustment.warning).toBe('3 units are on their way to this location');
    await post('owner', `/transfers/${t.id}/cancel`);
  });

  it('400: no change, below 0, a note-less Other, a bad reason, a bad id; 404 for unknown rows; 403 for a manager', async () => {
    const now = await level(kofi);
    expect((await adjust('owner', { newQuantity: now })).body.error).toBe('No change');
    expect((await adjust('owner', { newQuantity: -1 })).status).toBe(400);
    expect((await adjust('owner', { newQuantity: now + 1, reason: 'other' })).status).toBe(400);
    expect((await adjust('owner', { newQuantity: now + 1, reason: 'other', note: '  ' })).status).toBe(400);
    expect((await adjust('owner', { newQuantity: now + 1, reason: 'bored' })).status).toBe(400);
    expect((await adjust('owner', { newQuantity: 1.5 })).status).toBe(400);
    expect((await adjust('owner', { newQuantity: now + 1, locationId: 'x' })).status).toBe(400);
    expect((await adjust('owner', { newQuantity: now + 1, locationId: 999999 })).status).toBe(404);
    expect((await adjust('owner', { newQuantity: now + 1, productId: 999999 })).status).toBe(404);
    expect((await adjust('owner', { newQuantity: 1, productId: ebook })).status).toBe(400);
    expect((await adjust('manager', { newQuantity: now + 1 })).status).toBe(403);
    expect((await adjust('kofi', { newQuantity: now + 1 })).status).toBe(403);
    expect((await adjust('owner', { newQuantity: now + 1, reason: 'other', note: 'Gift to a customer' })).status).toBe(200);
  });
});

describe('another tenant', () => {
  it('cannot see, receive, resolve or cancel this tenant\'s transfers (404), and its rows do not change', async () => {
    const t = (await allocate('owner', esi, 2)).body.transfer;
    const before = await prismaBase.inventoryTransfer.findUniqueOrThrow({ where: { id: t.id } });
    const swiftBefore = await level(swift);
    const other = (path: string, body: Record<string, unknown> = {}) => request(app).post(`/api/inventory${path}`).set(bearer(otherOwner.token)).send(body);
    expect((await other(`/transfers/${t.id}/receive`)).status).toBe(404);
    expect((await other(`/transfers/${t.id}/resolve`, { action: 'write_off' })).status).toBe(404);
    expect((await other(`/transfers/${t.id}/cancel`)).status).toBe(404);
    expect(await prismaBase.inventoryTransfer.findUniqueOrThrow({ where: { id: t.id } })).toEqual(before);
    expect(await level(swift)).toBe(swiftBefore);
    await post('owner', `/transfers/${t.id}/cancel`);
  });

  it('cannot use this tenant\'s locations or products to create a transfer or an adjustment (404)', async () => {
    const other = (path: string, body: Record<string, unknown>) => request(app).post(`/api/inventory${path}`).set(bearer(otherOwner.token)).send(body);
    expect((await other('/transfers', { type: 'allocation', productId: otherProduct, quantity: 1, fromLocationId: otherStore, toLocationId: kofi })).status).toBe(404);
    expect((await other('/transfers', { type: 'allocation', productId: copybook, quantity: 1, fromLocationId: otherStore, toLocationId: otherStore + 1000 })).status).toBe(404);
    expect((await other('/adjust', { locationId: swift, productId: otherProduct, newQuantity: 0, reason: 'lost_or_stolen' })).status).toBe(404);
    expect((await other('/adjust', { locationId: otherStore, productId: copybook, newQuantity: 0, reason: 'lost_or_stolen' })).status).toBe(404);
    expect(await level(otherStore, otherProduct)).toBe(40);
  });

  it('this tenant cannot touch the other tenant\'s stock', async () => {
    const res = await post('owner', '/adjust', { locationId: otherStore, productId: otherProduct, newQuantity: 0, reason: 'lost_or_stolen' });
    expect(res.status).toBe(404);
    expect(await level(otherStore, otherProduct)).toBe(40);
  });

  it('its own transfers work in its own tenant', async () => {
    const second = await prismaBase.stockLocation.create({ data: { tenantId: otherTenantId, name: 'Other 3PL', type: 'partner_3pl' } });
    const res = await request(app).post('/api/inventory/transfers').set(bearer(otherOwner.token))
      .send({ type: 'allocation', productId: otherProduct, quantity: 10, fromLocationId: otherStore, toLocationId: second.id });
    expect(res.status).toBe(201);
    expect(await level(otherStore, otherProduct)).toBe(30);
  });
});

describe('old routes (M4-T10)', () => {
  it('the old write routes are gone (404)', async () => {
    const call = (method: 'post' | 'patch', path: string) => request(app)[method](path).set(bearer(U.owner.token)).send({});
    for (const path of ['/api/agent-inventory/allocate', '/api/agent-inventory/transfer', '/api/agent-inventory/return', '/api/agent-inventory/adjust']) {
      expect((await call('post', path)).status).toBe(404);
    }
    expect((await call('patch', `/api/products/${copybook}/stock`)).status).toBe(404);
    expect((await call('patch', '/api/products/shipments/1/arrive')).status).toBe(404);
  });

  it('the old GET routes still answer', async () => {
    const get = (path: string) => request(app).get(path).set(bearer(U.owner.token));
    expect((await get('/api/agent-inventory/summary')).status).toBe(200);
    expect((await get(`/api/agent-inventory/product/${copybook}`)).status).toBe(200);
    expect((await get(`/api/agent-inventory/agent/${U.kofi.id}`)).status).toBe(200);
    expect((await get('/api/agent-inventory/transfers')).status).toBe(200);
  });
});
