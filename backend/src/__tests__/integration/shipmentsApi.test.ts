/**
 * M4-T11 (F-604, F-605, F-607): the shipments routes. Tiles on the NUMBERS.md fixture (3 / 1,500 / 24,950), a CNY shipment at
 * the day rate, a typed rate, a missing rate, edit and delete only while pending (409), roles (403), audit rows, and a second
 * tenant that must never see or touch the first one's shipments.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';

jest.setTimeout(240_000);

const SUFFIX = Date.now();
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
let tenantId: string;
let otherTenantId: string;
const token: Record<string, string> = {};
let otherToken: string;
let copybook: number;
let ebook: number;
let otherProduct: number;

const mkUser = async (tid: string, label: string, role: any) => {
  const u = await prismaBase.user.create({ data: { email: `shp-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId: tid } });
  return { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId: tid }) };
};
const call = (method: 'get' | 'post' | 'patch' | 'delete', who: string, path: string, body?: Record<string, unknown>) =>
  request(app)[method](`/api/shipments${path}`).set(bearer(token[who])).send(body);
const create = (extra: Record<string, unknown> = {}) =>
  call('post', 'owner', '', { productId: copybook, supplier: 'Accra Print House', quantity: 100, unitCost: 10, shippingCost: 50, customsDuties: 0, otherCosts: 20, ...extra });

beforeAll(async () => {
  tenantId = (await createTenant('Shipments Api', { currency: 'GHS' })).id;
  otherTenantId = (await createTenant('Shipments Api Other', { currency: 'GHS' })).id;
  for (const [label, role] of [['owner', 'super_admin'], ['keeper', 'inventory_manager'], ['admin', 'admin'], ['manager', 'manager'], ['rep', 'sales_rep']]) {
    token[label] = (await mkUser(tenantId, label, role)).token;
  }
  otherToken = (await mkUser(otherTenantId, 'other-owner', 'super_admin')).token;
  const product = (tid: string, sku: string, extra: Record<string, unknown> = {}) =>
    prismaBase.product.create({ data: { sku: `SH-${sku}-${SUFFIX}`, name: sku, category: 'x', price: 50, cogs: 10, stockQuantity: 0, tenantId: tid, ...extra } }).then((p) => p.id);
  copybook = await product(tenantId, 'Copybook');
  ebook = await product(tenantId, 'Ebook', { productType: 'digital' });
  otherProduct = await product(otherTenantId, 'Other');
  // 1 GHS buys 0.625 CNY today (1 CNY = 1.6 GHS) and 0.5 CNY yesterday (1 CNY = 2 GHS).
  await prismaBase.fxRate.createMany({
    data: [
      { tenantId, fromCurrency: 'GHS', toCurrency: 'CNY', rate: '0.625', date: new Date(`${TODAY}T00:00:00Z`), source: 'auto' },
      { tenantId, fromCurrency: 'GHS', toCurrency: 'CNY', rate: '0.5', date: new Date(`${YESTERDAY}T00:00:00Z`), source: 'auto' },
    ],
  });
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('create (F-604, F-605)', () => {
  it('a store-currency shipment: total = quantity x unit + shipping + customs + other, no rate', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(Number(res.body.totalCost)).toBe(1070);
    expect(res.body.currency).toBe('GHS');
    expect(res.body.fxRate).toBeNull();
    expect(Number(res.body.totalCostStore)).toBe(1070);
    expect(Number(res.body.landedCostPerUnit)).toBe(10.7); // pending: total / shipped
    expect(res.body.status).toBe('pending');
  });

  it('a CNY shipment shows the original amount and the store total at the rate of the day', async () => {
    const res = await create({ currency: 'cny' });
    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('CNY');
    expect(Number(res.body.totalCost)).toBe(1070);
    expect(Number(res.body.fxRate)).toBe(1.6);
    expect(res.body.fxRateSource).toBe('auto');
    expect(Number(res.body.totalCostStore)).toBe(1712);
    const list = (await call('get', 'owner', '')).body.find((s: any) => s.id === res.body.id);
    expect([list.currency, Number(list.totalCost), Number(list.totalCostStore)]).toEqual(['CNY', 1070, 1712]);
  });

  it('a typed rate is allowed and marked manual', async () => {
    const res = await create({ currency: 'CNY', fxRate: 2 });
    expect(res.status).toBe(201);
    expect(res.body.fxRateSource).toBe('manual');
    expect(Number(res.body.totalCostStore)).toBe(2140);
  });

  it('a foreign currency with no rate gives 400 and a clear message', async () => {
    const res = await create({ currency: 'JPY' });
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/No exchange rate from JPY to GHS/);
  });

  it('refuses a bad product, a digital product and a bad quantity', async () => {
    expect((await create({ productId: 999999999 })).status).toBe(404);
    expect((await create({ productId: ebook })).status).toBe(400);
    expect((await create({ quantity: 0 })).status).toBe(400);
    expect((await create({ currency: 'EURO' })).status).toBe(400);
  });
});

describe('edit and delete only while pending', () => {
  it('edits a pending shipment and recomputes the total; a manual rate stays', async () => {
    const made = await create({ currency: 'CNY', fxRate: 2 });
    const res = await call('patch', 'owner', `/${made.body.id}`, { quantity: 200, supplier: 'New supplier' });
    expect(res.status).toBe(200);
    expect(Number(res.body.totalCost)).toBe(2070);
    expect(res.body.supplier).toBe('New supplier');
    expect(res.body.fxRateSource).toBe('manual');
    expect(Number(res.body.totalCostStore)).toBe(4140);
  });

  it('a received shipment returns 409 on edit and on delete; so does an old arrived one', async () => {
    for (const status of ['received', 'arrived'] as const) {
      const made = await create();
      await prismaBase.inventoryShipment.update({ where: { id: made.body.id }, data: { status } });
      expect((await call('patch', 'owner', `/${made.body.id}`, { quantity: 5 })).status).toBe(409);
      expect((await call('delete', 'owner', `/${made.body.id}`)).status).toBe(409);
      expect(await prismaBase.inventoryShipment.count({ where: { id: made.body.id } })).toBe(1);
    }
  });

  it('deletes a pending shipment', async () => {
    const made = await create();
    expect((await call('delete', 'owner', `/${made.body.id}`)).status).toBe(200);
    expect((await call('get', 'owner', `/${made.body.id}`)).status).toBe(404);
  });

  it('writes an audit row for create, edit and delete', async () => {
    const made = await create();
    await call('patch', 'owner', `/${made.body.id}`, { notes: 'x' });
    await call('delete', 'owner', `/${made.body.id}`);
    const rows = await prismaBase.auditLog.findMany({ where: { tenantId, resource: 'inventory_shipment', resourceId: String(made.body.id) }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['create', 'update', 'delete']);
  });
});

describe('list and tiles', () => {
  it('filters by status', async () => {
    const made = await create();
    await prismaBase.inventoryShipment.update({ where: { id: made.body.id }, data: { status: 'received' } });
    const pending = (await call('get', 'owner', '?status=pending')).body;
    const received = (await call('get', 'owner', '?status=received')).body;
    expect(pending.every((s: any) => s.status === 'pending')).toBe(true);
    expect(received.map((s: any) => s.id)).toContain(made.body.id);
    expect(pending.map((s: any) => s.id)).not.toContain(made.body.id);
    expect((await call('get', 'owner', '?status=bogus')).status).toBe(400);
  });

  it('the summary adds up the pending shipments in the store currency', async () => {
    await prismaBase.inventoryShipment.deleteMany({ where: { tenantId } });
    await create(); // 1,070 GHS, 100 units
    await create({ currency: 'CNY', quantity: 50 }); // 50 x 10 + 50 + 20 = 570 CNY x 1.6 = 912 GHS
    const res = await call('get', 'owner', '/summary');
    expect(res.status).toBe(200);
    expect([res.body.pendingCount, res.body.unitsOnTheWay, Number(res.body.costToLand)]).toEqual([2, 150, 1982]);
  });
});

describe('roles (403)', () => {
  it('a manager and a sales rep read but cannot write', async () => {
    const made = await create();
    const id = made.body.id;
    expect((await call('get', 'manager', '')).status).toBe(200);
    expect((await call('get', 'manager', '/summary')).status).toBe(200);
    expect((await call('post', 'manager', '', { productId: copybook, quantity: 1 })).status).toBe(403);
    expect((await call('patch', 'manager', `/${id}`, { quantity: 2 })).status).toBe(403);
    expect((await call('delete', 'manager', `/${id}`)).status).toBe(403);
    expect((await call('post', 'manager', `/${id}/receive`, {})).status).toBe(403);
    expect((await call('post', 'manager', `/${id}/claim`, {})).status).toBe(403);
    expect((await call('get', 'rep', '')).status).toBe(200);
    expect((await call('post', 'rep', '', { productId: copybook, quantity: 1 })).status).toBe(403);
    expect((await call('delete', 'rep', `/${id}`)).status).toBe(403);
  });

  it('an admin and a stock keeper can write', async () => {
    expect((await call('post', 'admin', '', { productId: copybook, quantity: 1, unitCost: 1 })).status).toBe(201);
    expect((await call('post', 'keeper', '', { productId: copybook, quantity: 1, unitCost: 1 })).status).toBe(201);
  });
});

describe('a second tenant (every route)', () => {
  let id: number;
  const other = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: Record<string, unknown>) =>
    request(app)[method](`/api/shipments${path}`).set(bearer(otherToken)).send(body);

  beforeAll(async () => {
    id = (await create()).body.id;
  });

  it('cannot read, edit, delete, receive or claim this tenant\'s shipment (404)', async () => {
    expect((await other('get', `/${id}`)).status).toBe(404);
    expect((await other('patch', `/${id}`, { quantity: 2 })).status).toBe(404);
    expect((await other('delete', `/${id}`)).status).toBe(404);
    expect((await other('post', `/${id}/receive`, { locationId: 1, receivedAt: TODAY, quantityCounted: 1, countSource: 'own_count' })).status).toBe(404);
    expect((await other('post', `/${id}/claim`, { action: 'write_off' })).status).toBe(404);
    expect(await prismaBase.inventoryShipment.count({ where: { id, status: 'pending' } })).toBe(1);
  });

  it('its list and tiles hold none of this tenant\'s shipments', async () => {
    expect((await other('get', '')).body).toEqual([]);
    const tiles = (await other('get', '/summary')).body;
    expect([tiles.pendingCount, tiles.unitsOnTheWay, Number(tiles.costToLand)]).toEqual([0, 0, 0]);
  });

  it('cannot add a shipment for this tenant\'s product (404), and this tenant cannot use its product', async () => {
    expect((await other('post', '', { productId: copybook, quantity: 1 })).status).toBe(404);
    expect((await call('post', 'owner', '', { productId: otherProduct, quantity: 1 })).status).toBe(404);
  });

  it('has its own shipments in its own tenant', async () => {
    const res = await other('post', '', { productId: otherProduct, quantity: 3, unitCost: 5 });
    expect(res.status).toBe(201);
    expect((await other('get', '')).body).toHaveLength(1);
  });
});

describe('the NUMBERS.md fixture (F-604 tiles)', () => {
  let fixtureAdmin: string;
  beforeAll(async () => {
    const tid = (await seedFixture(prismaBase)).tenantId;
    const admin = await prismaBase.user.findFirstOrThrow({ where: { tenantId: tid, role: 'admin' } });
    fixtureAdmin = generateAccessToken({ id: admin.id, email: admin.email, role: 'admin', tenantId: tid });
  });
  afterAll(async () => {
    const tid = (await prismaBase.tenant.findUnique({ where: { slug: FIXTURE_SLUG } }))?.id;
    if (tid) await deleteFixtureRows(prismaBase, tid);
    await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  });

  it('3 pending, 1,500 units on the way, GH₵24,950 to land', async () => {
    const res = await request(app).get('/api/shipments/summary').set(bearer(fixtureAdmin));
    expect(res.status).toBe(200);
    expect([res.body.pendingCount, res.body.unitsOnTheWay, Number(res.body.costToLand)]).toEqual([3, 1500, 24950]);
  });

  it('the list has 4 rows: 3 pending and the received one (288 counted)', async () => {
    const list = (await request(app).get('/api/shipments').set(bearer(fixtureAdmin))).body;
    expect(list).toHaveLength(4);
    expect(list.filter((s: any) => s.status === 'pending')).toHaveLength(3);
    const received = list.find((s: any) => s.status === 'received');
    expect([received.quantityCounted, received.shortQuantity, Number(received.landedCostPerUnit)]).toEqual([288, 12, 30.21]); // the API shows money to 2 places; the column holds 30.2083
  });
});
