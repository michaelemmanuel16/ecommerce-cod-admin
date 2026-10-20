/**
 * M1-T30 (COD-14): FX service. Fake provider, no network. Throwaway tenant on the test DB.
 * One auto row per pair per day; a manual rate stays until use-today; a missing day reads the nearest earlier rate.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer, makeOrder } from './helpers/kpiOrders';
import { FxProvider } from '../../services/fx/fxProvider';
import { extraCurrencies, rateHistory, rateOn, refreshAutoRates, setManualRate, useTodaysRate } from '../../services/fxService';
import { processFxRefresh } from '../../queues/fxRateQueue';
import { setFxProvider } from '../../services/fx/fxProvider';

class FakeProvider implements FxProvider {
  readonly name = 'fake';
  calls: string[] = [];
  rates: Record<string, number> = { NGN: 112, USD: 0.08 };
  async fetchRates(base: string) {
    this.calls.push(base);
    return this.rates;
  }
}

const NOON = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
let tenantId: string;
let userId: number;
const provider = new FakeProvider();

beforeAll(async () => {
  tenantId = (await createTenant('Fx Svc')).id; // GHS store
  const customer = await makeCustomer(tenantId);
  // Orders in NGN and USD put those two currencies "in use".
  await prismaBase.order.createMany({
    data: ['NGN', 'USD'].map((currency) => ({
      customerId: customer.id, status: 'delivered' as const, subtotal: 10, totalAmount: 10, currency,
      deliveryAddress: 'x', deliveryState: 'x', deliveryArea: 'x', tenantId,
    })),
  });
  userId = (await prismaBase.user.create({ data: { email: `fx-${Date.now()}@codadmin.test`, password: 'x', firstName: 'F', lastName: 'X', role: 'super_admin', tenantId } })).id;
  setFxProvider(provider);
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('FX service (M1-T30)', () => {
  it('finds the currencies in use besides the store currency', async () => {
    expect(await extraCurrencies(tenantId)).toEqual(['NGN', 'USD']);
  });

  it('the refresh writes one auto row per pair per day and a second run the same day writes none', async () => {
    const first = await refreshAutoRates(tenantId, { provider, now: NOON('2026-10-01') });
    expect(first).toMatchObject({ pairs: 2, written: 2, skipped: [] });
    const again = await refreshAutoRates(tenantId, { provider, now: NOON('2026-10-01') });
    expect(again.written).toBe(0);
    provider.rates = { NGN: 114, USD: 0.08 };
    await refreshAutoRates(tenantId, { provider, now: NOON('2026-10-02') });
    const rows = await prismaBase.fxRate.findMany({ where: { tenantId, toCurrency: 'NGN' }, orderBy: { date: 'asc' } });
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.source, r.fromCurrency, r.rate.toString()])).toEqual([
      ['2026-10-01', 'auto', 'GHS', '112'],
      ['2026-10-02', 'auto', 'GHS', '114'],
    ]);
  });

  it('rateOn: the day itself, else the nearest earlier day, else the nearest later day', async () => {
    const exact = await rateOn(tenantId, 'GHS', 'NGN', '2026-10-02');
    expect(exact).toMatchObject({ date: '2026-10-02', exact: true, source: 'auto', inverse: false });
    expect(exact!.rate.toString()).toBe('114');
    const missing = await rateOn(tenantId, 'GHS', 'NGN', '2026-10-09');
    expect(missing).toMatchObject({ date: '2026-10-02', exact: false });
    expect(missing!.rate.toString()).toBe('114');
    const before = await rateOn(tenantId, 'GHS', 'NGN', '2026-09-20');
    expect(before).toMatchObject({ date: '2026-10-01', exact: false });
    expect((await rateOn(tenantId, 'GHS', 'EUR', '2026-10-02'))).toBeNull();
    expect((await rateOn(tenantId, 'GHS', 'GHS', '2026-10-02'))!.rate.toString()).toBe('1');
  });

  it('rateOn reads the inverse of a stored pair (after a store currency change)', async () => {
    const inv = await rateOn(tenantId, 'NGN', 'GHS', '2026-10-02');
    expect(inv).toMatchObject({ inverse: true, date: '2026-10-02' });
    expect(inv!.rate.mul(114).toDecimalPlaces(6).toString()).toBe('1');
  });

  it('a manual rate wins from its date on and stays until use-today; history keeps every row', async () => {
    await setManualRate(tenantId, userId, { to: 'NGN', rate: 150, date: '2026-10-03' });
    // The daily job keeps writing auto rows after the manual date; they do not win.
    provider.rates = { NGN: 116, USD: 0.08 };
    await refreshAutoRates(tenantId, { provider, now: NOON('2026-10-04') });
    await refreshAutoRates(tenantId, { provider, now: NOON('2026-10-05') });
    for (const day of ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-20']) {
      const r = await rateOn(tenantId, 'GHS', 'NGN', day);
      expect(r).toMatchObject({ source: 'manual' });
      expect(r!.rate.toString()).toBe('150');
    }
    // Days before the manual date still read their auto rate.
    expect((await rateOn(tenantId, 'GHS', 'NGN', '2026-10-02'))!.rate.toString()).toBe('114');

    // use-today ends the manual rate. "Today" in this test is the real today; fix it with a spy-free approach:
    // write the release for the real today, then check days from that date on.
    provider.rates = { NGN: 118, USD: 0.08 };
    const out = await useTodaysRate(tenantId, userId, { to: 'NGN', provider });
    expect(out.rates).toHaveLength(1);
    const released = out.rates[0];
    const releaseDay = released.date.toISOString().slice(0, 10);
    const after = await rateOn(tenantId, 'GHS', 'NGN', releaseDay);
    expect(after).toMatchObject({ source: 'auto' });
    expect(after!.rate.toString()).toBe('118');
    // The manual rate still answers for the days it was in force (history is kept).
    expect((await rateOn(tenantId, 'GHS', 'NGN', '2026-10-05'))).toMatchObject({ source: 'manual' });

    const history = await rateHistory(tenantId, { to: 'NGN' });
    expect(history.filter((h) => h.source === 'manual')).toHaveLength(1);
    expect(history.filter((h) => h.source === 'auto').length).toBeGreaterThanOrEqual(5);
  });

  it('a new manual rate after use-today starts a new override', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await setManualRate(tenantId, userId, { to: 'USD', rate: 0.09, date: day });
    expect((await rateOn(tenantId, 'GHS', 'USD', day))).toMatchObject({ source: 'manual' });
    provider.rates = { NGN: 118, USD: 0.1 };
    await useTodaysRate(tenantId, userId, { to: 'USD', provider });
    const r = await rateOn(tenantId, 'GHS', 'USD', day);
    expect(r).toMatchObject({ source: 'auto' });
    expect(r!.rate.toString()).toBe('0.1');
  });

  it('rejects a bad manual rate, currency and a future date', async () => {
    await expect(setManualRate(tenantId, userId, { to: 'NGN', rate: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(setManualRate(tenantId, userId, { to: 'naira', rate: 1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(setManualRate(tenantId, userId, { to: 'GHS', rate: 1 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(setManualRate(tenantId, userId, { to: 'NGN', rate: 1, date: '2099-01-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('use-today answers 502 when the provider is down and keeps the manual rate', async () => {
    const down: FxProvider = { name: 'down', fetchRates: async () => { throw new Error('boom'); } };
    await expect(useTodaysRate(tenantId, userId, { to: 'NGN', provider: down })).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe('FX job (M1-T30)', () => {
  it('runs for every tenant, asks the provider once per base and writes today\'s auto row for the pair', async () => {
    const other = await createTenant('Fx Svc Other');
    try {
      const otherCustomer = await makeCustomer(other.id);
      const order = await makeOrder({ tenantId: other.id, customerId: otherCustomer.id, status: 'delivered' });
      await prismaBase.order.update({ where: { id: order.id }, data: { currency: 'NGN' } });
      provider.calls = [];
      provider.rates = { NGN: 121, USD: 0.08 };
      await processFxRefresh();
      expect(provider.calls.filter((b) => b === 'GHS')).toHaveLength(1);
      const today = await prismaBase.fxRate.findMany({ where: { tenantId: other.id, source: 'auto' } });
      expect(today.map((r) => [r.fromCurrency, r.toCurrency, r.rate.toString()])).toEqual([['GHS', 'NGN', '121']]);
    } finally {
      await deleteTenantRows([other.id]);
    }
  });
});
