/**
 * M8 (COD-74): daily spend vs orders. Tenant D: GHS store, NGN account, rate 100 on 12-01 and 125 on 12-02 (it stays 125 on 12-03).
 *   12-01  100,000 NGN at 100 = 1,000.00 GHS, 4 orders  -> ₦25,000 per order
 *   12-02  250,000 NGN at 125 = 2,000.00 GHS, 5 orders  -> ₦50,000 per order
 *   12-03   60,000 NGN at 125 =   480.00 GHS, 0 orders  -> no cost per order
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
import { daily, tiles } from '../../services/marketing/marketingKpiService';
import { utcDateOfYmd } from '../../services/kpi/dates';
import { at, mkProduct, seedOrders, spendRow } from './helpers/marketingFixtures';

jest.setTimeout(240_000);

let d: string;
let b: string;
let e: string;
let ownerD: { id: number; token: string };
let ownerB: { id: number; token: string };
let repD: { id: number; token: string };

const inD = <T>(fn: () => Promise<T>) => runInTenant(d, fn);

beforeAll(async () => {
  d = (await createTenant('Mkt Daily D', { currency: 'GHS' })).id;
  b = (await createTenant('Mkt Daily B', { currency: 'GHS' })).id;
  e = (await createTenant('Mkt Daily E', { currency: 'GHS' })).id;
  await Promise.all([seedTenantDefaults(d), seedTenantDefaults(b), seedTenantDefaults(e)]);
  ownerD = await mkUser(d, 'ownerD', 'super_admin');
  ownerB = await mkUser(b, 'ownerB', 'super_admin');
  repD = await mkUser(d, 'repD', 'sales_rep');
  const [custD, custB, custE] = await Promise.all([mkCustomer(d, '+233241200001'), mkCustomer(b, '+233241200002'), mkCustomer(e, '+233241200003')]);
  const [pD, pB, pE] = await Promise.all([mkProduct(d, 'PD', 10), mkProduct(b, 'PB', 10), mkProduct(e, 'PE', 10)]);
  const mkAccount = (tenantId: string, accountId: string) =>
    prismaBase.metaAdAccount.create({ data: { accountId, name: accountId, currency: 'NGN', timezone: 'UTC', accessToken: 'x', tenantId } }).then((a) => a.id);
  const [accD, accB, accE] = await Promise.all([mkAccount(d, 'act_daily_d'), mkAccount(b, 'act_daily_b'), mkAccount(e, 'act_daily_e')]);
  await prismaBase.fxRate.createMany({ data: [['2026-12-01', 100], ['2026-12-02', 125]].map(([date, rate]) => (
    { tenantId: d, fromCurrency: 'GHS', toCurrency: 'NGN', rate: rate as number, date: utcDateOfYmd(date as string), source: 'manual' as const }
  )) });

  await spendRow(d, accD, '2026-12-01', 'c1', 60000);
  await spendRow(d, accD, '2026-12-01', 'c2', 40000);
  await spendRow(d, accD, '2026-12-02', 'c1', 250000);
  await spendRow(d, accD, '2026-12-03', 'c1', 60000);
  await seedOrders(d, custD, pD, '2026-12-01', 'confirmed', 4);
  await seedOrders(d, custD, pD, '2026-12-02', 'pending_confirmation', 5);
  // Left out: a digital order on 12-01, an order on 12-04 (outside the range) and a deleted order
  await prismaBase.order.create({ data: { customerId: custD, tenantId: d, status: 'digital_delivered', subtotal: 5, totalAmount: 5, codAmount: 0, createdAt: at('2026-12-01') } });
  await seedOrders(d, custD, pD, '2026-12-04', 'confirmed', 2);
  await prismaBase.order.create({ data: { customerId: custD, tenantId: d, status: 'confirmed', subtotal: 5, totalAmount: 5, codAmount: 5, createdAt: at('2026-12-02'), deletedAt: new Date() } });

  // Tenant B: spend and orders on the same days that must never reach D
  await spendRow(b, accB, '2026-12-01', 'c1', 999999);
  await seedOrders(b, custB, pB, '2026-12-01', 'confirmed', 7);
  // Tenant E: spend with no FX rate at all
  await spendRow(e, accE, '2026-12-01', 'c1', 5000);
  await seedOrders(e, custE, pE, '2026-12-01', 'confirmed', 2);
});

afterAll(async () => {
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId: { in: [d, b, e] } } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: { in: [d, b, e] } } });
  await deleteTenantRows([d, b, e]);
  await prismaBase.$disconnect();
});

describe('daily()', () => {
  it('one row per day at that day rate, orders by store day, best, worst and average exact', async () => {
    const r = await inD(() => daily({ from: '2026-12-01', to: '2026-12-03' }));
    expect(r.days.map((x) => x.date)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
    expect(r.days[0]).toMatchObject({ ordersPlaced: 4, waitingForRate: false, spend: { store: '1000.00', account: '100000.00', accountCurrency: 'NGN', rate: '100.0000' } });
    expect(r.days[1]).toMatchObject({ ordersPlaced: 5, waitingForRate: false, spend: { store: '2000.00', account: '250000.00', rate: '125.0000' } });
    expect(r.days[2]).toMatchObject({ ordersPlaced: 0, spend: { store: '480.00', account: '60000.00' }, costPerOrder: null });
    expect(r.days[0].costPerOrder).toMatchObject({ store: '250.00', account: '25000.00' });
    expect(r.days[1].costPerOrder).toMatchObject({ store: '400.00', account: '50000.00' });
    expect(r.best).toMatchObject({ date: '2026-12-01', costPerOrder: { account: '25000.00' } });
    expect(r.worst).toMatchObject({ date: '2026-12-02', costPerOrder: { account: '50000.00' } });
    // 3,480.00 GHS and 410,000 NGN over 3 days; 9 orders over 3 days
    expect(r.average.spend).toMatchObject({ store: '1160.00', account: '136670.00', accountCurrency: 'NGN' });
    expect(r.average.ordersPerDay).toBe(3);
  });

  it('the days add up to the summary spend of the same range', async () => {
    const r = await inD(() => daily({ from: '2026-12-01', to: '2026-12-03' }));
    const t = await inD(() => tiles({ from: '2026-12-01', to: '2026-12-03' }));
    const cents = r.days.reduce((n, x) => n + Math.round(Number(x.spend.store) * 100), 0);
    expect((cents / 100).toFixed(2)).toBe(t.spend.store);
    expect(t.spend.store).toBe('3480.00');
    expect(r.days.reduce((n, x) => n + x.ordersPlaced, 0)).toBe(t.ordersPlaced);
  });

  it('days with nothing are included, and best and worst are null when no day has both spend and orders', async () => {
    const r = await inD(() => daily({ from: '2026-12-05', to: '2026-12-06' }));
    expect(r.days).toHaveLength(2);
    expect(r.days[0]).toMatchObject({ ordersPlaced: 0, waitingForRate: false, costPerOrder: null, spend: { store: '0.00', account: '0.00' } });
    expect(r.best).toBeNull();
    expect(r.worst).toBeNull();
    expect(r.average.ordersPerDay).toBe(0);
  });

  it('a day with spend and no FX rate has no store figure and says it is waiting', async () => {
    const r = await runInTenant(e, () => daily({ from: '2026-12-01', to: '2026-12-01' }));
    expect(r.days[0]).toMatchObject({ waitingForRate: true, ordersPlaced: 2, spend: { store: null, account: '5000.00', accountCurrency: 'NGN' }, costPerOrder: null });
    expect(r.best).toBeNull();
  });
});

describe('GET /api/marketing/daily', () => {
  const get = (token: string, q = 'from=2026-12-01&to=2026-12-03') => request(app).get(`/api/marketing/daily?${q}`).set(bearer(token));

  it('returns the rows for the owner', async () => {
    const res = await get(ownerD.token);
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(3);
    expect(res.body.best.date).toBe('2026-12-01');
    expect(JSON.stringify(res.body)).not.toContain('accessToken');
  });

  it('tenant B sees only its own spend and orders', async () => {
    const res = await get(ownerB.token);
    expect(res.status).toBe(200);
    expect(res.body.days[0]).toMatchObject({ ordersPlaced: 7 });
    expect(res.body.days[1]).toMatchObject({ ordersPlaced: 0 });
    const own = await get(ownerD.token);
    expect(own.body.days[0].ordersPlaced).toBe(4);
  });

  it('a call rep gets 403, a missing range 400 and a range over a year 400', async () => {
    expect((await get(repD.token)).status).toBe(403);
    expect((await get(ownerD.token, 'from=2026-12-01')).status).toBe(400);
    expect((await get(ownerD.token, 'from=2025-01-01&to=2026-12-03')).status).toBe(400);
  });
});
