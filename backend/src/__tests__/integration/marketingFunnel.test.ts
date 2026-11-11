/**
 * M8-T11 (COD-73): funnel, campaign table and status on seeded rows. NGN ad account at 112 per GH₵; product P1 has the PRD
 * order (GH₵249, cost 30, fee 34) and 99 placed / 33 delivered in its cohort, so its max CPA is GH₵185 x 33.3% = GH₵61.605.
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
import { utcDateOfYmd } from '../../services/kpi/dates';
import { funnel, campaigns } from '../../services/marketing/marketingFunnelService';
import { mkProduct, seedOrders, spendRow } from './helpers/marketingFixtures';

jest.setTimeout(240_000);

let a: string;
let b: string;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let repA: { id: number; token: string };
let p1: number;
let p2: number;
let acctA: number;

const R = { from: '2026-11-01', to: '2026-11-10' };
const inA = <T>(fn: () => Promise<T>) => runInTenant(a, fn);
const rule = (tenantId: string, prefix: string, productId: number) => prismaBase.metaCampaignMapping.create({ data: { kind: 'prefix', prefix, productId, tenantId } });
const mkAccount = (tenantId: string, accountId: string) => prismaBase.metaAdAccount.create({ data: { accountId, name: accountId, currency: 'NGN', timezone: 'UTC', accessToken: 'x', tenantId } }).then((x) => x.id);
const mkRate = (tenantId: string) => prismaBase.fxRate.create({ data: { tenantId, fromCurrency: 'GHS', toCurrency: 'NGN', rate: 112, date: utcDateOfYmd('2026-10-01'), source: 'manual' } });

beforeAll(async () => {
  a = (await createTenant('Mkt Funnel A', { currency: 'GHS' })).id;
  b = (await createTenant('Mkt Funnel B', { currency: 'GHS' })).id;
  await Promise.all([seedTenantDefaults(a), seedTenantDefaults(b)]);
  ownerA = await mkUser(a, 'ownerA', 'super_admin');
  ownerB = await mkUser(b, 'ownerB', 'super_admin');
  repA = await mkUser(a, 'repA', 'sales_rep');
  const [custA, custB] = await Promise.all([mkCustomer(a, '+233241200001'), mkCustomer(b, '+233241200002')]);
  [p1, p2] = await Promise.all([mkProduct(a, 'P1', 10), mkProduct(a, 'P2', 10)]);
  const [low, high] = await Promise.all([mkProduct(a, 'LOW', 10), mkProduct(a, 'HIGH', 10)]);
  [acctA] = await Promise.all([mkAccount(a, 'act_a')]);
  const acctB = await mkAccount(b, 'act_b');
  await Promise.all([mkRate(a), mkRate(b)]);

  // P1 cohort (range ending 2026-11-10 uses 2026-07-14 to 2026-10-11): 99 placed, 33 delivered, 40 failed, 26 cancelled
  await seedOrders(a, custA, p1, '2026-09-01', 'delivered', 33);
  await seedOrders(a, custA, p1, '2026-09-02', 'failed_delivery', 40);
  await seedOrders(a, custA, p1, '2026-09-03', 'cancelled', 26);
  // 29 and 30 closed orders
  await seedOrders(a, custA, low, '2026-09-04', 'delivered', 29);
  await seedOrders(a, custA, high, '2026-09-05', 'delivered', 30);
  // Orders in the range: P1 gets 2 delivered, 1 confirmed, 1 pending; P2 gets 1 delivered; a digital order is not counted
  await seedOrders(a, custA, p1, '2026-11-03', 'delivered', 2);
  await seedOrders(a, custA, p1, '2026-11-03', 'confirmed', 1);
  await seedOrders(a, custA, p1, '2026-11-04', 'pending_confirmation', 1);
  await seedOrders(a, custA, p2, '2026-11-04', 'delivered', 1);
  await prismaBase.order.create({ data: { customerId: custA, tenantId: a, status: 'digital_delivered', subtotal: 5, totalAmount: 5, codAmount: 0, createdAt: new Date('2026-11-04T12:00:00Z') } });

  await Promise.all([rule(a, 'MG_', p1), rule(a, 'LO_', low), rule(a, 'HI_', high), rule(a, 'P2_', p2)]);
  // Campaigns (NGN; 112 per GH₵; max CPA of P1 GH₵61.605, so Winning <= 52.36, On track <= 61.605)
  const m = { impressions: 1000, linkClicks: 100, landingPageViews: 80, checkoutsStarted: 20 };
  await spendRow(a, acctA, '2026-11-02', 'MG_win', 100000, { ...m, purchases: 20, campaignStatus: 'ACTIVE' }); // 892.857 / 20 = 44.64
  await spendRow(a, acctA, '2026-11-03', 'MG_win', 0, { campaignStatus: 'ACTIVE' });
  await spendRow(a, acctA, '2026-11-02', 'MG_ontrack', 62720, { ...m, purchases: 10, campaignStatus: 'ACTIVE' }); // 560 / 10 = 56
  await spendRow(a, acctA, '2026-11-02', 'MG_over', 100000, { ...m, purchases: 10, campaignStatus: 'ACTIVE' }); // 89.29
  await spendRow(a, acctA, '2026-11-02', 'MG_nobuy', 5000, { ...m, campaignStatus: 'ACTIVE' });
  await spendRow(a, acctA, '2026-11-02', 'MG_paused', 11200, { ...m, purchases: 5, campaignStatus: 'ACTIVE' });
  await spendRow(a, acctA, '2026-11-05', 'MG_paused', 0, { campaignStatus: 'PAUSED' }); // the latest status wins
  await spendRow(a, acctA, '2026-11-02', 'XX_unmapped', 22400, { ...m, purchases: 4, campaignStatus: 'ACTIVE' });
  await spendRow(a, acctA, '2026-11-02', 'LO_one', 11200, { purchases: 1, campaignStatus: 'ACTIVE' });
  await spendRow(a, acctA, '2026-11-02', 'HI_one', 11200, { purchases: 1, campaignStatus: 'ACTIVE' });
  await spendRow(a, acctA, '2026-11-02', 'P2_one', 11200, { purchases: 1, campaignStatus: 'ACTIVE' }); // P2 has one placed order: yield 100%, but no closed cohort yet
  await spendRow(a, acctA, '2026-10-20', 'MG_old', 99999); // outside the range

  // Tenant B: its own campaign, orders and a mapping rule with the same prefix
  const pb = await mkProduct(b, 'BP', 1);
  await rule(b, 'MG_', pb);
  await spendRow(b, acctB, '2026-11-02', 'MG_tenantB_secret', 777000, { purchases: 3, impressions: 424242 });
  await seedOrders(b, custB, pb, '2026-11-03', 'delivered', 3, { total: 5000 });
});

afterAll(async () => {
  await prismaBase.metaCampaignMapping.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await deleteTenantRows([a, b]);
  await prismaBase.$disconnect();
});

describe('funnel', () => {
  it('overall: every campaign (unmapped too) and every non-digital order of the range', async () => {
    const f = await inA(() => funnel(R));
    // 10 campaigns with Meta counts: MG_win, MG_ontrack, MG_over, MG_nobuy, MG_paused, XX_unmapped at 1000 each
    expect(f).toMatchObject({ impressions: 6000, linkClicks: 600, landingPageViews: 480, checkoutsStarted: 120, productId: null });
    expect(f).toMatchObject({ ordersPlaced: 5, confirmed: 4, delivered: 3 });
  });

  it('per product: its campaigns and the orders that hold it', async () => {
    const f = await inA(() => funnel({ ...R, productId: p1 }));
    expect(f).toMatchObject({ impressions: 5000, linkClicks: 500, landingPageViews: 400, checkoutsStarted: 100, productId: p1 });
    expect(f).toMatchObject({ ordersPlaced: 4, confirmed: 3, delivered: 2 });
  });
});

describe('campaigns', () => {
  const byName = (rows: Array<{ campaignName: string }>, name: string) => rows.find((r) => r.campaignName === name) as any;

  it('status, CPA in both currencies, projected delivered and max CPA per campaign', async () => {
    const { campaigns: rows } = await inA(() => campaigns(R));
    const win = byName(rows, 'MG_win');
    expect(win).toMatchObject({ status: 'Winning', purchases: 20, projectedDelivered: 6.7, projectedDeliveredLabel: 'Meta purchases', lowData: false });
    expect(win.spend).toMatchObject({ store: '892.86', account: '100000.00', accountCurrency: 'NGN' });
    expect(win.cpa).toMatchObject({ store: '44.64', account: '5000.00' });
    expect(win.maxCpa).toMatchObject({ available: true, yieldPct: 33.3, closedOrders: 73 });
    expect(win.maxCpa.maxCpa).toMatchObject({ store: '61.61', account: '6900.00' }); // GH₵185 x 33.3% = 61.605; x 112 = 6,899.76
    expect(win.product).toMatchObject({ id: p1, name: 'P1' });
    expect(byName(rows, 'MG_ontrack').status).toBe('On track');
    expect(byName(rows, 'MG_over').status).toBe('Over max CPA');
    expect(byName(rows, 'MG_nobuy')).toMatchObject({ status: 'Over max CPA', cpa: null, projectedDelivered: 0 });
    expect(byName(rows, 'MG_paused').status).toBe('Paused'); // the latest Meta status is PAUSED, whatever the CPA
    expect(byName(rows, 'XX_unmapped')).toMatchObject({ status: 'Not mapped', product: null, maxCpa: null, projectedDelivered: null });
    expect(rows.find((r) => r.campaignName === 'MG_old')).toBeUndefined();
  });

  it('a product with no closed cohort of its own has no status and says why', async () => {
    const { campaigns: rows } = await inA(() => campaigns(R));
    const p2row = byName(rows, 'P2_one');
    expect(p2row).toMatchObject({ status: null, projectedDelivered: null, lowData: true });
    expect(p2row.maxCpa).toMatchObject({ available: false, message: 'Not enough closed orders' });
  });

  it('low data is on at 29 closed orders and off at 30', async () => {
    const { campaigns: rows } = await inA(() => campaigns(R));
    expect(byName(rows, 'LO_one')).toMatchObject({ lowData: true });
    expect(byName(rows, 'LO_one').maxCpa.closedOrders).toBe(29);
    expect(byName(rows, 'HI_one')).toMatchObject({ lowData: false });
    expect(byName(rows, 'HI_one').maxCpa.closedOrders).toBe(30);
    expect(byName(rows, 'MG_win').lowData).toBe(false);
  });

  it('the totals row holds every campaign, unmapped spend included', async () => {
    const { campaigns: rows, totals } = await inA(() => campaigns(R));
    // 100000 + 62720 + 100000 + 5000 + 11200 + 22400 + 11200 + 11200 + 11200 = 334,920 NGN
    expect(totals.spend).toMatchObject({ store: '2990.36', account: '334920.00', accountCurrency: 'NGN' });
    expect(totals.purchases).toBe(20 + 10 + 10 + 5 + 4 + 1 + 1 + 1);
    expect(totals.impressions).toBe(6000);
    expect(rows).toHaveLength(9);
    expect(totals.projectedDeliveredLabel).toBe('Meta purchases');
  });
});

describe('routes', () => {
  const get = (path: string, token: string, q = 'from=2026-11-01&to=2026-11-10') => request(app).get(`/api/marketing/${path}?${q}`).set(bearer(token));

  it('GET /funnel and GET /campaigns/performance answer the view role', async () => {
    const f = await get('funnel', ownerA.token, 'from=2026-11-01&to=2026-11-10&productId=' + p1);
    expect(f.status).toBe(200);
    expect(f.body).toMatchObject({ ordersPlaced: 4, productId: p1 });
    const c = await get('campaigns/performance', ownerA.token);
    expect(c.status).toBe(200);
    expect(c.body.campaigns).toHaveLength(9);
  });

  it('the existing /campaigns route keeps its shape', async () => {
    const res = await get('campaigns', ownerA.token);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['campaigns']);
  });

  it('tenant B rows never reach tenant A, and tenant A rows never reach tenant B', async () => {
    const [fa, ca] = [await get('funnel', ownerA.token), await get('campaigns/performance', ownerA.token)];
    expect(JSON.stringify([fa.body, ca.body])).not.toMatch(/tenantB_secret|424242|777000/);
    const [fb, cb] = [await get('funnel', ownerB.token), await get('campaigns/performance', ownerB.token)];
    expect(fb.body).toMatchObject({ impressions: 424242, ordersPlaced: 3 });
    expect(cb.body.campaigns.map((r: any) => r.campaignName)).toEqual(['MG_tenantB_secret']);
    expect(cb.body.campaigns[0].product.name).toBe('BP');
  });

  it('a call rep gets 403 on both; a bad range or product id gets 400', async () => {
    expect((await get('funnel', repA.token)).status).toBe(403);
    expect((await get('campaigns/performance', repA.token)).status).toBe(403);
    expect((await get('funnel', ownerA.token, 'from=2026-11-10&to=2026-11-01')).status).toBe(400);
    expect((await get('funnel', ownerA.token, 'from=2026-11-01&to=2026-11-10&productId=abc')).status).toBe(400);
  });
});
