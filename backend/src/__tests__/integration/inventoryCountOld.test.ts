/**
 * COD-44b (F-652, M4.md T15): "Count is old". Any change of the on-hand number at a (location, product) after the count was saved
 * makes the count old: units leaving the location (an open transfer too), adjustments, delivered orders and their reversal,
 * a cancel or "return to source" that puts units back, and a transfer received at the location. A transfer still in transit TO
 * the location, and a move of another product, do not.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { stockUp } from './helpers/stock';
import { makeCustomer, makeOrder } from './helpers/kpiOrders';
import { fulfilOrder, reverseOrder } from '../../services/stockService';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(),
  hasSocketInstance: jest.fn(() => true),
}));

jest.setTimeout(120_000);

let tenantId: string;
let owner: { id: number; token: string };
let swiftUserId: number;
let swift: number;
let kofi: number;
let copybook: number;
let pens: number;
let customerId: number;

const today = () => new Date().toISOString().slice(0, 10);
const post = (path: string, body: Record<string, unknown> = {}) => request(app).post(`/api/inventory${path}`).set(bearer(owner.token)).send(body);
const row = async (loc: number, prod: number) => {
  const res = await request(app).get('/api/inventory/overview').set(bearer(owner.token));
  return {
    row: res.body.stockByLocation.find((r: any) => r.locationId === loc && r.productId === prod),
    card: res.body.locations.find((l: any) => l.id === loc),
  };
};
/** A whole-location count of one product that is 12 under our records. */
async function countTwelveUnder(loc: number, prod: number) {
  const { row: r } = await row(loc, prod);
  const res = await post('/counts', { locationId: loc, countDate: today(), source: 'three_pl_dashboard', lines: [{ productId: prod, countedQuantity: r.onHand - 12 }] });
  expect(res.status).toBe(201);
  const after = (await row(loc, prod)).row;
  expect(after.count).toMatchObject({ status: 'off', difference: -12 });
  return res.body.count;
}
const expectOld = async (loc: number, prod: number) => {
  const { row: r, card } = await row(loc, prod);
  expect(r.count).toMatchObject({ status: 'old', difference: null });
  expect(card.latestCount.isOld).toBe(true);
};
const inTx = (fn: (tx: any) => Promise<unknown>) => runInTenant(tenantId, () => prisma.$transaction((tx) => fn(tx)));
const orderOf = async (qty: number) => {
  const order = await makeOrder({ tenantId, customerId, status: 'out_for_delivery', deliveryAgentId: swiftUserId });
  await prismaBase.orderItem.create({ data: { orderId: order.id, productId: copybook, quantity: qty, unitPrice: 50, totalPrice: qty * 50 } });
  return { id: order.id, tenantId, deliveryAgentId: swiftUserId };
};

