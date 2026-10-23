/**
 * M3b-T04 (COD-31, F-400, F-401): /api/payment-connections. Keys are encrypted at rest and masked on read; the
 * secret never shows in a response or a log line; a tenant that only has the old SystemConfig.paystackProvider JSON
 * still pays; two tenants never see each other's connections; live keys in test mode are refused.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import logger from '../../utils/logger';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { encryptProviderSecrets, isEncryptedString } from '../../utils/providerCrypto';
import { getPaymentProvider, clearPaymentConfigCache } from '../../services/payments';
import { unsupportedCurrencyMessage } from '../../services/payments/connectionConfig';
import * as Money from '../../utils/money';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

process.env.PROVIDER_ENCRYPTION_KEY = 'ab'.repeat(32);
const SECRET_A = 'sk_test_AAAA_super_secret_value';
const SECRET_B = 'sk_test_BBBB_other_secret_value';
const originalFetch = global.fetch;
let pair: TwoTenants;

beforeAll(async () => {
  pair = await createTwoTenants('payconnapi');
  // Start from no connection and no legacy JSON; each test sets up what it needs.
  await prismaBase.paymentConnection.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const tokenA = () => bearer(pair.a.users.admin.token);
const tokenB = () => bearer(pair.b.users.admin.token);
const allLogLines = () =>
  JSON.stringify([logger.info, logger.warn, logger.error, logger.debug].map((fn) => (fn as jest.Mock).mock.calls));

describe('save, read, mask', () => {
  it('stores the secret encrypted and never returns it', async () => {
    const put = await request(app).put('/api/payment-connections').set(tokenA())
      .send({ provider: 'paystack', mode: 'test', publicKey: 'pk_test_AAAA', secretKey: SECRET_A });
    expect(put.status).toBe(200);
    expect(put.body.connection).toMatchObject({ provider: 'paystack', mode: 'test', publicKey: 'pk_test_AAAA', hasSecret: true, legacy: false });
    expect(put.body.connection.secretKey).toBe('••••••••');

    const row = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.a.id, provider: 'paystack' } });
    expect(isEncryptedString(row.secretKey)).toBe(true);
    expect(row.secretKey).not.toContain(SECRET_A);

    const get = await request(app).get('/api/payment-connections').set(tokenA());
    expect(get.status).toBe(200);
    expect(get.body.connections).toHaveLength(1);
    expect(JSON.stringify(get.body)).not.toContain(SECRET_A);
    expect(JSON.stringify(put.body)).not.toContain(SECRET_A);
  });

  it('keeps the stored secret when the client sends the mask or nothing, and changes it when a new one comes', async () => {
    const before = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.a.id, provider: 'paystack' } });
    await request(app).put('/api/payment-connections').set(tokenA())
      .send({ provider: 'paystack', mode: 'test', secretKey: '••••••••', isEnabled: true });
    await request(app).put('/api/payment-connections').set(tokenA()).send({ provider: 'paystack', mode: 'test' });
    const same = await prismaBase.paymentConnection.findFirstOrThrow({ where: { id: before.id } });
    expect(same.secretKey).toBe(before.secretKey);
    expect(same.publicKey).toBe('pk_test_AAAA');

    await request(app).put('/api/payment-connections').set(tokenA())
      .send({ provider: 'paystack', mode: 'test', secretKey: 'sk_test_AAAA_rotated' });
    const changed = await prismaBase.paymentConnection.findFirstOrThrow({ where: { id: before.id } });
    expect(changed.secretKey).not.toBe(before.secretKey);
    expect(isEncryptedString(changed.secretKey)).toBe(true);
    // put the first secret back for the tests below
    await request(app).put('/api/payment-connections').set(tokenA())
      .send({ provider: 'paystack', mode: 'test', secretKey: SECRET_A });
  });

  it('refuses a live key in test mode and a test key in live mode (existing rule kept)', async () => {
    const liveInTest = await request(app).put('/api/payment-connections').set(tokenA())
      .send({ provider: 'paystack', mode: 'test', secretKey: 'sk_live_xxxxxxxx' });
    expect(liveInTest.status).toBe(400);
    expect(liveInTest.body.error).toMatch(/Test but the secret key is not a test key/);

    const testInLive = await request(app).put('/api/payment-connections').set(tokenA())
      .send({ provider: 'paystack', mode: 'live', secretKey: 'sk_test_xxxxxxxx' });
    expect(testInLive.status).toBe(400);

    // switching mode alone, with the stored test key, is refused too
    const modeOnly = await request(app).put('/api/payment-connections').set(tokenA()).send({ provider: 'paystack', mode: 'live' });
    expect(modeOnly.status).toBe(400);
  });

  it('refuses an unknown provider and a bad body', async () => {
    const unknown = await request(app).put('/api/payment-connections').set(tokenA()).send({ provider: 'nope', mode: 'test' });
    expect(unknown.status).toBe(400);
    const bad = await request(app).put('/api/payment-connections').set(tokenA()).send({ provider: 'paystack', mode: 'sandbox' });
    expect(bad.status).toBe(400);
  });

  it('is for owners and admins only', async () => {
    const rep = bearer(pair.a.users.salesRep.token);
    expect((await request(app).get('/api/payment-connections').set(rep)).status).toBe(403);
    expect((await request(app).put('/api/payment-connections').set(rep).send({ provider: 'paystack', mode: 'test' })).status).toBe(403);
    expect((await request(app).get('/api/payment-connections')).status).toBe(401);
  });
});

describe('two tenants', () => {
  it('B sees nothing of A, saves its own, and cannot test A\'s connection', async () => {
    const aRow = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.a.id, provider: 'paystack' } });

    const emptyForB = await request(app).get('/api/payment-connections').set(tokenB());
    expect(emptyForB.body.connections).toEqual([]);

    const putB = await request(app).put('/api/payment-connections').set(tokenB())
      .send({ provider: 'paystack', mode: 'test', publicKey: 'pk_test_BBBB', secretKey: SECRET_B });
    expect(putB.status).toBe(200);
    const bRow = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.b.id, provider: 'paystack' } });
    expect(bRow.id).not.toBe(aRow.id);

    const listB = await request(app).get('/api/payment-connections').set(tokenB());
    expect(listB.body.connections.map((c: { publicKey: string }) => c.publicKey)).toEqual(['pk_test_BBBB']);
    const listA = await request(app).get('/api/payment-connections').set(tokenA());
    expect(listA.body.connections.map((c: { publicKey: string }) => c.publicKey)).toEqual(['pk_test_AAAA']);

    const cross = await request(app).post(`/api/payment-connections/${aRow.id}/test`).set(tokenB());
    expect(cross.status).toBe(404);
    // B's save did not touch A's row
    const aAfter = await prismaBase.paymentConnection.findFirstOrThrow({ where: { id: aRow.id } });
    expect(aAfter.publicKey).toBe('pk_test_AAAA');
  });
});

describe('test connection', () => {
  it('stores supportedCurrencies and lastCheckedAt, and reports the key check', async () => {
    const row = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.a.id, provider: 'paystack' } });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: true, data: [{ currency: 'GHS', balance: 0 }, { currency: 'NGN', balance: 0 }] }),
    }) as never;

    const res = await request(app).post(`/api/payment-connections/${row.id}/test`).set(tokenA());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.connection.supportedCurrencies).toEqual(['GHS', 'NGN']);
    expect(res.body.connection.lastCheckedAt).toBeTruthy();
    // the call used the decrypted secret
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe(`Bearer ${SECRET_A}`);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_A);

    const stored = await prismaBase.paymentConnection.findFirstOrThrow({ where: { id: row.id } });
    expect(stored.supportedCurrencies).toEqual(['GHS', 'NGN']);
  });

  it('reports a rejected key as ok false and keeps the currencies', async () => {
    const row = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.a.id, provider: 'paystack' } });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ status: false, message: 'Invalid key' }) }) as never;
    const res = await request(app).post(`/api/payment-connections/${row.id}/test`).set(tokenA());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, message: 'Invalid key' });
    expect(res.body.connection.supportedCurrencies).toEqual(['GHS', 'NGN']);
  });

  it('a new secret clears the currency list, because the account may be another one', async () => {
    await request(app).put('/api/payment-connections').set(tokenA()).send({ provider: 'paystack', mode: 'test', secretKey: 'sk_test_AAAA_new_account' });
    const row = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.a.id, provider: 'paystack' } });
    expect(row.supportedCurrencies).toEqual([]);
    expect(row.lastCheckedAt).toBeNull();
    await request(app).put('/api/payment-connections').set(tokenA()).send({ provider: 'paystack', mode: 'test', secretKey: SECRET_A });
  });
});

describe('currency check on forms (F-401)', () => {
  it('the message names the currency', () => {
    expect(unsupportedCurrencyMessage({ supportedCurrencies: ['GHS'] }, 'NGN')).toBe(
      'This payment account cannot take NGN. Connect another account or provider.',
    );
    expect(unsupportedCurrencyMessage({ supportedCurrencies: ['GHS'] }, 'ghs')).toBeNull();
    expect(unsupportedCurrencyMessage({ supportedCurrencies: [] }, 'NGN')).toBeNull(); // never tested: not blocked
    expect(unsupportedCurrencyMessage(null, 'NGN')).toBeNull();
  });

  it('PUT /api/checkout-forms/:id refuses online payment for a currency the account cannot take', async () => {
    await prismaBase.paymentConnection.updateMany({ where: { tenantId: pair.a.id }, data: { supportedCurrencies: ['GHS'] } });
    const formId = pair.a.ids.checkoutForm;

    const refused = await request(app).put(`/api/checkout-forms/${formId}`).set(tokenA())
      .send({ currency: 'NGN', codEnabled: false, paystackFullEnabled: true });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('This payment account cannot take NGN. Connect another account or provider.');

    const allowed = await request(app).put(`/api/checkout-forms/${formId}`).set(tokenA())
      .send({ currency: 'GHS', codEnabled: false, paystackFullEnabled: true });
    expect(allowed.status).toBe(200);
  });
});

describe('fallback to SystemConfig.paystackProvider', () => {
  it('a tenant with only the old JSON is configured, shown as legacy, and calls Paystack with that secret', async () => {
    // tenant B: drop the connection, put the keys in the old JSON (encrypted, as the old settings save did)
    await prismaBase.paymentConnection.deleteMany({ where: { tenantId: pair.b.id } });
    await prismaBase.systemConfig.updateMany({
      where: { tenantId: pair.b.id },
      data: { paystackProvider: encryptProviderSecrets('paystackProvider', { publicKey: 'pk_test_OLD', secretKey: 'sk_test_OLD_secret', mode: 'test', isEnabled: true }) },
    });
    clearPaymentConfigCache(pair.b.id);

    const paystack = getPaymentProvider('paystack');
    await runInTenant(pair.b.id, async () => {
      expect(await paystack.isConfigured(pair.b.id)).toBe(true);
      expect(await paystack.getPublicKey(pair.b.id)).toBe('pk_test_OLD');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ status: true, data: { authorization_url: 'https://pay.test/x', access_code: 'ac', reference: 'ref_old' } }),
      }) as never;
      const result = await paystack.initialize(pair.b.id, { amount: Money.parse('249.00'), currency: 'GHS', customer: { email: 'a@b.test' } });
      expect(result.providerReference).toBe('ref_old');
      expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer sk_test_OLD_secret');
    });

    const list = await request(app).get('/api/payment-connections').set(tokenB());
    expect(list.body.connections).toHaveLength(1);
    expect(list.body.connections[0]).toMatchObject({ id: null, legacy: true, provider: 'paystack', publicKey: 'pk_test_OLD', hasSecret: true });
    expect(JSON.stringify(list.body)).not.toContain('sk_test_OLD_secret');
  });

  it('the first save without a new secret keeps the old one instead of dropping it', async () => {
    const put = await request(app).put('/api/payment-connections').set(tokenB()).send({ provider: 'paystack', mode: 'test', isEnabled: true });
    expect(put.status).toBe(200);
    expect(put.body.connection.hasSecret).toBe(true);
    clearPaymentConfigCache(pair.b.id);
    await runInTenant(pair.b.id, async () => {
      expect(await getPaymentProvider('paystack').isConfigured(pair.b.id)).toBe(true);
    });
  });

  it('a connection row wins over the old JSON', async () => {
    await request(app).put('/api/payment-connections').set(tokenB())
      .send({ provider: 'paystack', mode: 'test', publicKey: 'pk_test_NEW', secretKey: 'sk_test_NEW_secret' });
    await runInTenant(pair.b.id, async () => {
      expect(await getPaymentProvider('paystack').getPublicKey(pair.b.id)).toBe('pk_test_NEW');
    });
  });
});

describe('secrets stay out of the public config and the logs', () => {
  it('the embed config carries the public key only', async () => {
    const res = await request(app).get(`/api/public/forms/${pair.a.formSlug}/config`);
    expect(res.status).toBe(200);
    expect(res.body.config.paystackPublicKey).toBe('pk_test_AAAA');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(SECRET_A);
    expect(text).not.toContain('sk_test_');
  });

  it('no log line from any of the calls above holds a secret', () => {
    const lines = allLogLines();
    for (const secret of [SECRET_A, SECRET_B, 'sk_test_OLD_secret', 'sk_test_NEW_secret', 'sk_test_AAAA_rotated', 'sk_test_AAAA_new_account']) {
      expect(lines).not.toContain(secret);
    }
  });
});
