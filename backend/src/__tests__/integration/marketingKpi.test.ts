/**
 * M8-T10 (COD-73): max CPA and the marketing tiles on seeded orders. Fixture: GH₵249 order, GH₵30 landed cost, GH₵34 fee,
 * 34% yield, NGN ad account at 112: profit GH₵185 = ₦20,720, max CPA GH₵62.90 = ₦7,040.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { mkCustomer } from './helpers/settlementFixtures';
import { postMetaSpend } from '../../services/marketing/metaLedgerService';
import { maxCpa, tiles, NO_ROOM_FOR_ADS } from '../../services/marketing/marketingKpiService';
import { utcDateOfYmd } from '../../services/kpi/dates';

jest.setTimeout(240_000);

let a: string;
let b: string;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let repA: { id: number; token: string };
let p1: number;
let p2: number;
let p4: number;
let account: number;

const inA = <T>(fn: () => Promise<T>) => runInTenant(a, fn);
const mkProduct = (tenantId: string, sku: string, cogs: number) =>
  prismaBase.product.create({ data: { tenantId, sku, name: sku, category: 'test', price: 100, stockQuantity: 0, cogs } }).then((p) => p.id);
const at = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const spendRow = (tenantId: string, accountId: number, ymd: string, campaign: string, spend: number) =>
  prismaBase.metaSpendDay.create({ data: { adAccountId: accountId, campaignId: campaign, campaignName: campaign, date: utcDateOfYmd(ymd), currency: 'NGN', spend, pulledAt: new Date(), tenantId } });
/** Orders of one product with the PRD numbers (total 249, fee 34, landed cost 30), created on `ymd`. */
async function seedOrders(tenantId: string, customerId: number, productId: number, ymd: string, status: 'delivered' | 'failed_delivery' | 'cancelled', count: number, opts: { total?: number } = {}) {
  const total = opts.total ?? 249;
  await prismaBase.order.createMany({
    data: Array.from({ length: count }, () => ({
      customerId, tenantId, status, subtotal: total, totalAmount: total, codAmount: total, createdAt: at(ymd),
      deliveryFee: 34, landedCostTotal: 30, ...(status === 'delivered' ? { deliveryDate: at(ymd) } : {}),
    })),
  });
  const ids = (await prismaBase.order.findMany({ where: { tenantId, status, createdAt: at(ymd), totalAmount: total }, select: { id: true }, orderBy: { id: 'desc' }, take: count })).map((o) => o.id);
  await prismaBase.orderItem.createMany({ data: ids.map((orderId) => ({ orderId, productId, quantity: 1, unitPrice: total, totalPrice: total })) });
  return ids;
}

