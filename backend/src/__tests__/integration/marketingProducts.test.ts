/**
 * M8-T14 (COD-74): GET /api/marketing/products. One row per product with a mapped campaign in the range; the row equals the
 * product funnel and max CPA, spend is the sum of its campaigns, a call rep gets 403.
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
import { funnel } from '../../services/marketing/marketingFunnelService';
import { maxCpa } from '../../services/marketing/marketingKpiService';
import { mkProduct, seedOrders, spendRow } from './helpers/marketingFixtures';

jest.setTimeout(240_000);

let t: string;
let owner: { id: number; token: string };
let rep: { id: number; token: string };
let p1: number;
let p2: number;
let acct: number;

const R = { from: '2026-11-01', to: '2026-11-10' };
const QS = `from=${R.from}&to=${R.to}`;

beforeAll(async () => {
  t = (await createTenant('Mkt Products', { currency: 'GHS' })).id;
  await seedTenantDefaults(t);
  owner = await mkUser(t, 'owner', 'super_admin');
  rep = await mkUser(t, 'rep', 'sales_rep');
  const cust = await mkCustomer(t, '+233241300001');
  [p1, p2] = await Promise.all([mkProduct(t, 'PP1', 10), mkProduct(t, 'PP2', 10)]);
  acct = (await prismaBase.metaAdAccount.create({ data: { accountId: 'act_p', name: 'act_p', currency: 'NGN', timezone: 'UTC', accessToken: 'x', tenantId: t } })).id;
  await prismaBase.fxRate.create({ data: { tenantId: t, fromCurrency: 'GHS', toCurrency: 'NGN', rate: 112, date: utcDateOfYmd('2026-10-01'), source: 'manual' } });

  await seedOrders(t, cust, p1, '2026-09-01', 'delivered', 33);
  await seedOrders(t, cust, p1, '2026-09-02', 'failed_delivery', 40);
  await seedOrders(t, cust, p1, '2026-09-03', 'cancelled', 26);
  await seedOrders(t, cust, p1, '2026-11-03', 'delivered', 2);
  await seedOrders(t, cust, p1, '2026-11-03', 'confirmed', 1);
  await seedOrders(t, cust, p1, '2026-11-04', 'pending_confirmation', 1);

  await prismaBase.metaCampaignMapping.createMany({ data: [{ kind: 'prefix', prefix: 'MG_', productId: p1, tenantId: t }, { kind: 'prefix', prefix: 'P2_', productId: p2, tenantId: t }] });
  await spendRow(t, acct, '2026-11-02', 'MG_a', 100000, { purchases: 20, campaignStatus: 'ACTIVE' });
  await spendRow(t, acct, '2026-11-02', 'MG_b', 11200, { purchases: 5, campaignStatus: 'ACTIVE' });
  await spendRow(t, acct, '2026-11-02', 'XX_unmapped', 22400, { purchases: 4, campaignStatus: 'ACTIVE' });
  await spendRow(t, acct, '2026-10-20', 'P2_old', 5000); // outside the range: P2 has no row
});

afterAll(async () => {
  await prismaBase.metaCampaignMapping.deleteMany({ where: { tenantId: t } });
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId: t } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: t } });
  await deleteTenantRows([t]);
  await prismaBase.$disconnect();
});

describe('GET /api/marketing/products', () => {
  it('returns one row per product with spend in range, equal to its funnel and max CPA', async () => {
    const res = await request(app).get(`/api/marketing/products?${QS}`).set(bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(1); // P2 only has spend outside the range; the unmapped campaign is no product
    const row = res.body.products[0];
    const [f, max] = await runInTenant(t, () => Promise.all([funnel({ ...R, productId: p1 }), maxCpa({ to: R.to, productId: p1 })]));
    expect(row.product).toEqual({ id: p1, name: 'PP1', archived: false });
    expect(row).toMatchObject({ ordersPlaced: f.ordersPlaced, confirmed: f.confirmed, delivered: f.delivered, purchases: 25, yieldPct: max.yieldPct, lowData: false });
    expect(row.ordersPlaced).toBe(4);
    expect(row.maxCpa).toEqual(max);
    // 111,200 NGN at 112 = GH₵992.86; 992.86 over 4 placed orders = 248.215, rounded up (campaign amounts are summed at 2 dp)
    expect(row.spend).toMatchObject({ store: '992.86', account: '111200.00', accountCurrency: 'NGN' });
    expect(row.costPerPlaced.store).toBe('248.22');
  });

  it('a call rep gets 403 and a bad range gets 400', async () => {
    expect((await request(app).get(`/api/marketing/products?${QS}`).set(bearer(rep.token))).status).toBe(403);
    expect((await request(app).get('/api/marketing/products?from=2026-11-10&to=2026-11-01').set(bearer(owner.token))).status).toBe(400);
  });
});
