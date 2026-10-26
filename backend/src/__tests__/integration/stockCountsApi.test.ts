/**
 * M4-T14 (F-653): stock counts through the routes. The worked example (200 against 188 is one Finding at cost, apply
 * with "Short on arrival" gives 188 and an explained Finding), apply twice (409), the 400 / 403 / 404 cases, and a second
 * tenant. Two throwaway tenants on the test DB.
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
let pens: number;
let ebook: number;
let swift: number;
let transit: number;
let shipmentId: number;
let otherOwner: { id: number; token: string };
let otherStore: number;
let otherProduct: number;

const mkUser = async (label: string, role: any, tenant = tenantId) => {
  const u = await prismaBase.user.create({ data: { email: `sc-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId: tenant } });
  U[label] = { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId: tenant }) };
  return u;
};
const today = () => new Date().toISOString().slice(0, 10);
const create = (who: string, body: Record<string, unknown>) => request(app).post('/api/inventory/counts').set(bearer(U[who].token)).send(body);
const count = (locationId: number, lines: Array<{ productId: number; countedQuantity: number }>, extra: Record<string, unknown> = {}) =>
  ({ locationId, countDate: today(), source: 'three_pl_dashboard', lines, ...extra });
const apply = (who: string, countId: number, lineId: number, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/inventory/counts/${countId}/lines/${lineId}/apply`).set(bearer(U[who].token)).send(body);
const findings = () => prismaBase.finding.findMany({ where: { tenantId, type: 'stock_gap', subjectType: 'stock_count_line' }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  tenantId = (await createTenant('Stock Counts Api')).id;
  otherTenantId = (await createTenant('Stock Counts Api Other')).id;
  await mkUser('owner', 'super_admin');
  await mkUser('keeper', 'inventory_manager');
  await mkUser('manager', 'manager');
  await mkUser('rep', 'sales_rep');
  await mkUser('agent', 'delivery_agent');
  const product = (sku: string, extra: Record<string, unknown> = {}) =>
    prismaBase.product.create({ data: { sku: `SC-${sku}-${SUFFIX}`, name: sku, category: 'x', price: 50, cogs: '30.2083', stockQuantity: 0, tenantId, ...extra } }).then((p) => p.id);
  copybook = await product('Copybook');
  pens = await product('Pens');
  ebook = await product('Ebook', { productType: 'digital' });
  const swiftUser = await prismaBase.user.create({ data: { email: `sc-swift-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Swift', lastName: 'T', role: 'delivery_agent', kind: 'company', tenantId } });
  swift = (await prismaBase.stockLocation.create({ data: { tenantId, name: 'Logiswift', type: 'partner_3pl', userId: swiftUser.id } })).id;
  transit = (await prismaBase.stockLocation.create({ data: { tenantId, name: 'In transit', type: 'in_transit' } })).id;
  await stockUp(tenantId, copybook, 200, { locationId: swift });
  await stockUp(tenantId, pens, 62, { locationId: swift });
  shipmentId = (await prismaBase.inventoryShipment.create({ data: { tenantId, productId: copybook, quantity: 300, createdById: U.owner.id, status: 'received' } })).id;

  await mkUser('otherOwner', 'super_admin', otherTenantId);
  otherOwner = U.otherOwner;
  otherStore = (await prismaBase.stockLocation.create({ data: { tenantId: otherTenantId, name: 'Other store', type: 'own_store' } })).id;
  otherProduct = (await prismaBase.product.create({ data: { sku: `SC-OTHER-${SUFFIX}`, name: 'Other', category: 'x', price: 5, stockQuantity: 0, tenantId: otherTenantId } })).id;
  await stockUp(otherTenantId, otherProduct, 40, { locationId: otherStore });
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

let worked: { countId: number; lineId: number; penLineId: number };

describe('worked example: Logiswift counts 188 against 200', () => {
  it('saves the count, freezes 200, opens one Finding of 12 x 30.2083 = 362.50, none for the matching line', async () => {
    const res = await create('owner', count(swift, [{ productId: copybook, countedQuantity: 188 }, { productId: pens, countedQuantity: 62 }], { note: '3PL dashboard' }));
    expect(res.status).toBe(201);
    const lines = res.body.count.lines;
    expect(lines.map((l: any) => [l.product.name, l.systemQuantity, l.countedQuantity, l.difference])).toEqual([['Copybook', 200, 188, -12], ['Pens', 62, 62, 0]]);
    expect(lines[0].finding).toMatchObject({ status: 'open', amount: '362.50' });
    expect(lines[1].finding).toBeNull();
    expect(res.body.count).toMatchObject({ source: 'three_pl_dashboard', note: '3PL dashboard', location: { name: 'Logiswift' }, countedBy: { id: U.owner.id } });
    const rows = await findings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'stock_gap', status: 'open', subjectId: String(lines[0].id) });
    expect(await levelAt(swift, copybook)).toBe(200); // a count alone changes nothing
    worked = { countId: res.body.count.id, lineId: lines[0].id, penLineId: lines[1].id };
  });

  it('apply with Short on arrival, linked to the shipment: on hand 188, Finding explained, one movement', async () => {
    const res = await apply('owner', worked.countId, worked.lineId, { reason: 'short_on_arrival', shipmentId });
    expect(res.status).toBe(200);
    expect(res.body.onHand).toBe(188);
    expect(res.body.warning).toBeUndefined();
    expect(res.body.movement).toMatchObject({ transferType: 'count_adjustment', quantity: 12, fromLocationId: swift, reason: 'short_on_arrival', shipmentId });
    expect(res.body.count.lines[0]).toMatchObject({ applied: true, finding: { status: 'explained' } });
    expect([await levelAt(swift, copybook), await cacheOf(copybook)]).toEqual([188, 188]);
    expect((await findings())[0].status).toBe('explained');
    expect(await prismaBase.auditLog.count({ where: { tenantId, resource: 'stock_count', action: 'apply', userId: U.owner.id } })).toBe(1);
  });

  it('a second apply is 409 and moves nothing', async () => {
    expect((await apply('owner', worked.countId, worked.lineId)).status).toBe(409);
    expect(await levelAt(swift, copybook)).toBe(188);
  });

  it('a line with no difference cannot be applied (400)', async () => {
    expect((await apply('owner', worked.countId, worked.penLineId)).status).toBe(400);
  });
});

describe('create', () => {
  it('a count above our records is a found gap; apply defaults to Found extra stock and adds the units', async () => {
    const res = await create('keeper', count(swift, [{ productId: pens, countedQuantity: 70 }], { source: 'own_count' }));
    expect(res.status).toBe(201);
    const line = res.body.count.lines[0];
    expect(line.difference).toBe(8);
    expect(line.finding.amount).toBe('241.67');
    const done = await apply('keeper', res.body.count.id, line.id);
    expect(done.status).toBe(200);
    expect(done.body.movement).toMatchObject({ quantity: 8, toLocationId: swift, reason: 'found_extra_stock' });
    expect(await levelAt(swift, pens)).toBe(70);
  });

  it('apply warns when stock moved after the count, and still applies the count-time difference', async () => {
    const res = await create('owner', count(swift, [{ productId: pens, countedQuantity: 60 }])); // system 70, diff -10
    await stockUp(tenantId, pens, 5, { locationId: swift }); // stock moved: 75
    const done = await apply('owner', res.body.count.id, res.body.count.lines[0].id);
    expect(done.status).toBe(200);
    expect(done.body.warning).toBe('Stock moved after this count. Check before applying.');
    expect(done.body.onHand).toBe(65);
    expect(await levelAt(swift, pens)).toBe(65);
  });

  it('keep investigating is the absence of apply: the Finding stays open and records stay', async () => {
    const before = await levelAt(swift, pens);
    const res = await create('owner', count(swift, [{ productId: pens, countedQuantity: before - 3 }]));
    expect(res.body.count.lines[0].finding.status).toBe('open');
    expect(await levelAt(swift, pens)).toBe(before);
    expect((await findings()).filter((f) => f.status === 'open')).toHaveLength(1);
  });

  it('400: future date, bad date, no lines, repeated product, negative or fractional quantity, bad source, digital product, in-transit location', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const ok = [{ productId: copybook, countedQuantity: 1 }];
    const bad: Array<Record<string, unknown>> = [
      count(swift, ok, { countDate: tomorrow }),
      count(swift, ok, { countDate: '2026-13-45' }),
      count(swift, ok, { countDate: 'yesterday' }),
      count(swift, []),
      count(swift, [...ok, ...ok]),
      count(swift, [{ productId: copybook, countedQuantity: -1 }]),
      count(swift, [{ productId: copybook, countedQuantity: 1.5 }]),
      count(swift, ok, { source: 'guess' }),
      count(swift, [{ productId: ebook, countedQuantity: 1 }]),
      count(transit, ok),
      { ...count(swift, ok), locationId: 0 },
    ];
    for (const body of bad) expect([JSON.stringify(body), (await create('owner', body)).status]).toEqual([JSON.stringify(body), 400]);
  });

  it('404 for an unknown location or product, and a failed count leaves no rows behind', async () => {
    const counts = await prismaBase.stockCount.count({ where: { tenantId } });
    expect((await create('owner', count(999_999_999, [{ productId: copybook, countedQuantity: 1 }]))).status).toBe(404);
    expect((await create('owner', count(swift, [{ productId: 999_999_999, countedQuantity: 1 }]))).status).toBe(404);
    expect(await prismaBase.stockCount.count({ where: { tenantId } })).toBe(counts);
  });

  it('403 for a manager, a rep and an agent; 401 without a token', async () => {
    for (const who of ['manager', 'rep', 'agent']) expect((await create(who, count(swift, [{ productId: copybook, countedQuantity: 1 }]))).status).toBe(403);
    expect((await request(app).post('/api/inventory/counts').send({})).status).toBe(401);
  });
});

describe('apply: 400 / 403 / 404', () => {
  let c: { countId: number; lineId: number };
  beforeAll(async () => {
    const res = await create('owner', count(swift, [{ productId: copybook, countedQuantity: 100 }]));
    c = { countId: res.body.count.id, lineId: res.body.count.lines[0].id };
  });

  it('400: bad reason, Other without a note, a shipment without Short on arrival, an unknown shipment is 404', async () => {
    expect((await apply('owner', c.countId, c.lineId, { reason: 'bored' })).status).toBe(400);
    expect((await apply('owner', c.countId, c.lineId, { reason: 'other' })).status).toBe(400);
    expect((await apply('owner', c.countId, c.lineId, { reason: 'damaged', shipmentId })).status).toBe(400);
    expect((await apply('owner', c.countId, c.lineId, { reason: 'short_on_arrival', shipmentId: 999_999_999 })).status).toBe(404);
    expect(await levelAt(swift, copybook)).toBe(188);
  });

  it('403 for a manager; 404 for an unknown count, an unknown line, and a line of another count', async () => {
    expect((await apply('manager', c.countId, c.lineId)).status).toBe(403);
    expect((await apply('owner', 999_999_999, c.lineId)).status).toBe(404);
    expect((await apply('owner', c.countId, 999_999_999)).status).toBe(404);
    expect((await apply('owner', c.countId, worked.lineId)).status).toBe(404);
  });

  it('Other with a note applies', async () => {
    const res = await apply('owner', c.countId, c.lineId, { reason: 'other', note: 'Water damage' });
    expect(res.status).toBe(200);
    expect(res.body.movement).toMatchObject({ reason: 'other', notes: 'Water damage' });
    expect(await levelAt(swift, copybook)).toBe(100);
  });
});

describe('GET', () => {
  it('lists newest first, filters by location, paginates; the manager reads, a rep and an agent cannot', async () => {
    const all = await request(app).get('/api/inventory/counts').set(bearer(U.manager.token));
    expect(all.status).toBe(200);
    expect(all.body.pagination).toMatchObject({ page: 1, limit: 20 });
    expect(all.body.counts[0].lines.length).toBeGreaterThan(0);
    const ids = all.body.counts.map((x: any) => x.id);
    expect(ids).toEqual([...ids].sort((a: number, b: number) => b - a));
    const filtered = await request(app).get(`/api/inventory/counts?locationId=${swift}&limit=1&page=2`).set(bearer(U.owner.token));
    expect(filtered.body.counts).toHaveLength(1);
    expect(filtered.body.pagination.total).toBe(all.body.pagination.total);
    const none = await request(app).get(`/api/inventory/counts?locationId=${transit}`).set(bearer(U.owner.token));
    expect(none.body.counts).toEqual([]);
    for (const who of ['rep', 'agent']) expect((await request(app).get('/api/inventory/counts').set(bearer(U[who].token))).status).toBe(403);
    expect((await request(app).get('/api/inventory/counts?locationId=abc').set(bearer(U.owner.token))).status).toBe(400);
  });

  it('GET /:id returns the count with its lines and Findings; unknown is 404; bad id is 400', async () => {
    const res = await request(app).get(`/api/inventory/counts/${worked.countId}`).set(bearer(U.manager.token));
    expect(res.status).toBe(200);
    expect(res.body.count.lines[0]).toMatchObject({ difference: -12, applied: true, finding: { status: 'explained', amount: '362.50' } });
    expect((await request(app).get('/api/inventory/counts/999999999').set(bearer(U.owner.token))).status).toBe(404);
    expect((await request(app).get('/api/inventory/counts/abc').set(bearer(U.owner.token))).status).toBe(400);
  });
});

describe('another tenant', () => {
  it('never sees or touches the first tenant counts, locations or products', async () => {
    const asOther = (m: 'get' | 'post', path: string, body: Record<string, unknown> = {}) => request(app)[m](`/api/inventory${path}`).set(bearer(otherOwner.token)).send(body);
    expect((await asOther('get', `/counts/${worked.countId}`)).status).toBe(404);
    expect((await asOther('post', `/counts/${worked.countId}/lines/${worked.lineId}/apply`)).status).toBe(404);
    expect((await asOther('get', '/counts')).body.counts).toEqual([]);
    expect((await asOther('post', '/counts', count(swift, [{ productId: otherProduct, countedQuantity: 1 }]))).status).toBe(404);
    expect((await asOther('post', '/counts', count(otherStore, [{ productId: copybook, countedQuantity: 1 }]))).status).toBe(404);
    const own = await asOther('post', '/counts', count(otherStore, [{ productId: otherProduct, countedQuantity: 38 }]));
    expect(own.status).toBe(201);
    expect(own.body.count.lines[0].finding.amount).toBe('0.00');
    expect((await request(app).get('/api/inventory/counts').set(bearer(U.owner.token))).body.counts.every((x: any) => x.location.name !== 'Other store')).toBe(true);
  });
});
