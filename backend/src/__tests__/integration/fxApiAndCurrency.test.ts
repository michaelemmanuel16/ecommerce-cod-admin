/**
 * M1-T31 (COD-14): FX API permissions and the store currency rules (decision O6).
 * The store currency can change with 0 orders and with orders; each order keeps its own currency and a revenue
 * read converts it at the rate of its own delivery day. Fake provider, no network.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { clearCurrencyCache } from '../../utils/currency';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer, makeOrder } from './helpers/kpiOrders';
import { setFxProvider } from '../../services/fx/fxProvider';
import { deliveredRevenue, deliveredRevenueByDay } from '../../services/kpi/revenue';
import { getStoreTimeZone, monthRange } from '../../services/kpi/dates';
import { currencyForCountry } from '../../utils/currency';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const oct = monthRange(2026, 10, getStoreTimeZone());

let emptyTenant: string;
let busyTenant: string;
const tokens: Record<string, string> = {};

async function mkUser(tenantId: string, role: 'super_admin' | 'admin' | 'sales_rep') {
  const u = await prismaBase.user.create({ data: { email: `${role}-${tenantId}@codadmin.test`, password: 'x', firstName: role, lastName: 'T', role, tenantId } });
  return generateAccessToken({ id: u.id, email: u.email, role, tenantId });
}

beforeAll(async () => {
  setFxProvider({ name: 'fake', fetchRates: async () => ({ NGN: 112, GHS: 0.0089, USD: 0.08 }) });
  emptyTenant = (await createTenant('Fx Api Empty')).id;
  busyTenant = (await createTenant('Fx Api Busy')).id;
  tokens.superEmpty = await mkUser(emptyTenant, 'super_admin');
  tokens.adminEmpty = await mkUser(emptyTenant, 'admin');
  tokens.repEmpty = await mkUser(emptyTenant, 'sales_rep');
  tokens.superBusy = await mkUser(busyTenant, 'super_admin');
  await prismaBase.systemConfig.create({ data: { tenantId: emptyTenant, businessName: 'Empty' } });
  await prismaBase.systemConfig.create({ data: { tenantId: busyTenant, businessName: 'Busy' } });
}, 30000);

afterAll(async () => {
  await deleteTenantRows([emptyTenant, busyTenant]);
  await prismaBase.$disconnect();
});

describe('/api/fx permissions', () => {
  it('401 without a token', async () => {
    expect((await request(app).get('/api/fx/rates')).status).toBe(401);
  });

  it('read needs settings:view (admin yes, sales rep no); write needs settings:update (super admin only)', async () => {
    expect((await request(app).get('/api/fx/rates').set(auth(tokens.adminEmpty))).status).toBe(200);
    expect((await request(app).get('/api/fx/history').set(auth(tokens.adminEmpty))).status).toBe(200);
    expect((await request(app).get('/api/fx/rates').set(auth(tokens.repEmpty))).status).toBe(403);
    expect((await request(app).post('/api/fx/rates').set(auth(tokens.adminEmpty)).send({ to: 'NGN', rate: 112 })).status).toBe(403);
    expect((await request(app).post('/api/fx/use-today').set(auth(tokens.adminEmpty)).send({})).status).toBe(403);
  });

  it('a manual rate shows in rates and history, then use-today takes the automatic rate back', async () => {
    const h = auth(tokens.superEmpty);
    const bad = await request(app).post('/api/fx/rates').set(h).send({ to: 'NGN' });
    expect(bad.status).toBe(400);
    const post = await request(app).post('/api/fx/rates').set(h).send({ to: 'NGN', rate: 150 });
    expect(post.status).toBe(201);
    expect(post.body).toMatchObject({ from: 'GHS', to: 'NGN', source: 'manual', rate: '150' });

    const rates = await request(app).get('/api/fx/rates').set(h);
    expect(rates.body.storeCurrency).toBe('GHS');
    expect(rates.body.provider.name).toBe('ExchangeRate-API');
    expect(rates.body.rates).toEqual([expect.objectContaining({ to: 'NGN', source: 'manual', rate: '150' })]);

    const useToday = await request(app).post('/api/fx/use-today').set(h).send({ to: 'NGN' });
    expect(useToday.status).toBe(200);
    expect(useToday.body.rates[0]).toMatchObject({ source: 'auto', rate: '112' });
    const after = await request(app).get('/api/fx/rates').set(h);
    expect(after.body.rates[0]).toMatchObject({ source: 'auto', rate: '112' });

    const history = await request(app).get('/api/fx/history?to=NGN').set(h);
    expect(history.body.history.map((r: any) => r.source).sort()).toEqual(['auto', 'manual']);
  });
});

describe('store currency (O6)', () => {
  it('picking a country gives its currency', () => {
    expect(currencyForCountry('Ghana')).toBe('GHS');
    expect(currencyForCountry('NG')).toBe('NGN');
    expect(currencyForCountry('Nowhere')).toBeNull();
  });

  it('changes with 0 orders, saves to Tenant.currency, and Settings reads it back', async () => {
    const put = await request(app).put('/api/admin/settings').set(auth(tokens.superEmpty)).send({ currency: 'KES', businessName: 'Empty 2' });
    expect(put.status).toBe(200);
    expect((await prismaBase.tenant.findUniqueOrThrow({ where: { id: emptyTenant } })).currency).toBe('KES');
    const get = await request(app).get('/api/admin/settings').set(auth(tokens.superEmpty));
    expect(get.body).toMatchObject({ currency: 'KES', businessName: 'Empty 2' });
    expect(Object.keys((await prismaBase.systemConfig.findFirstOrThrow({ where: { tenantId: emptyTenant } })))).not.toContain('currency');
    expect((await request(app).put('/api/admin/settings').set(auth(tokens.superEmpty)).send({ currency: 'naira' })).status).toBe(400);
  });

  it('changes with orders; each order keeps its currency; a revenue read converts it at its own delivery day\'s rate', async () => {
    const customer = await makeCustomer(busyTenant);
    const old = await makeOrder({ tenantId: busyTenant, customerId: customer.id, status: 'delivered', totalAmount: 100, deliveryDate: new Date('2026-10-05T10:00:00Z') });
    await makeOrder({ tenantId: busyTenant, customerId: customer.id, status: 'delivered', totalAmount: 50, deliveryDate: new Date('2026-10-12T10:00:00Z') });
    expect(old.currency).toBe('GHS'); // the trigger fills the store currency on insert
    // Rates of the pair GHS -> NGN: 112 from 1 Oct, 120 from 10 Oct.
    await prismaBase.fxRate.createMany({ data: [
      { fromCurrency: 'GHS', toCurrency: 'NGN', rate: '112', date: new Date('2026-10-01'), source: 'auto', tenantId: busyTenant },
      { fromCurrency: 'GHS', toCurrency: 'NGN', rate: '120', date: new Date('2026-10-10'), source: 'auto', tenantId: busyTenant },
    ] });

    const before = await deliveredRevenue(busyTenant, oct.from, oct.to);
    expect(before.total).toMatchObject({ value: '150.00', currency: 'GHS' });

    const put = await request(app).put('/api/admin/settings').set(auth(tokens.superBusy)).send({ currency: 'NGN' });
    expect(put.status).toBe(200);
    clearCurrencyCache();

    // Stored amounts and currencies are untouched.
    const rows = await prismaBase.order.findMany({ where: { tenantId: busyTenant }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.totalAmount.toString(), r.currency])).toEqual([['100', 'GHS'], ['50', 'GHS']]);

    // 100 on 5 Oct at 112 + 50 on 12 Oct at 120 = 11,200 + 6,000.
    const after = await deliveredRevenue(busyTenant, oct.from, oct.to);
    expect(after.total).toMatchObject({ value: '17200.00', currency: 'NGN' });
    expect(after.physical.value).toBe('17200.00');
    expect(after.deliveredOrders.value).toBe(2);
    const days = await deliveredRevenueByDay(busyTenant, oct.from, oct.to);
    expect(days).toEqual([
      { date: '2026-10-05', revenue: '11200.00', deliveredOrders: 1 },
      { date: '2026-10-12', revenue: '6000.00', deliveredOrders: 1 },
    ]);

    // A new order after the change is stored in the new store currency and needs no conversion.
    const fresh = await makeOrder({ tenantId: busyTenant, customerId: customer.id, status: 'delivered', totalAmount: 1000, deliveryDate: new Date('2026-10-14T10:00:00Z') });
    expect(fresh.currency).toBe('NGN');
    expect((await deliveredRevenue(busyTenant, oct.from, oct.to)).total.value).toBe('18200.00');
  });
});