beforeAll(async () => {
  a = (await createTenant('Mkt KPI A', { currency: 'GHS' })).id;
  b = (await createTenant('Mkt KPI B', { currency: 'GHS' })).id;
  await Promise.all([seedTenantDefaults(a), seedTenantDefaults(b)]);
  ownerA = await mkUser(a, 'ownerA', 'super_admin');
  ownerB = await mkUser(b, 'ownerB', 'super_admin');
  repA = await mkUser(a, 'repA', 'sales_rep');
  const [custA, custB] = await Promise.all([mkCustomer(a, '+233241100001'), mkCustomer(b, '+233241100002')]);
  [p1, p2, p4] = await Promise.all([mkProduct(a, 'P1', 10), mkProduct(a, 'P2', 20), mkProduct(a, 'P4', 10)]);
  account = (await prismaBase.metaAdAccount.create({ data: { accountId: 'act_kpi', name: 'NGN acct', currency: 'NGN', timezone: 'UTC', accessToken: 'x', tenantId: a } })).id;
  await prismaBase.fxRate.create({ data: { tenantId: a, fromCurrency: 'GHS', toCurrency: 'NGN', rate: 112, date: utcDateOfYmd('2026-10-01'), source: 'manual' } });

  // Cohort for a range ending 2026-11-10: 2026-07-14 to 2026-10-11. 100 orders placed: 33 + 1 delivered, 40 failed, 26 cancelled.
  await seedOrders(a, custA, p1, '2026-09-01', 'delivered', 33);
  await seedOrders(a, custA, p1, '2026-09-02', 'failed_delivery', 40);
  await seedOrders(a, custA, p1, '2026-09-03', 'cancelled', 26);
  // One delivered order with two products: P2 GH₵149 and P4 GH₵100. Landed cost 30 is split by item cost (20 : 10), the fee 34 by value.
  const mixed = (await seedOrders(a, custA, p2, '2026-09-04', 'delivered', 1))[0];
  await prismaBase.orderItem.deleteMany({ where: { orderId: mixed } });
  await prismaBase.orderItem.createMany({ data: [
    { orderId: mixed, productId: p2, quantity: 1, unitPrice: 149, totalPrice: 149 },
    { orderId: mixed, productId: p4, quantity: 1, unitPrice: 100, totalPrice: 100 },
  ] });
  // Left out of the cohort: placed inside the range (too new; it counts in the Nov tiles), and a digital order
  await seedOrders(a, custA, p1, '2026-11-05', 'delivered', 1, { total: 999 });
  await prismaBase.order.create({ data: { customerId: custA, tenantId: a, status: 'digital_delivered', subtotal: 5, totalAmount: 5, codAmount: 0, createdAt: at('2026-09-05') } });
  // Tenant B: one big delivered order that must never reach A
  await seedOrders(b, custB, await mkProduct(b, 'BP', 1), '2026-09-01', 'delivered', 1, { total: 5000 });

  // Tiles fixture: range 2026-11-01 to 2026-11-10
  await prismaBase.order.createMany({ data: [
    ...(['delivered', 'delivered', 'confirmed', 'pending_confirmation', 'cancelled', 'payment_pending'] as const).map((status) => ({
      customerId: custA, tenantId: a, status, subtotal: 100, totalAmount: 100, codAmount: 100, createdAt: at('2026-11-03'),
      ...(status === 'delivered' ? { deliveryDate: at('2026-11-06') } : {}),
    })),
  ] });
  await spendRow(a, account, '2026-11-02', 'c1', 100000);
  await spendRow(a, account, '2026-11-02', 'c2', 20000);
  await spendRow(a, account, '2026-11-05', 'c1', 50000);
  await spendRow(a, account, '2026-10-25', 'c1', 10000);
  await runInTenant(a, () => postMetaSpend(account, ['2026-11-02', '2026-11-05', '2026-10-25']));
});

afterAll(async () => {
  await prismaBase.expense.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await deleteTenantRows([a, b]);
  await prismaBase.$disconnect();
});

describe('max CPA', () => {
  it('account level: GH₵185 profit at 34% yield gives GH₵62.90, shown as ₦7,040 at rate 112', async () => {
    const r = await inA(() => maxCpa({ to: '2026-11-10' }));
    expect(r).toMatchObject({ available: true, yieldPct: 34, message: null, closedOrders: 74 });
    expect(r.profitBeforeAds).toMatchObject({ store: '185.00', account: '20720.00', accountCurrency: 'NGN', rate: '112.0000' });
    expect(r.maxCpa).toMatchObject({ store: '62.90', account: '7040.00', accountCurrency: 'NGN', rate: '112.0000' });
  });

  it('per product: the share of a two-product order, and the yield of the orders holding the product', async () => {
    const r = await inA(() => maxCpa({ to: '2026-11-10', productId: p2 }));
    // P2 revenue 149, cost 30 x 20/30 = 20, fee 34 x 149/249 = 20.3454; one of one placed delivered
    expect(r).toMatchObject({ available: true, yieldPct: 100 });
    expect(r.profitBeforeAds?.store).toBe('108.65');
    const one = await inA(() => maxCpa({ to: '2026-11-10', productId: p1 }));
    expect(one).toMatchObject({ yieldPct: 33.3, closedOrders: 73 });
    expect(one.profitBeforeAds?.store).toBe('185.00');
  });

  it('no closed cohort gives "Not enough closed orders" and no number', async () => {
    const r = await inA(() => maxCpa({ to: '2026-03-01' }));
    expect(r).toMatchObject({ available: false, yieldPct: null, profitBeforeAds: null, maxCpa: null, message: 'Not enough closed orders', closedOrders: 0 });
  });

  it('a product that costs more than it sells gives 0 and the no-room message', async () => {
    const cheap = await mkProduct(a, 'CHEAP', 30);
    const cust = await mkCustomer(a, '+233241100009');
    const ids = await seedOrders(a, cust, cheap, '2026-09-06', 'delivered', 1, { total: 50 });
    const r = await inA(() => maxCpa({ to: '2026-11-10', productId: cheap }));
    // Take the order out again: the tiles below use the account numbers of the main fixture
    await prismaBase.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prismaBase.order.deleteMany({ where: { id: { in: ids } } });
    expect(r).toMatchObject({ available: true, message: NO_ROOM_FOR_ADS });
    expect(r.maxCpa?.store).toBe('0.00');
  });
});