beforeAll(async () => {
  tenantId = (await createTenant('Count Old')).id;
  await seedTenantDefaults(tenantId);
  owner = await mkUser(tenantId, 'owner', 'super_admin');
  const swiftUser = await mkUser(tenantId, 'swift', 'delivery_agent', { kind: 'company' });
  const kofiUser = await mkUser(tenantId, 'kofi', 'delivery_agent');
  swiftUserId = swiftUser.id;
  const product = (name: string) => prismaBase.product.create({ data: { sku: `CO-${name}-${Date.now()}`, name, category: 'x', price: 50, cogs: 30, stockQuantity: 0, tenantId } }).then((p) => p.id);
  copybook = await product('Copybook');
  pens = await product('Pens');
  swift = await prismaBase.stockLocation.create({ data: { tenantId, name: 'Swift', type: 'partner_3pl', userId: swiftUser.id } }).then((l) => l.id);
  kofi = await prismaBase.stockLocation.create({ data: { tenantId, name: 'Kofi', type: 'agent', userId: kofiUser.id } }).then((l) => l.id);
  customerId = (await makeCustomer(tenantId)).id;
  await stockUp(tenantId, copybook, 200, { locationId: swift });
  await stockUp(tenantId, pens, 100, { locationId: swift });
  await stockUp(tenantId, copybook, 50, { locationId: kofi });
}, 90_000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('a count stays current until the on-hand number changes there', () => {
  it('a transfer out of the location, still in transit, makes the count old (the units left at once); the card says so too', async () => {
    await countTwelveUnder(swift, copybook);
    expect((await post('/transfers', { type: 'allocation', productId: copybook, quantity: 10, fromLocationId: swift, toLocationId: kofi })).status).toBe(201);
    await expectOld(swift, copybook);
  });

  it('a move of a different product leaves the count of this product alone', async () => {
    await countTwelveUnder(swift, copybook);
    expect((await post('/transfers', { type: 'allocation', productId: pens, quantity: 5, fromLocationId: swift, toLocationId: kofi })).status).toBe(201);
    expect((await post('/adjust', { locationId: swift, productId: pens, newQuantity: 50, reason: 'damaged' })).status).toBe(200);
    const { row: r, card } = await row(swift, copybook);
    expect(r.count).toMatchObject({ status: 'off', difference: -12 });
    expect(card.latestCount).toMatchObject({ isOld: false, unitsOff: 12 });
  });

  it('a transfer TO the location still in transit does not make it old; once received, it does', async () => {
    await countTwelveUnder(swift, copybook);
    const back = await post('/transfers', { type: 'return_to_warehouse', productId: copybook, quantity: 5, fromLocationId: kofi, toLocationId: swift });
    expect(back.status).toBe(201);
    expect((await row(swift, copybook)).row.count).toMatchObject({ status: 'off', difference: -12 });
    expect((await post(`/transfers/${back.body.transfer.id}/receive`, { quantity: 5 })).status).toBe(200);
    await expectOld(swift, copybook);
  });

  it('an adjustment makes it old', async () => {
    await countTwelveUnder(swift, copybook);
    const { row: r } = await row(swift, copybook);
    expect((await post('/adjust', { locationId: swift, productId: copybook, newQuantity: r.onHand + 1, reason: 'found_extra_stock' })).status).toBe(200);
    await expectOld(swift, copybook);
  });

  it('a delivered order at the holder makes it old, and so does its reversal', async () => {
    await countTwelveUnder(swift, copybook);
    const order = await orderOf(3);
    await inTx((tx) => fulfilOrder(tx, order));
    await expectOld(swift, copybook);
    await countTwelveUnder(swift, copybook);
    await inTx((tx) => reverseOrder(tx, order));
    await expectOld(swift, copybook);
  });

  it('a cancel that puts units back at the source makes it old, though the transfer row is older than the count', async () => {
    const sent = await post('/transfers', { type: 'allocation', productId: copybook, quantity: 4, fromLocationId: swift, toLocationId: kofi });
    expect(sent.status).toBe(201);
    await new Promise((r) => setTimeout(r, 30));
    await countTwelveUnder(swift, copybook);
    expect((await post(`/transfers/${sent.body.transfer.id}/cancel`)).status).toBe(200);
    await expectOld(swift, copybook);
  });

  it('a dispute resolved with "return to source" makes the source count old', async () => {
    const sent = await post('/transfers', { type: 'allocation', productId: copybook, quantity: 6, fromLocationId: swift, toLocationId: kofi });
    expect((await post(`/transfers/${sent.body.transfer.id}/receive`, { quantity: 4, reason: 'short_in_package' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    await countTwelveUnder(swift, copybook);
    expect((await row(swift, copybook)).row.count.status).toBe('off');
    expect((await post(`/transfers/${sent.body.transfer.id}/resolve`, { action: 'return_to_source' })).status).toBe(200);
    await expectOld(swift, copybook);
  });

  it('the card says the count is old when one product of it is old, though the other matches', async () => {
    const res = await post('/counts', { locationId: kofi, countDate: today(), source: 'three_pl_dashboard', lines: [
      { productId: copybook, countedQuantity: (await row(kofi, copybook)).row.onHand },
      { productId: pens, countedQuantity: 0 },
    ] });
    expect(res.status).toBe(201);
    expect((await row(kofi, copybook)).card.latestCount).toMatchObject({ isOld: false, unitsOff: 0 });
    await new Promise((r) => setTimeout(r, 30));
    const before = (await row(kofi, copybook)).row.onHand;
    expect((await post('/adjust', { locationId: kofi, productId: copybook, newQuantity: before - 1, reason: 'damaged' })).status).toBe(200);
    expect((await row(kofi, pens)).row.count.status).toBe('matches');
    await expectOld(kofi, copybook);
  });
  it('applying the count does not make it old (the fix is the count\'s own)', async () => {
    const count = await countTwelveUnder(swift, pens);
    const line = count.lines[0];
    const applied = await post(`/counts/${count.id}/lines/${line.id}/apply`, { reason: 'physical_count_correction' });
    expect(applied.status).toBe(200);
    expect((await row(swift, pens)).row.count).toMatchObject({ status: 'matches', difference: 0 });
  });
});
