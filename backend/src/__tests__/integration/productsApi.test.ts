/**
 * M4-T16 (F-600, F-601, F-602, F-658): the Products API on throwaway tenants. List with tabs and the computed columns,
 * the four tiles, create with opening stock, update, archive / restore / delete, cost hidden from a call rep and a delivery
 * agent, the removed stock overwrite, and a second tenant.
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
import { makeCustomer, makeOrder } from './helpers/kpiOrders';

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
let archived: number;
let swift: number;
let swiftUserId: number;
let otherOwner: { id: number; token: string };
let otherProduct: number;

const mkUser = async (label: string, role: any, extra: Record<string, unknown> = {}, tenant = tenantId) => {
  const u = await prismaBase.user.create({ data: { email: `pa-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId: tenant, ...extra } });
  U[label] = { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId: tenant }) };
  return u;
};
const get = (who: string, path: string) => request(app).get(`/api/products${path}`).set(bearer(U[who].token));
const send = (m: 'post' | 'put' | 'patch' | 'delete', who: string, path: string, body: Record<string, unknown> = {}) =>
  request(app)[m](`/api/products${path}`).set(bearer(U[who].token)).send(body);
const newProduct = (extra: Record<string, unknown> = {}) => ({ sku: `PA-N-${Math.random().toString(36).slice(2, 8)}`, name: 'New', category: 'x', price: 20, cogs: 5, ...extra });
const line = (orderId: number, productId: number, quantity: number) =>
  prismaBase.orderItem.create({ data: { orderId, productId, quantity, unitPrice: 10, totalPrice: quantity * 10 } });
const row = (body: any, id: number) => body.products.find((p: any) => p.id === id);

beforeAll(async () => {
  tenantId = (await createTenant('Products Api')).id;
  otherTenantId = (await createTenant('Products Api Other')).id;
  await mkUser('owner', 'super_admin');
  await mkUser('admin', 'admin');
  await mkUser('keeper', 'inventory_manager');
  await mkUser('manager', 'manager');
  await mkUser('clerk', 'accountant');
  await mkUser('rep', 'sales_rep');
  await mkUser('agent', 'delivery_agent');
  const swiftUser = await mkUser('swift', 'delivery_agent', { kind: 'company' });
  swiftUserId = swiftUser.id;
  const product = (sku: string, extra: Record<string, unknown> = {}) =>
    prismaBase.product.create({ data: { sku: `PA-${sku}-${SUFFIX}`, name: sku, category: 'x', price: 249, cogs: 30, stockQuantity: 0, tenantId, ...extra } }).then((p) => p.id);
  copybook = await product('Copybook');
  pens = await product('Pens', { price: 40, cogs: 12, lowStockDays: 3 });
  ebook = await product('Ebook', { productType: 'digital', price: 59, cogs: 3 });
  archived = await product('Old', { isActive: false });
  swift = (await prismaBase.stockLocation.create({ data: { tenantId, name: 'Swift', type: 'partner_3pl', userId: swiftUserId } })).id;
  await stockUp(tenantId, copybook, 200, { locationId: swift });
  await stockUp(tenantId, pens, 30, { locationId: swift });

  // Orders: 10 copybooks out for delivery at Swift (reserved); delivered this month: 28 copybooks (14 days of sales at 2 a day),
  // 3 pens, 1 ebook; one failed and one returned order that hold pens
  const customer = await makeCustomer(tenantId);
  const now = new Date();
  const out = await makeOrder({ tenantId, customerId: customer.id, status: 'out_for_delivery', deliveryAgentId: swiftUserId });
  await line(out.id, copybook, 10);
  const delivered = await makeOrder({ tenantId, customerId: customer.id, status: 'delivered', deliveryDate: now, deliveryAgentId: swiftUserId });
  await line(delivered.id, copybook, 28);
  await line(delivered.id, pens, 3);
  const failed = await makeOrder({ tenantId, customerId: customer.id, status: 'failed_delivery', updatedAt: now });
  await line(failed.id, pens, 1);
  const returned = await makeOrder({ tenantId, customerId: customer.id, status: 'returned', returnedAt: now, deliveryDate: now });
  await line(returned.id, pens, 1);
  const digital = await makeOrder({ tenantId, customerId: customer.id, status: 'digital_delivered', paymentStatus: 'paid', totalAmount: 59, deliveryDate: now });
  await line(digital.id, ebook, 1);

  await mkUser('otherOwner', 'super_admin', {}, otherTenantId);
  otherOwner = U.otherOwner;
  otherProduct = (await prismaBase.product.create({ data: { sku: `PA-OTHER-${SUFFIX}`, name: 'Other', category: 'x', price: 5, stockQuantity: 0, tenantId: otherTenantId } })).id;
}, 90_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('GET /api/products', () => {
  it('without a tab it lists the active products, as before; the archived one is hidden', async () => {
    const { body, status } = await get('owner', '');
    expect(status).toBe(200);
    expect(body.products.map((p: any) => p.id).sort()).toEqual([copybook, pens, ebook].sort());
    expect(body.pagination).toMatchObject({ page: 1, limit: 20, total: 3 });
  });

  it('tabs: active, archived, all, with counts that do not move with the tab', async () => {
    const archivedTab = (await get('owner', '?tab=archived')).body;
    expect(archivedTab.products.map((p: any) => p.id)).toEqual([archived]);
    expect(archivedTab.products[0].status).toBe('archived');
    const all = (await get('owner', '?tab=all')).body;
    expect(all.pagination.total).toBe(4);
    expect(all.counts).toEqual({ active: 3, archived: 1, all: 4 });
    expect(archivedTab.counts).toEqual(all.counts);
    expect((await get('owner', '?tab=active&limit=1&page=2')).body.products).toHaveLength(1);
  });

  it('search works on name, SKU and category', async () => {
    expect((await get('owner', '?search=pens')).body.products.map((p: any) => p.id)).toEqual([pens]);
    expect((await get('owner', `?search=PA-Copybook-${SUFFIX}`)).body.products.map((p: any) => p.id)).toEqual([copybook]);
  });

  it('computed columns: on hand, reserved, days of cover, delivered in the month, delivery success, margin, status', async () => {
    const { body } = await get('manager', '');
    expect(row(body, copybook)).toMatchObject({
      onHandTotal: 200, reservedTotal: 10, daysOfCover: 100, deliveredInPeriod: 28, deliverySuccess: 100, marginPct: 88, status: 'active', cogs: '30.00',
    });
    // pens: 30 on hand, 3 sold in 14 days (3 / 14 a day) = 140 days; 3 delivered, 1 failed, 1 returned = 1 / 3 of the closed orders; limit 3 days
    expect(row(body, pens)).toMatchObject({ onHandTotal: 30, reservedTotal: 0, daysOfCover: 140, deliveredInPeriod: 3, deliverySuccess: 33.3, marginPct: 70, status: 'active', lowStockDaysEffective: 3 });
    // the digital product: no stock, no cover, no delivery success; its paid order counts as a unit
    expect(row(body, ebook)).toMatchObject({ onHandTotal: null, reservedTotal: null, daysOfCover: null, deliverySuccess: null, deliveredInPeriod: 1, status: 'digital', marginPct: 95 });
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('a physical product with no cost set has no margin (null) and a digital one at cost 0 is 100%', async () => {
    const free = (await send('post', 'owner', '', newProduct({ cogs: 0, price: 10 }))).body.product.id;
    const guide = (await send('post', 'owner', '', newProduct({ cogs: 0, price: 10, productType: 'digital' }))).body.product.id;
    const { body } = await get('owner', '?limit=100');
    expect(row(body, free).marginPct).toBeNull();
    expect(row(body, guide).marginPct).toBe(100);
    expect((await get('owner', `/${free}`)).body.product.marginPct).toBeNull();
  });

  it('a month with no deliveries gives 0 delivered, no error', async () => {
    const { body, status } = await get('owner', '?month=2020-01');
    expect(status).toBe(200);
    expect(row(body, copybook)).toMatchObject({ deliveredInPeriod: 0, deliverySuccess: null });
  });

  it('low stock: days of cover under the limit; out of stock at 0 or less', async () => {
    const lowId = (await send('post', 'owner', '', newProduct({ lowStockDays: 200, cogs: 1 }))).body.product.id;
    await stockUp(tenantId, lowId, 40, { locationId: swift });
    const order = await makeOrder({ tenantId, customerId: (await makeCustomer(tenantId)).id, status: 'delivered', deliveryDate: new Date() });
    await line(order.id, lowId, 14); // 1 a day: 40 days of cover, under the limit of 200
    const empty = (await send('post', 'owner', '', newProduct())).body.product.id;
    const { body } = await get('owner', '?limit=100');
    expect(row(body, lowId)).toMatchObject({ daysOfCover: 40, status: 'low_stock' });
    expect(row(body, empty)).toMatchObject({ onHandTotal: 0, daysOfCover: null, status: 'out_of_stock' });
    // GET /low-stock reads the same days of cover: the product under its limit is there, the others are not
    const low = (await get('owner', '/low-stock')).body.products;
    expect(low.map((p: any) => p.id)).toEqual([lowId]);
    expect(low[0]).toMatchObject({ daysOfCover: 40, status: 'low_stock' });
  });

  it('400 for a bad tab, month, page or limit', async () => {
    for (const q of ['tab=gone', 'month=2026-13', 'month=oct', 'page=0', 'limit=101']) expect([q, (await get('owner', `?${q}`)).status]).toEqual([q, 400]);
  });
});

describe('cost and margin by role', () => {
  it('owner, admin, manager, finance clerk and stock keeper get cost and margin', async () => {
    for (const who of ['owner', 'admin', 'manager', 'clerk', 'keeper']) {
      const p = row((await get(who, '')).body, copybook);
      expect([who, p.cogs, p.marginPct]).toEqual([who, '30.00', 88]);
      expect((await get(who, `/${copybook}`)).body.product).toMatchObject({ cogs: '30.00', marginPct: 88 });
    }
  });

  it('a call rep and a delivery agent get the product without cost or margin, on the list, the detail and low stock', async () => {
    for (const who of ['rep', 'agent']) {
      const list = (await get(who, '')).body;
      expect(row(list, copybook)).toMatchObject({ id: copybook, price: '249.00' });
      expect(JSON.stringify(list)).not.toMatch(/cogs|marginPct/);
      expect(JSON.stringify((await get(who, `/${copybook}`)).body)).not.toMatch(/cogs|marginPct/);
      expect(JSON.stringify((await get(who, '/low-stock')).body)).not.toMatch(/cogs|marginPct/);
    }
  });

  it('the tiles are cost-role only: 403 for a rep and an agent', async () => {
    for (const who of ['rep', 'agent']) expect((await get(who, '/summary')).status).toBe(403);
  });
});

describe('GET /api/products/:id drawer facts (M4-T22)', () => {
  it('hasOrders follows the order lines; hasReceivedShipment follows a received shipment, for every role', async () => {
    await prismaBase.inventoryShipment.create({
      data: { tenantId, productId: pens, quantity: 10, unitCost: 5, totalCost: 50, status: 'received', quantityCounted: 10, shortQuantity: 0, createdById: U.owner.id },
    });
    const detail = async (who: string, id: number, query = '') => (await get(who, `/${id}${query}`)).body.product;
    expect(await detail('owner', copybook)).toMatchObject({ hasOrders: true, hasReceivedShipment: false });
    expect(await detail('owner', pens)).toMatchObject({ hasOrders: true, hasReceivedShipment: true });
    // An archived product is hidden by id, as before; the drawer asks for it with includeArchived
    expect((await get('owner', `/${archived}`)).status).toBe(404);
    expect(await detail('owner', archived, '?includeArchived=true')).toMatchObject({ isActive: false, hasOrders: false, hasReceivedShipment: false });
    // The facts carry no money: a rep gets them too, still without cost
    const rep = await detail('rep', pens);
    expect(rep).toMatchObject({ hasOrders: true, hasReceivedShipment: true });
    expect(rep.cogs).toBeUndefined();
    await prismaBase.inventoryShipment.deleteMany({ where: { tenantId, productId: pens } });
  });
});

describe('GET /api/products/summary', () => {
  it('four tiles: active and archived counts, best seller, revenue-weighted margin, low stock', async () => {
    const { body, status } = await get('manager', '/summary');
    expect(status).toBe(200);
    expect(body.activeProducts.archived).toBe(1);
    expect(body.bestSeller).toMatchObject({ productId: copybook, units: 28 });
    expect(body.lowStock).toBeGreaterThanOrEqual(1);
    expect(typeof body.averageMargin).toBe('number');
  });

  it('average margin is sum of units x (price - cost) over sum of units x price', async () => {
    // delivered this month: copybook 28 + 0, pens 3, ebook 1, plus the extra product from the low stock test (cost 1, price 20, 14 units)
    // A physical product with no cost set is left out of the average even when it sold: 5 units here must not move it
    const noCost = (await send('post', 'owner', '', newProduct({ cogs: 0, price: 100 }))).body.product.id;
    const order = await makeOrder({ tenantId, customerId: (await makeCustomer(tenantId)).id, status: 'delivered', deliveryDate: new Date() });
    await line(order.id, noCost, 5);
    const units = [[28, 249, 30], [3, 40, 12], [1, 59, 3], [14, 20, 1]];
    const margin = units.reduce((s, [n, price, cost]) => s + n * (price - cost), 0);
    const revenue = units.reduce((s, [n, price]) => s + n * price, 0);
    expect((await get('owner', '/summary')).body.averageMargin).toBe(Math.round((margin / revenue) * 100));
  });

  it('a month with no data: best seller null, margin null, no error', async () => {
    const { body, status } = await get('owner', '/summary?month=2020-01');
    expect(status).toBe(200);
    expect(body.bestSeller).toBeNull();
    expect(body.averageMargin).toBeNull();
  });

  it('400 for a bad month', async () => {
    expect((await get('owner', '/summary?month=2020-1')).status).toBe(400);
  });
});

describe('POST /api/products', () => {
  it('opening stock writes one opening movement at the first active 3PL by default and sets the cache', async () => {
    const res = await send('post', 'owner', '', newProduct({ openingStock: { quantity: 25 } }));
    expect(res.status).toBe(201);
    const id = res.body.product.id;
    expect(await levelAt(swift, id)).toBe(25);
    expect(await cacheOf(id)).toBe(25);
    const moves = await prismaBase.inventoryTransfer.findMany({ where: { productId: id } });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ transferType: 'opening', quantity: 25, toLocationId: swift, createdById: U.owner.id, status: 'received' });
  });

  it('opening stock at a named location; the stock keeper may', async () => {
    const store = (await prismaBase.stockLocation.create({ data: { tenantId, name: 'Own store', type: 'own_store' } })).id;
    const res = await send('post', 'keeper', '', newProduct({ openingStock: { locationId: store, quantity: 7 } }));
    expect(res.status).toBe(201);
    expect([await levelAt(store, res.body.product.id), await cacheOf(res.body.product.id)]).toEqual([7, 7]);
  });

  it('lowStockDays and the digital fields are stored; no opening stock means no movement', async () => {
    const res = await send('post', 'owner', '', newProduct({ lowStockDays: 21, productType: 'digital', digitalFileUrl: 'https://files.example/a.pdf', digitalFileType: 'pdf', downloadLinkExpiryHours: 48, maxDownloads: 3 }));
    expect(res.status).toBe(201);
    expect(res.body.product).toMatchObject({ lowStockDays: 21, productType: 'digital', digitalFileType: 'pdf', downloadLinkExpiryHours: 48, maxDownloads: 3, stockQuantity: 0 });
    expect((await get('owner', `/${res.body.product.id}`)).body.product.maxDownloads).toBe(3);
    expect((await send('put', 'owner', `/${res.body.product.id}`, { maxDownloads: 7 })).body.product.maxDownloads).toBe(7);
    expect((await send('put', 'owner', `/${res.body.product.id}`, { maxDownloads: null })).body.product.maxDownloads).toBeNull();
    expect((await send('put', 'owner', `/${res.body.product.id}`, { maxDownloads: 0 })).status).toBe(400);
    expect(await prismaBase.inventoryTransfer.count({ where: { productId: res.body.product.id } })).toBe(0);
  });

  it('400: stockQuantity in the body, a digital product with opening stock, a bad opening stock, a bad lowStockDays, a duplicate SKU, a missing field', async () => {
    const sku = newProduct().sku;
    expect((await send('post', 'owner', '', newProduct({ stockQuantity: 10 }))).status).toBe(400);
    expect((await send('post', 'owner', '', newProduct({ stockQuantity: 0 }))).status).toBe(400);
    expect((await send('post', 'owner', '', newProduct({ productType: 'digital', openingStock: { quantity: 5 } }))).status).toBe(400);
    expect((await send('post', 'owner', '', newProduct({ openingStock: { quantity: -1 } }))).status).toBe(400);
    expect((await send('post', 'owner', '', newProduct({ openingStock: { locationId: 'x', quantity: 1 } }))).status).toBe(400);
    expect((await send('post', 'owner', '', newProduct({ lowStockDays: 0 }))).status).toBe(400);
    expect((await send('post', 'owner', '', newProduct({ sku }))).status).toBe(201);
    expect((await send('post', 'owner', '', newProduct({ sku }))).status).toBe(400);
    expect((await send('post', 'owner', '', { name: 'x' })).status).toBe(400);
  });

  it('opening stock with a location of another tenant, or the in-transit location, is refused; none at all is 400', async () => {
    const transit = (await prismaBase.stockLocation.create({ data: { tenantId, name: 'In transit', type: 'in_transit' } })).id;
    const foreign = (await prismaBase.stockLocation.create({ data: { tenantId: otherTenantId, name: 'Foreign', type: 'own_store' } })).id;
    expect((await send('post', 'owner', '', newProduct({ openingStock: { locationId: transit, quantity: 1 } }))).status).toBe(400);
    expect((await send('post', 'owner', '', newProduct({ openingStock: { locationId: foreign, quantity: 1 } }))).status).toBe(404);
    // A tenant with no location: the form must add one first
    await mkUser('bare', 'super_admin', {}, otherTenantId);
    await prismaBase.stockLocation.deleteMany({ where: { tenantId: otherTenantId } });
    expect((await send('post', 'bare', '', newProduct({ openingStock: { quantity: 1 } }))).status).toBe(400);
  });

  it('403 for a manager, a rep and an agent; 401 without a token', async () => {
    for (const who of ['manager', 'rep', 'agent', 'clerk']) expect((await send('post', who, '', newProduct())).status).toBe(403);
    expect((await request(app).post('/api/products').send(newProduct())).status).toBe(401);
  });
});

describe('PUT /api/products/:id and the removed stock overwrite', () => {
  it('updates the fields, including lowStockDays and null to clear it', async () => {
    expect((await send('put', 'owner', `/${pens}`, { price: 45, lowStockDays: 10 })).body.product).toMatchObject({ price: '45.00', lowStockDays: 10 });
    expect((await send('put', 'keeper', `/${pens}`, { lowStockDays: null })).body.product.lowStockDays).toBeNull();
  });

  it('stockQuantity returns 400 and changes nothing; openingStock on an edit returns 400', async () => {
    const before = await cacheOf(copybook);
    const res = await send('put', 'owner', `/${copybook}`, { stockQuantity: 5 });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('stockQuantity');
    expect((await send('put', 'owner', `/${copybook}`, { openingStock: { quantity: 5 } })).status).toBe(400);
    expect(await cacheOf(copybook)).toBe(before);
  });

  it('PATCH /api/products/:id/stock is gone (404)', async () => {
    expect((await send('patch', 'owner', `/${copybook}/stock`, { stockQuantity: 5 })).status).toBe(404);
  });

  it('409 for a product type change once there are orders; 400 for a taken SKU; 404 unknown; 400 bad id; 403 for a manager', async () => {
    expect((await send('put', 'owner', `/${copybook}`, { productType: 'digital' })).status).toBe(409);
    expect((await send('put', 'owner', `/${copybook}`, { sku: `PA-Pens-${SUFFIX}` })).status).toBe(400);
    expect((await send('put', 'owner', '/999999999', { name: 'x' })).status).toBe(404);
    expect((await send('put', 'owner', '/abc', { name: 'x' })).status).toBe(400);
    expect((await send('put', 'manager', `/${copybook}`, { name: 'x' })).status).toBe(403);
  });

  it('does not let a body write fields it should not (tenantId, id)', async () => {
    const res = await send('put', 'owner', `/${pens}`, { tenantId: otherTenantId, id: 1, name: 'Pens renamed' });
    expect(res.status).toBe(200);
    expect(res.body.product).toMatchObject({ id: pens, tenantId, name: 'Pens renamed' });
  });
});

describe('archive, restore, delete', () => {
  it('archive hides the product from the default list, says what it still holds, and keeps its stock', async () => {
    const res = await send('post', 'keeper', `/${copybook}/archive`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ product: { id: copybook, isActive: false }, openOrders: 1, unitsOnHand: 200 });
    expect((await get('owner', '')).body.products.map((p: any) => p.id)).not.toContain(copybook);
    expect(row((await get('owner', '?tab=archived')).body, copybook)).toMatchObject({ status: 'archived', onHandTotal: 200 });
    expect((await send('post', 'keeper', `/${copybook}/archive`)).status).toBe(200); // again: nothing changes
  });

  it('restore brings it back', async () => {
    const res = await send('post', 'owner', `/${copybook}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.product.isActive).toBe(true);
    expect((await get('owner', '')).body.products.map((p: any) => p.id)).toContain(copybook);
  });

  it('403 for a manager; 404 unknown; 400 bad id', async () => {
    expect((await send('post', 'manager', `/${copybook}/archive`)).status).toBe(403);
    expect((await send('post', 'rep', `/${copybook}/restore`)).status).toBe(403);
    expect((await send('post', 'owner', '/999999999/archive')).status).toBe(404);
    expect((await send('post', 'owner', '/999999999/restore')).status).toBe(404);
    expect((await send('post', 'owner', '/abc/archive')).status).toBe(400);
  });

  it('delete: 409 for a product with orders, and the product stays; a product with none is removed', async () => {
    const res = await send('delete', 'owner', `/${copybook}`);
    expect(res.status).toBe(409);
    expect((await prismaBase.product.findUniqueOrThrow({ where: { id: copybook } })).isActive).toBe(true);
    const fresh = (await send('post', 'owner', '', newProduct())).body.product.id;
    expect((await send('delete', 'owner', `/${fresh}`)).status).toBe(200);
    expect((await get('owner', `/${fresh}`)).status).toBe(404);
  });
});

describe('another tenant', () => {
  it('lists only its own products and cannot read, change, archive or delete the first tenant products', async () => {
    const list = (await request(app).get('/api/products?tab=all').set(bearer(otherOwner.token))).body;
    expect(list.products.map((p: any) => p.id)).toEqual([otherProduct]);
    expect(list.counts).toEqual({ active: 1, archived: 0, all: 1 });
    const as = (m: 'get' | 'put' | 'post' | 'delete', path: string, body: Record<string, unknown> = {}) => request(app)[m](`/api/products${path}`).set(bearer(otherOwner.token)).send(body);
    expect((await as('get', `/${copybook}`)).status).toBe(404);
    expect((await as('put', `/${copybook}`, { name: 'hacked' })).status).toBe(404);
    expect((await as('post', `/${copybook}/archive`)).status).toBe(404);
    expect((await as('post', `/${copybook}/restore`)).status).toBe(404);
    expect((await as('delete', `/${copybook}`)).status).toBe(404);
    expect((await as('get', '/summary')).body.bestSeller).toBeNull();
    expect((await prismaBase.product.findUniqueOrThrow({ where: { id: copybook } })).name).toBe('Copybook');
  });

  it('may use the same SKU as the first tenant', async () => {
    const res = await request(app).post('/api/products').set(bearer(otherOwner.token)).send(newProduct({ sku: `PA-Copybook-${SUFFIX}` }));
    expect(res.status).toBe(201);
  });
});
