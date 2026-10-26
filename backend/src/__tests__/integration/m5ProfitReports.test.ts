/**
 * M5-T26 (COD-52, F-924, F-925, F-926, F-721): profit by product, order cohort card, cost of failed deliveries, cost of a
 * refused delivery. The PRD numbers are rebuilt in this suite's own tenant (the NUMBERS fixture has no fee, Meta or
 * commission postings): net -14,268 over 376 delivered orders, failed-delivery cost GH₵610 = 460 + 150.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { refusalCost } from '../../services/finance/profitService';
import { postEntry } from './helpers/ledgerPost';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { mkCustomer, mkOrder, mkPartner, SettlementWorld } from './helpers/settlementFixtures';

jest.setTimeout(240_000);

let a: string;
let b: string;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let worldA: SettlementWorld;
let kofi: number;
let kwesi: number;
let logiswift: number;
let noRule: number;
let copybookId: number;
let pensId: number;
let guideId: number;
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'super_admin' };

const get = (path: string, who: { token: string }, from: string, to: string) =>
  request(app).get(`/api/financial/${path}?from=${from}&to=${to}`).set(auth(who));
const mkProduct = (tenantId: string, sku: string, cogs: number, productType = 'physical') =>
  prismaBase.product.create({ data: { tenantId, sku, name: sku, category: 'test', price: 100, stockQuantity: 0, cogs, productType } }).then((p) => p.id);

beforeAll(async () => {
  a = (await createTenant('Profit A')).id;
  b = (await createTenant('Profit B')).id;
  await Promise.all([seedTenantDefaults(a), seedTenantDefaults(b)]);
  ownerA = await mkUser(a, 'ownerA', 'super_admin');
  ownerB = await mkUser(b, 'ownerB', 'super_admin');
  ADMIN.userId = ownerA.id;
  worldA = { tenantId: a, customerId: await mkCustomer(a, '+233241000001'), actorId: ownerA.id };
  copybookId = await mkProduct(a, 'COPY', 30);
  pensId = await mkProduct(a, 'PENS', 0);
  guideId = await mkProduct(a, 'GUIDE', 0, 'digital');
  kofi = (await mkPartner(a, 'kofi', { fees: { delivered: 25, failed: 5 } })).id;
  kwesi = (await mkPartner(a, 'kwesi', { fees: { delivered: 25, failed: 5 } })).id;
  logiswift = (await mkPartner(a, 'logiswift', { kind: 'company', fees: { delivered: 35, failed: 0 } })).id;
  noRule = (await mkPartner(a, 'norule')).id;

  // 376 delivered orders in October: revenue 92,000, product cost 12,000, fees 12,200
  const rows = Array.from({ length: 376 }, (_, i) => ({
    customerId: worldA.customerId, status: 'delivered' as const, tenantId: a,
    subtotal: i < 372 ? 245 : 215, totalAmount: i < 372 ? 245 : 215, codAmount: i < 372 ? 245 : 215,
    deliveryAgentId: logiswift, deliveryDate: new Date(`2026-10-${String((i % 17) + 1).padStart(2, '0')}T12:00:00Z`),
    deliveryFee: i < 168 ? 33 : 32, landedCostTotal: i < 360 ? 32 : 30,
  }));
  await prismaBase.order.createMany({ data: rows });
  const orders = await prismaBase.order.findMany({ where: { tenantId: a, status: 'delivered' }, orderBy: { id: 'asc' }, select: { id: true, totalAmount: true } });
  await prismaBase.orderItem.createMany({ data: orders.map((o) => ({ orderId: o.id, productId: copybookId, quantity: 1, unitPrice: o.totalAmount, totalPrice: o.totalAmount })) });
  const id = ownerA.id;
  await postEntry(a, id, '2026-10-10', [['1015', 92000, 0], ['4010', 0, 92000]]);
  await postEntry(a, id, '2026-10-10', [['5010', 12000, 0], ['1200', 0, 12000]]);
  await postEntry(a, id, '2026-10-10', [['5070', 12200, 0], ['1015', 0, 12200]]);
  await postEntry(a, id, '2026-10-10', [['5080', 76200, 0], ['1010', 0, 76200]]);
  await postEntry(a, id, '2026-10-10', [['5100', 3100, 0], ['1010', 0, 3100]]);
  await postEntry(a, id, '2026-10-10', [['5050', 2768, 0], ['2020', 0, 2768]]);

  // Tenant B: one delivered order and revenue that must never show in A
  const custB = await mkCustomer(b, '+233241000002');
  const orderB = await prismaBase.order.create({ data: { customerId: custB, status: 'delivered', subtotal: 777, totalAmount: 777, codAmount: 777, tenantId: b, deliveryDate: new Date('2026-10-05T12:00:00Z'), deliveryFee: 7, landedCostTotal: 7 } });
  await prismaBase.orderItem.create({ data: { orderId: orderB.id, productId: await mkProduct(b, 'BCOPY', 7), quantity: 1, unitPrice: 777, totalPrice: 777 } });
  await postEntry(b, ownerB.id, '2026-10-05', [['1010', 777, 0], ['4010', 0, 777]]);
});

afterAll(async () => {
  await deleteTenantRows([a, b]);
  await prismaBase.$disconnect();
});

describe('F-924 profit by product', () => {
  it('fixture: overall net -14,268 over 376 delivered, about -GH₵38 an order', async () => {
    const res = await get('profit-by-product', ownerA, '2026-10-01', '2026-10-17');
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ delivered: 376, revenue: '92000.00', productCost: '12000.00', fees: '12200.00' });
    expect(res.body.metaSpendWithNoProduct).toBe('76200.00');
    expect(res.body.repCommission).toBe('2768.00');
    expect(res.body.otherExpenses).toBe('3100.00');
    expect(res.body.notMatchedToProductRow).toEqual({ revenue: '0.00', productCost: '0.00', fees: '0.00' }); // rows add up to the ledger
    expect(res.body.netProfit).toBe('-14268.00');
    expect(res.body.netMarginPct).toBe(-15.5);
    expect(res.body.targetNetMargin).toBe(35);
    expect(res.body.profitPerDeliveredOrder).toBe('-37.95');
    expect(Math.round(Number(res.body.profitPerDeliveredOrder))).toBe(-38);
  });

  it('table total equals the income statement', async () => {
    const table = (await get('profit-by-product', ownerA, '2026-10-01', '2026-10-17')).body;
    const statement = (await request(app).get('/api/financial/profit-loss?startDate=2026-10-01&endDate=2026-10-17').set(auth(ownerA))).body.statement;
    expect(table.totals.revenue).toBe(statement.revenue);
    expect(table.totals.productCost).toBe(statement.productCost);
    expect(table.netProfit).toBe(statement.netProfit);
  });

  it('the copybook row: delivered orders, cost, fees, profit before commission', async () => {
    const row = (await get('profit-by-product', ownerA, '2026-10-01', '2026-10-17')).body.products[0];
    expect(row).toMatchObject({ sku: 'COPY', delivered: 376, units: 376, revenue: '92000.00', productCost: '12000.00', fees: '12200.00', profit: '67800.00', costMissing: false });
    expect(row.profitPerDeliveredOrder).toBe('180.32');
  });

  it('a product with no cost shows "Cost missing"; a digital product has cost 0 and Paystack as its fee', async () => {
    const pens = await prismaBase.order.create({ data: { customerId: worldA.customerId, status: 'delivered', subtotal: 40, totalAmount: 40, codAmount: 40, tenantId: a, deliveryAgentId: logiswift, deliveryDate: new Date('2026-11-05T12:00:00Z'), deliveryFee: 5, landedCostTotal: 0 } });
    await prismaBase.orderItem.create({ data: { orderId: pens.id, productId: pensId, quantity: 1, unitPrice: 40, totalPrice: 40 } });
    const guide = await prismaBase.order.create({ data: { customerId: worldA.customerId, status: 'digital_delivered', paymentStatus: 'paid', subtotal: 59, totalAmount: 59, tenantId: a, deliveryDate: new Date('2026-11-06T12:00:00Z') } });
    await prismaBase.orderItem.create({ data: { orderId: guide.id, productId: guideId, quantity: 1, unitPrice: 59, totalPrice: 59 } });
    await postEntry(a, ownerA.id, '2026-11-06', [['5060', 1.5, 0], ['1010', 0, 1.5]], 'digital_sale', guide.id);

    const body = (await get('profit-by-product', ownerA, '2026-11-01', '2026-11-30')).body;
    const p = body.products.find((r: any) => r.sku === 'PENS');
    expect(p).toMatchObject({ costMissing: true, costNote: 'Cost missing', productCost: null, profit: null, marginPct: null });
    const g = body.products.find((r: any) => r.sku === 'GUIDE');
    expect(g).toMatchObject({ costMissing: false, productCost: '0.00', fees: '1.50', profit: '57.50' });
    expect(body.costMissingProducts).toBe(1);
    // No revenue was booked in the ledger for these two orders: the rows show up as the difference, not hidden
    expect(body.notMatchedToProductRow.revenue).toBe('-99.00');
  });

  it('an empty range returns zeros, no NaN; tenant B data stays out of A', async () => {
    const empty = (await get('profit-by-product', ownerA, '2019-01-01', '2019-01-31')).body;
    expect(empty.products).toEqual([]);
    expect(empty.netProfit).toBe('0.00');
    expect(empty.netMarginPct).toBeNull();
    expect(empty.profitPerDeliveredOrder).toBeNull();
    const mine = JSON.stringify((await get('profit-by-product', ownerA, '2026-10-01', '2026-10-17')).body);
    expect(mine).not.toContain('777.00');
    expect((await get('profit-by-product', ownerB, '2026-10-01', '2026-10-17')).body.totals.revenue).toBe('777.00');
  });

  it('needs from and to', async () => {
    expect((await request(app).get('/api/financial/profit-by-product').set(auth(ownerA))).status).toBe(400);
  });

  it('trend: profit of each product for the last 3 months equals the table, the current month to date', async () => {
    const res = await request(app).get('/api/financial/profit-by-product/trend?months=3&asOf=2026-10-17').set(auth(ownerA));
    expect(res.status).toBe(200);
    expect(res.body.months.map((m: any) => [m.label, m.from, m.to])).toEqual([
      ['Aug', '2026-08-01', '2026-08-31'], ['Sep', '2026-09-01', '2026-09-30'], ['Oct', '2026-10-01', '2026-10-17'],
    ]);
    const table = (await get('profit-by-product', ownerA, '2026-10-01', '2026-10-17')).body.products[0];
    const copybook = res.body.products.find((p: any) => p.productId === copybookId);
    expect(copybook.profits).toEqual(['0.00', '0.00', table.profit]);
    expect(copybook.profits[2]).toBe('67800.00');
    // tenant B's order never shows in A's trend
    expect(JSON.stringify(res.body)).not.toContain('BCOPY');
  });

  it('trend: a month with a missing cost has null profit; bad months or asOf is a 400', async () => {
    const nov = (await request(app).get('/api/financial/profit-by-product/trend?months=1&asOf=2026-11-30').set(auth(ownerA))).body;
    expect(nov.products.find((p: any) => p.name === 'PENS').profits).toEqual([null]);
    expect((await request(app).get('/api/financial/profit-by-product/trend?months=0').set(auth(ownerA))).status).toBe(400);
    expect((await request(app).get('/api/financial/profit-by-product/trend?asOf=nope').set(auth(ownerA))).status).toBe(400);
  });
});

describe('F-925 order cohort card', () => {
  it('projects profit at the yield of the closed cohorts', async () => {
    // Placed 2-3 Sep: 10 orders, 3 delivered (200 each, fee 25, cost 30), 7 cancelled. Yield 30%. 100 of Meta in the range.
    const day = (n: number) => new Date(`2026-09-0${n}T10:00:00Z`);
    const delivered: number[] = [];
    for (let i = 0; i < 3; i++) delivered.push(await mkOrder(worldA, logiswift, 'delivered', { total: 200, createdAt: day(2), deliveryDate: day(3), deliveryFee: 25, landedCostTotal: 30 }));
    for (let i = 0; i < 7; i++) await mkOrder(worldA, logiswift, 'cancelled', { total: 200, createdAt: day(3) });
    for (const orderId of delivered) {
      await prismaBase.commissionEntry.create({ data: { tenantId: a, orderId, userId: ownerA.id, kind: 'base', status: 'earned', amount: 10 } });
    }
    await postEntry(a, ownerA.id, '2026-09-05', [['5080', 100, 0], ['1010', 0, 100]]);

    const res = await get('cohort-profit', ownerA, '2026-09-01', '2026-09-30');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: true, yieldPct: 30, yieldLabel: 'Projected at 30% yield', ordersPlaced: 10, projectedDelivered: 3,
      revenue: '600.00', productCost: '90.00', fees: '75.00', repCommission: '30.00', metaAds: '100.00',
      profitBeforeOtherExpenses: '305.00', marginPct: 50.8, profitPerDeliveredOrder: '101.67',
    });
    expect(res.body.byOrderCohort).toBeUndefined();
    expect(res.body.byDeliveryDate).toBe('-100.00'); // nothing booked in revenue that month, only the 100 of ads
  });

  it('no closed cohort gives "Not enough closed orders" and no number', async () => {
    await mkOrder(worldA, logiswift, 'pending_confirmation', { total: 100, createdAt: new Date() });
    const now = new Date().toISOString().slice(0, 10);
    const open = await get('cohort-profit', ownerA, now, now);
    expect(open.body).toMatchObject({ available: false, message: 'Not enough closed orders' });
    expect(open.body.revenue).toBeUndefined();
    const emptyTenant = await get('cohort-profit', ownerB, '2019-01-01', '2019-01-31');
    expect(emptyTenant.body.available).toBe(false);
  });

  it('a closed cohort with nothing delivered has no number to project from', async () => {
    await mkOrder(worldA, logiswift, 'cancelled', { total: 100, createdAt: new Date('2026-08-03T10:00:00Z') });
    const res = await get('cohort-profit', ownerA, '2026-08-01', '2026-08-31');
    // yield is 0 and there is no delivered order to average: no number is better than a made-up one
    expect(res.body.available).toBe(false);
  });
});

describe('F-926 and F-721 cost of failed deliveries', () => {
  const fail = async (partnerId: number) => {
    const id = await mkOrder(worldA, partnerId, 'out_for_delivery', { total: 200 });
    await runInTenant(a, () => transitionOrder(id, 'failed_delivery', ADMIN));
    return id;
  };

  beforeAll(async () => {
    for (let i = 0; i < 70; i++) await fail(kofi);
    for (let i = 0; i < 22; i++) await fail(kwesi);
    for (let i = 0; i < 5; i++) await fail(logiswift);
    // Logiswift sent 41 copybook sets back and we received 36; the 3PL location is the partner's
    const loc = await prismaBase.stockLocation.create({ data: { tenantId: a, type: 'partner_3pl', name: 'Logiswift', userId: logiswift } });
    await prismaBase.inventoryTransfer.create({ data: {
      tenantId: a, productId: copybookId, quantity: 41, transferType: 'return_to_warehouse', fromLocationId: loc.id, status: 'disputed',
      receivedQuantity: 36, receivedAt: new Date(), reason: 'not_received', createdById: ownerA.id,
    } });
  });

  it('fixture: GH₵610 = 460 fees + 150 lost units', async () => {
    const res = await get('failed-delivery-cost', ownerA, '2026-01-01', '2099-12-31');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fees: '460.00', unitsLost: 5, lostCost: '150.00', total: '610.00' });
    const by = (id: number) => res.body.partners.find((p: any) => p.partnerId === id);
    expect(by(kofi)).toMatchObject({ failedOrders: 70, fees: '350.00', total: '350.00' });
    expect(by(kwesi)).toMatchObject({ failedOrders: 22, fees: '110.00' });
    expect(by(logiswift)).toMatchObject({ failedOrders: 5, fees: '0.00', unitsLost: 5, lostCost: '150.00', total: '150.00' });
  });

  it('a partner with no fee rule shows fee 0 and a hint', async () => {
    await fail(noRule);
    const res = await get('failed-delivery-cost', ownerA, '2026-01-01', '2099-12-31');
    const row = res.body.partners.find((p: any) => p.partnerId === noRule);
    expect(row).toMatchObject({ fees: '0.00', total: '0.00' });
    expect(row.hint).toMatch(/no fee rule/i);
    expect(res.body.partners.find((p: any) => p.partnerId === kofi).hint).toBeNull();
  });

  it('an empty range and the other tenant give zeros', async () => {
    expect((await get('failed-delivery-cost', ownerA, '2019-01-01', '2019-01-31')).body).toMatchObject({ partners: [], total: '0.00', unitsLost: 0 });
    expect((await get('failed-delivery-cost', ownerB, '2026-01-01', '2099-12-31')).body).toMatchObject({ partners: [], total: '0.00' });
  });

  it('refusalCost: stamped failed fee plus lost units at landed cost; no fee rule gives 0', async () => {
    const kofiOrder = await prismaBase.order.findFirstOrThrow({ where: { tenantId: a, deliveryAgentId: kofi, status: 'failed_delivery' } });
    await runInTenant(a, async () => {
      expect(await refusalCost(kofiOrder)).toMatchObject({ failedFee: '5.00', unitsLost: 0, lostCost: '0.00', total: '5.00' });
      const lsOrder = await prismaBase.order.findFirstOrThrow({ where: { tenantId: a, deliveryAgentId: logiswift, status: 'failed_delivery' } });
      expect((await refusalCost(lsOrder)).total).toBe('0.00'); // Logiswift: failed fee 0
      const bare = await mkOrder(worldA, noRule, 'failed_delivery', { total: 200 });
      expect((await refusalCost({ id: bare, deliveryAgentId: noRule, deliveryFee: null, totalAmount: 200 })).failedFee).toBe('0.00');
      // fee not stamped yet: the partner's failed rule in force is read
      expect((await refusalCost({ id: bare, deliveryAgentId: kwesi, deliveryFee: null, totalAmount: 200 })).failedFee).toBe('5.00');
      // a return of this order is short by 2 sets
      await prismaBase.inventoryTransfer.create({ data: { tenantId: a, productId: copybookId, orderId: bare, quantity: 3, receivedQuantity: 1, transferType: 'return_to_warehouse', status: 'disputed', createdById: ownerA.id } });
      expect(await refusalCost({ id: bare, deliveryAgentId: kwesi, deliveryFee: 5 })).toMatchObject({ failedFee: '5.00', unitsLost: 2, landedCostPerUnit: '30.00', lostCost: '60.00', total: '65.00' });
    });
  });
});