describe('tiles', () => {
  it('spend equals the 5080 ledger total, counts skip digital orders, and the cost per delivered tiles hold', async () => {
    const t = await inA(() => tiles({ from: '2026-11-01', to: '2026-11-10' }));
    const ledger = (await prismaBase.account.findFirstOrThrow({ where: { tenantId: a, code: '5080' } })).currentBalance;
    const prev = await inA(() => tiles({ from: '2026-10-22', to: '2026-10-31' }));
    // 120,000 / 112 = 1,071.43; 50,000 / 112 = 446.43; previous: 10,000 / 112 = 89.29
    expect(t.spend.store).toBe('1517.86');
    expect(t.spend).toMatchObject({ account: '170000.00', accountCurrency: 'NGN' });
    expect(prev.spend.store).toBe('89.29');
    expect(ledger.toFixed(2)).toBe('1607.15');
    expect(t).toMatchObject({ ordersPlaced: 6, confirmed: 4, delivered: 3, spendDaysWaitingForRate: 0 });
    expect(t.projectedCostPerDelivered.value?.store).toBe('744.05'); // 1,517.86 / (6 x 34%)
    expect(t.actualCostPerDelivered).toMatchObject({ label: 'Actual, delivered in range' });
    expect(t.actualCostPerDelivered.value?.store).toBe('505.95');
    expect(t.maxCpa.maxCpa?.account).toBe('7040.00');
  });

  it('previous period of the same length', async () => {
    const t = await inA(() => tiles({ from: '2026-11-01', to: '2026-11-10' }));
    expect(t.previous).toMatchObject({ from: '2026-10-22', to: '2026-10-31', ordersPlaced: 0, delivered: 0 });
    expect(t.previous.spend.store).toBe('89.29');
    expect(t.previous.projectedCostPerDelivered.value).toBeNull();
    expect(t.previous.actualCostPerDelivered.value).toBeNull();
  });
});

describe('GET /api/marketing/summary', () => {
  const get = (token: string, q = 'from=2026-11-01&to=2026-11-10') => request(app).get(`/api/marketing/summary?${q}`).set(bearer(token));

  it('returns the tiles and the account max CPA', async () => {
    const res = await get(ownerA.token);
    expect(res.status).toBe(200);
    expect(res.body.maxCpa.maxCpa.account).toBe('7040.00');
    expect(res.body.previous.from).toBe('2026-10-22');
    expect(JSON.stringify(res.body)).not.toContain('accessToken');
  });

  it('tenant B sees none of tenant A', async () => {
    const res = await get(ownerB.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ordersPlaced: 0, spend: { store: '0.00' } });
    expect(res.body.maxCpa.maxCpa.store).not.toBe('62.90'); // its own fixture (one GH₵5,000 order), never A's
  });

  it('a call rep gets 403 and a missing range gets 400', async () => {
    expect((await get(repA.token)).status).toBe(403);
    expect((await get(ownerA.token, 'from=2026-11-01')).status).toBe(400);
  });
});
