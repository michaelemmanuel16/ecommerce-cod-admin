/**
 * M4-T15 (F-652, F-603, F-659, F-656): the inventory read routes on throwaway tenants. Overview cards and table
 * ("Count is old", apply flips a gap to Matches), levels, holders (total row equals the product total), movement history
 * (filters, pagination, tab counts), the returns summary (sent / received / missing and its Finding, once), 400 / 403 / 404
 * cases and a second tenant.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { stockUp } from './helpers/stock';
import { makeCustomer, makeOrder } from './helpers/kpiOrders';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';

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
let kasapa: number;
let kofi: number;
let store: number;
let swiftUserId: number;
let otherOwner: { id: number; token: string };

const mkUser = async (label: string, role: any, extra: Record<string, unknown> = {}, tenant = tenantId) => {
  const u = await prismaBase.user.create({ data: { email: `ir-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId: tenant, ...extra } });
  U[label] = { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId: tenant }) };
  return u;
};
const location = (name: string, type: any, userId?: number, extra: Record<string, unknown> = {}) =>
  prismaBase.stockLocation.create({ data: { tenantId, name, type, userId, ...extra } }).then((l) => l.id);
const get = (who: string, path: string) => request(app).get(`/api/inventory${path}`).set(bearer(U[who].token));
const post = (who: string, path: string, body: Record<string, unknown> = {}) => request(app).post(`/api/inventory${path}`).set(bearer(U[who].token)).send(body);
const today = () => new Date().toISOString().slice(0, 10);
const row = (body: any, loc: number, prod: number) => body.stockByLocation.find((r: any) => r.locationId === loc && r.productId === prod);
const card = (body: any, loc: number) => body.locations.find((l: any) => l.id === loc);

beforeAll(async () => {
  tenantId = (await createTenant('Inventory Read')).id;
  otherTenantId = (await createTenant('Inventory Read Other')).id;
  await seedTenantDefaults(tenantId); // a shipment receive posts to the ledger
  await mkUser('owner', 'super_admin');
  await mkUser('keeper', 'inventory_manager');
  await mkUser('manager', 'manager');
  await mkUser('clerk', 'accountant');
  await mkUser('rep', 'sales_rep');
  await mkUser('agent', 'delivery_agent');
  const swiftUser = await mkUser('swift', 'delivery_agent', { kind: 'company' });
  swiftUserId = swiftUser.id;
  const kasapaUser = await mkUser('kasapa', 'delivery_agent', { kind: 'company' });
  const kofiUser = await mkUser('kofi', 'delivery_agent');
  const product = (sku: string, extra: Record<string, unknown> = {}) =>
    prismaBase.product.create({ data: { sku: `IR-${sku}-${SUFFIX}`, name: sku, category: 'x', price: 50, cogs: 30, stockQuantity: 0, tenantId, ...extra } }).then((p) => p.id);
  copybook = await product('Copybook');
  pens = await product('Pens');
  ebook = await product('Ebook', { productType: 'digital' });
  store = await location('Own store', 'own_store');
  swift = await location('Swift', 'partner_3pl', swiftUser.id);
  kasapa = await location('Kasapa', 'partner_3pl', kasapaUser.id);
  kofi = await location('Kofi', 'agent', kofiUser.id);
  await stockUp(tenantId, copybook, 200, { locationId: swift });
  await stockUp(tenantId, pens, 62, { locationId: swift });
  await stockUp(tenantId, copybook, 36, { locationId: kofi });

  // Reserved: 10 copybooks out for delivery at Swift, 4 confirmed with no partner (reserves nothing)
  const customer = await makeCustomer(tenantId);
  const out = await makeOrder({ tenantId, customerId: customer.id, status: 'out_for_delivery', deliveryAgentId: swiftUserId });
  await prismaBase.orderItem.create({ data: { orderId: out.id, productId: copybook, quantity: 10, unitPrice: 50, totalPrice: 500 } });
  const open = await makeOrder({ tenantId, customerId: customer.id, status: 'confirmed' });
  await prismaBase.orderItem.create({ data: { orderId: open.id, productId: copybook, quantity: 4, unitPrice: 50, totalPrice: 200 } });

  await mkUser('otherOwner', 'super_admin', {}, otherTenantId);
  otherOwner = U.otherOwner;
  const otherStore = (await prismaBase.stockLocation.create({ data: { tenantId: otherTenantId, name: 'Other store', type: 'own_store' } })).id;
  const otherProduct = (await prismaBase.product.create({ data: { sku: `IR-OTHER-${SUFFIX}`, name: 'Other', category: 'x', price: 5, stockQuantity: 0, tenantId: otherTenantId } })).id;
  await stockUp(otherTenantId, otherProduct, 40, { locationId: otherStore });
}, 90_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('GET /overview', () => {
  it('cards: on hand, reserved from the orders, products, in transit; a location with no stock still has a card; no own-store flag until set up', async () => {
    const { body } = await get('owner', '/overview');
    expect(card(body, swift)).toMatchObject({ name: 'Swift', onHand: 262, reserved: 10, products: 2, inTransit: 0, latestCount: null });
    expect(card(body, kofi)).toMatchObject({ onHand: 36, reserved: 0, products: 1 });
    expect(card(body, kasapa)).toMatchObject({ onHand: 0, reserved: 0, products: 0 });
    expect(card(body, store)).toMatchObject({ onHand: 0 });
    expect(body.hasOwnStore).toBe(true);
    expect(body.locations.map((l: any) => l.type)).not.toContain('in_transit');
    expect(row(body, swift, copybook)).toMatchObject({ onHand: 200, reserved: 10, inTransit: 0, count: null });
  });

  it('an open transfer shows as in transit at the receiver', async () => {
    const t = await post('owner', '/transfers', { type: 'allocation', productId: copybook, quantity: 20, fromLocationId: swift, toLocationId: kofi });
    expect(t.status).toBe(201);
    const { body } = await get('owner', '/overview');
    expect([card(body, kofi).inTransit, row(body, kofi, copybook).inTransit, row(body, swift, copybook).onHand]).toEqual([20, 20, 180]);
    // Units in transit do not make a count old; cancel to keep the numbers simple below
    await post('owner', `/transfers/${t.body.transfer.id}/cancel`);
  });

  let countId: number;
  let lineId: number;
  it('a count shows the difference (count less records, the sign of the count line), the card says N units off, the source and the date', async () => {
    const c = await post('owner', '/counts', { locationId: swift, countDate: today(), source: 'three_pl_dashboard', lines: [{ productId: copybook, countedQuantity: 188 }, { productId: pens, countedQuantity: 62 }] });
    countId = c.body.count.id;
    lineId = c.body.count.lines[0].id;
    const { body } = await get('manager', '/overview');
    expect(row(body, swift, copybook).count).toMatchObject({ counted: 188, difference: -12, status: 'off', source: 'three_pl_dashboard', date: today() });
    expect(row(body, swift, pens).count).toMatchObject({ difference: 0, status: 'matches' });
    expect(card(body, swift).latestCount).toMatchObject({ countId, unitsOff: 12, isOld: false, source: 'three_pl_dashboard' });
    expect(card(body, kofi).latestCount).toBeNull();
  });

  it('filters: product, location type, only differences', async () => {
    expect((await get('owner', `/overview?product=${pens}`)).body.stockByLocation.every((r: any) => r.productId === pens)).toBe(true);
    expect((await get('owner', '/overview?type=agent')).body.stockByLocation.every((r: any) => r.locationType === 'agent')).toBe(true);
    const diff = (await get('owner', '/overview?onlyDifferences=true')).body.stockByLocation;
    expect(diff.map((r: any) => [r.locationId, r.productId])).toEqual([[swift, copybook]]);
  });

  it('apply count turns the gap into Matches (its own movement does not make the count old)', async () => {
    expect((await post('owner', `/counts/${countId}/lines/${lineId}/apply`, { reason: 'short_on_arrival' })).status).toBe(200);
    const { body } = await get('owner', '/overview');
    expect(row(body, swift, copybook)).toMatchObject({ onHand: 188, count: { difference: 0, status: 'matches' } });
    expect(card(body, swift).latestCount).toMatchObject({ unitsOff: 0, isOld: false });
  });

  it('a movement after the count shows "Count is old" instead of a gap', async () => {
    expect((await post('owner', '/adjust', { locationId: swift, productId: copybook, newQuantity: 180, reason: 'damaged' })).status).toBe(200);
    const { body } = await get('owner', '/overview');
    expect(row(body, swift, copybook).count).toMatchObject({ status: 'old', difference: null, counted: 188 });
    expect(row(body, swift, pens).count.status).toBe('matches'); // pens did not move
    expect(card(body, swift).latestCount).toMatchObject({ unitsOff: 0, isOld: false });
  });

  it('the product pre-filter and bad filters: 400', async () => {
    for (const q of ['product=abc', 'product=0', 'type=shelf', 'onlyDifferences=maybe']) expect([q, (await get('owner', `/overview?${q}`)).status]).toEqual([q, 400]);
  });
});

describe('a shipment received with the 3PL dashboard count (M4-T12)', () => {
  it('writes a one-line count of the arrival; the overview and holders do not read it as a count of the location', async () => {
    const bolts = (await prismaBase.product.create({ data: { sku: `IR-BOLT-${SUFFIX}`, name: 'Bolts', category: 'x', price: 5, cogs: 2, stockQuantity: 0, tenantId } })).id;
    const made = await request(app).post('/api/shipments').set(bearer(U.owner.token)).send({ productId: bolts, supplier: 'Acme', quantity: 10, unitCost: 2, shippingCost: 0, customsDuties: 0, otherCosts: 0 });
    expect(made.status).toBe(201);
    const before = (await get('owner', '/overview')).body;
    expect(row(before, kasapa, bolts)).toBeUndefined();

    const received = await request(app).post(`/api/shipments/${made.body.id}/receive`).set(bearer(U.owner.token))
      .send({ locationId: kasapa, receivedAt: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), quantityCounted: 8, countSource: 'three_pl_dashboard' });
    expect(received.status).toBe(200);
    // The receive wrote its count line: shipped 10, counted 8
    const line = await prismaBase.stockCountLine.findFirstOrThrow({ where: { tenantId, productId: bolts }, include: { count: true } });
    expect([line.systemQuantity, line.countedQuantity, line.count.locationId]).toEqual([10, 8, kasapa]);

    const after = (await get('owner', '/overview')).body;
    expect(row(after, kasapa, bolts)).toMatchObject({ onHand: 8, count: null }); // not "5 units off"
    expect(card(after, kasapa)).toMatchObject({ onHand: 8, latestCount: null });
    expect(card(after, swift)).toEqual(card(before, swift));
    expect((await get('owner', `/product/${bolts}/holders`)).body.holders[0]).toMatchObject({ name: 'Kasapa', onHand: 8, count: null });
    expect((await get('owner', '/overview?onlyDifferences=true')).body.stockByLocation.map((r: any) => r.productId)).not.toContain(bolts);
  });
});

describe('GET /levels', () => {
  it('lists the levels with reserved, filtered by location or product', async () => {
    const all = (await get('owner', '/levels')).body.levels;
    expect(all.find((l: any) => l.locationId === swift && l.productId === copybook)).toMatchObject({ onHand: 180, reserved: 10, locationName: 'Swift' });
    const atKofi = (await get('keeper', `/levels?locationId=${kofi}`)).body.levels;
    expect(atKofi.map((l: any) => [l.locationId, l.onHand])).toEqual([[kofi, 36]]);
    expect((await get('owner', `/levels?productId=${pens}`)).body.levels.map((l: any) => l.onHand)).toEqual([62]);
    expect((await get('owner', '/levels?locationId=x')).status).toBe(400);
  });
});

describe('GET /product/:productId/holders', () => {
  it('one row per holder; the total row equals the product total; value is on hand x cost', async () => {
    const { body, status } = await get('clerk', `/product/${copybook}/holders`);
    expect(status).toBe(200);
    const swiftRow = body.holders.find((h: any) => h.locationId === swift);
    expect(swiftRow).toMatchObject({ onHand: 180, reserved: 10, value: '5400.00', delivered: 0, returned: 0, count: { status: 'old' } });
    expect(body.total.onHand).toBe(body.holders.reduce((s: number, h: any) => s + h.onHand, 0));
    expect(body.total).toMatchObject({ onHand: 216, value: '6480.00' });
    expect(body.productTotal).toBe(216);
    expect(body.holdersWithNone).toEqual(expect.arrayContaining(['Kasapa', 'Own store']));
    expect(body.holders.map((h: any) => h.name)).not.toContain('Kasapa');
  });

  it('delivered and returned are sums of movements', async () => {
    await prismaBase.inventoryTransfer.createMany({ data: [
      { tenantId, productId: copybook, quantity: 3, transferType: 'order_fulfillment', fromLocationId: kofi, status: 'received', createdById: U.owner.id },
      { tenantId, productId: copybook, quantity: 2, transferType: 'order_fulfillment', fromLocationId: kofi, status: 'received', createdById: U.owner.id },
      { tenantId, productId: copybook, quantity: 9, transferType: 'order_fulfillment', fromLocationId: kofi, status: 'received', createdById: U.owner.id, reversedAt: new Date() },
      { tenantId, productId: copybook, quantity: 6, transferType: 'return_to_warehouse', fromLocationId: kofi, toLocationId: store, status: 'received', receivedQuantity: 6, createdById: U.owner.id },
    ] });
    const h = (await get('owner', `/product/${copybook}/holders`)).body.holders.find((x: any) => x.locationId === kofi);
    expect(h).toMatchObject({ delivered: 5, returned: 6 });
  });

  it('400 for a digital product, 404 for an unknown one, 400 for a bad id', async () => {
    expect((await get('owner', `/product/${ebook}/holders`)).status).toBe(400);
    expect((await get('owner', '/product/999999999/holders')).status).toBe(404);
    expect((await get('owner', '/product/abc/holders')).status).toBe(400);
  });
});

describe('GET /transfers (history)', () => {
  it('newest first with pagination and tab counts that come from the data', async () => {
    const res = await get('manager', '/transfers?limit=2&includeCounts=true');
    expect(res.status).toBe(200);
    expect(res.body.transfers).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2 });
    expect(res.body.pagination.total).toBeGreaterThan(5);
    const ids = res.body.transfers.map((t: any) => t.id);
    expect(ids[0]).toBeGreaterThan(ids[1]);
    const sum = Object.values(res.body.typeCounts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(res.body.pagination.total);
    expect(res.body.typeCounts).toMatchObject({ count_adjustment: 1, adjustment: 1, allocation: 1 });
  });

  it('filters by type, status, location, product and date; the tab counts ignore the type filter', async () => {
    const byType = await get('owner', '/transfers?type=allocation&includeCounts=true');
    expect(byType.body.transfers.map((t: any) => t.transferType)).toEqual(['allocation']);
    expect(byType.body.transfers[0].status).toBe('cancelled');
    expect(Object.keys(byType.body.typeCounts).length).toBeGreaterThan(1);
    expect((await get('owner', '/transfers?status=cancelled&includeCounts=true')).body.pagination.total).toBe(1);
    const atKofi = (await get('owner', `/transfers?locationId=${kofi}&limit=100`)).body.transfers;
    expect(atKofi.every((t: any) => t.fromLocationId === kofi || t.toLocationId === kofi)).toBe(true);
    expect((await get('owner', `/transfers?productId=${pens}&limit=100`)).body.transfers.every((t: any) => t.productId === pens)).toBe(true);
    expect((await get('owner', `/transfers?from=${today()}&to=${today()}&includeCounts=true`)).body.pagination.total).toBeGreaterThan(5);
    expect((await get('owner', '/transfers?from=2020-01-01&to=2020-01-31&includeCounts=true')).body).toMatchObject({ transfers: [], pagination: { total: 0 } });
  });

  it('400 for a bad type, status, date, page or limit', async () => {
    for (const q of ['type=x', 'status=x', 'from=yesterday', 'to=2026-1-1', 'page=0', 'limit=101', 'productId=a']) expect([q, (await get('owner', `/transfers?${q}`)).status]).toEqual([q, 400]);
  });
});

describe('GET /returns/summary', () => {
  let returnId: number;
  it('Swift sent 41, we received 36: 5 missing, GH₵150 at 30; one Finding, not two after a second read', async () => {
    await stockUp(tenantId, copybook, 100, { locationId: swift });
    const t = await post('keeper', '/transfers', { type: 'return_to_warehouse', productId: copybook, quantity: 41, fromLocationId: swift, toLocationId: store, reason: 'failed_deliveries' });
    expect(t.status).toBe(201);
    returnId = t.body.transfer.id;
    // Still in transit: not counted yet
    expect((await get('owner', '/returns/summary')).body.total).toMatchObject({ sent: 0, missing: 0, value: '0.00' });
    expect((await post('keeper', `/transfers/${returnId}/receive`, { quantity: 36, reason: 'not_received' })).status).toBe(200);

    const res = await get('manager', '/returns/summary');
    expect(res.status).toBe(200);
    expect(res.body.partners).toEqual([{ locationId: swift, partnerId: swiftUserId, name: 'Swift', sent: 41, received: 36, missing: 5, value: '150.00' }]);
    expect(res.body.total).toEqual({ sent: 41, received: 36, missing: 5, value: '150.00' });
    await get('owner', '/returns/summary');
    const findings = await prismaBase.finding.findMany({ where: { tenantId, subjectType: 'return_missing' } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'stock_gap', status: 'open', subjectId: String(returnId) });
    expect(findings[0].amount?.toFixed(2)).toBe('150.00');
  });

  it('filters by partner and by period; a full return has no Finding', async () => {
    expect((await get('owner', `/returns/summary?partnerId=${swiftUserId}`)).body.total.sent).toBe(41);
    expect((await get('owner', `/returns/summary?partnerId=${U.kasapa.id}`)).body.total).toEqual({ sent: 0, received: 0, missing: 0, value: '0.00' });
    expect((await get('owner', '/returns/summary?from=2020-01-01&to=2020-01-31')).body.total.sent).toBe(0);
    expect((await get('owner', `/returns/summary?from=${today()}&to=${today()}`)).body.total.sent).toBe(41);
    await stockUp(tenantId, copybook, 10, { locationId: kasapa });
    const t = await post('owner', '/transfers', { type: 'return_to_warehouse', productId: copybook, quantity: 10, fromLocationId: kasapa, toLocationId: store });
    await post('owner', `/transfers/${t.body.transfer.id}/receive`, { quantity: 10 });
    const res = await get('owner', '/returns/summary');
    expect(res.body.total).toMatchObject({ sent: 51, received: 46, missing: 5 });
    expect(await prismaBase.finding.count({ where: { tenantId, subjectType: 'return_missing' } })).toBe(1);
  });

  it('400 for a bad date or partner', async () => {
    for (const q of ['from=x', 'to=2026-99', 'partnerId=0']) expect([q, (await get('owner', `/returns/summary?${q}`)).status]).toEqual([q, 400]);
  });
});

describe('who may read', () => {
  const paths = () => ['/overview', '/levels', `/product/${copybook}/holders`, '/transfers', '/returns/summary'];
  it('owner, keeper, manager and finance clerk read; a call rep and a delivery agent get 403; no token is 401', async () => {
    for (const p of paths()) {
      for (const who of ['owner', 'keeper', 'manager', 'clerk']) expect([p, who, (await get(who, p)).status]).toEqual([p, who, 200]);
      for (const who of ['rep', 'agent']) expect([p, who, (await get(who, p)).status]).toEqual([p, who, 403]);
      expect([p, (await request(app).get(`/api/inventory${p}`)).status]).toEqual([p, 401]);
    }
  });
});

describe('another tenant', () => {
  it('sees only its own stock, counts, history and returns', async () => {
    const asOther = (path: string) => request(app).get(`/api/inventory${path}`).set(bearer(otherOwner.token));
    const overview = (await asOther('/overview')).body;
    expect(overview.locations.map((l: any) => l.name)).toEqual(['Other store']);
    expect(overview.stockByLocation).toHaveLength(1);
    expect((await asOther(`/product/${copybook}/holders`)).status).toBe(404);
    expect((await asOther('/levels')).body.levels).toHaveLength(1);
    expect((await asOther('/levels?locationId=' + swift)).body.levels).toEqual([]);
    expect((await asOther('/transfers')).body.transfers.every((t: any) => t.product.name === 'Other')).toBe(true);
    expect((await asOther('/returns/summary')).body.total).toEqual({ sent: 0, received: 0, missing: 0, value: '0.00' });
    expect((await asOther('/counts')).body.counts).toEqual([]);
  });
});
