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
import { at, mkProduct, seedOrders, spendRow } from './helpers/marketingFixtures';

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
let c: string;
let accountC: number;

const inA = <T>(fn: () => Promise<T>) => runInTenant(a, fn);
beforeAll(async () => {
  a = (await createTenant('Mkt KPI A', { currency: 'GHS' })).id;
  b = (await createTenant('Mkt KPI B', { currency: 'GHS' })).id;
  c = (await createTenant('Mkt KPI C', { currency: 'GHS' })).id;
  await Promise.all([seedTenantDefaults(a), seedTenantDefaults(b), seedTenantDefaults(c)]);
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

  // Tenant C: the day rates (100, 120) differ from the spot rate on the range end (130)
  accountC = (await prismaBase.metaAdAccount.create({ data: { accountId: 'act_kpi_c', name: 'NGN acct C', currency: 'NGN', timezone: 'UTC', accessToken: 'x', tenantId: c } })).id;
  await prismaBase.fxRate.createMany({ data: [['2026-12-01', 100], ['2026-12-02', 120], ['2026-12-03', 130]].map(([d, rate]) => (
    { tenantId: c, fromCurrency: 'GHS', toCurrency: 'NGN', rate: rate as number, date: utcDateOfYmd(d as string), source: 'manual' as const }
  )) });
  await spendRow(c, accountC, '2026-12-01', 'c1', 100000);
  await spendRow(c, accountC, '2026-12-02', 'c1', 120000);
  const custC = await mkCustomer(c, '+233241100003');
  await prismaBase.order.createMany({ data: (['delivered', 'delivered', 'confirmed', 'pending_confirmation'] as const).map((status) => ({
    customerId: custC, tenantId: c, status, subtotal: 100, totalAmount: 100, codAmount: 100, createdAt: at('2026-12-02'),
    ...(status === 'delivered' ? { deliveryDate: at('2026-12-03') } : {}),
  })) });
});

afterAll(async () => {
  await prismaBase.expense.deleteMany({ where: { tenantId: { in: [a, b, c] } } });
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId: { in: [a, b, c] } } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: { in: [a, b, c] } } });
  await deleteTenantRows([a, b, c]);
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

describe('tiles with day rates that differ from the spot rate', () => {
  it('the account figures are the real sums, cost per order is that sum / count, and the shown rate is the one used', async () => {
    const t = await runInTenant(c, () => tiles({ from: '2026-12-01', to: '2026-12-03' }));
    // Store: 100,000 / 100 + 120,000 / 120 = 2,000. The spot rate on 12-03 is 130 and must not touch the figures.
    expect(t.spend).toMatchObject({ store: '2000.00', account: '220000.00', accountCurrency: 'NGN', rate: '110.0000' });
    expect(t.delivered).toBe(2);
    expect(t.actualCostPerDelivered.value).toMatchObject({ store: '1000.00', account: '110000.00', rate: '110.0000' });
    // 220,000 / (4 placed x yield); with no closed cohort the yield is unknown and the tile says so
    expect(t.projectedCostPerDelivered.value).toBeNull();
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
