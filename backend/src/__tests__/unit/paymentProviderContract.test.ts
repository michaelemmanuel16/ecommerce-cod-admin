/**
 * M3b-T03 (F-400, F-401): one contract, run against every provider. The Paystack adapter runs on mocked HTTP
 * (global fetch) and a mocked tenant config; the fake provider runs as is. A provider passes when the
 * app can use it through the PaymentProvider interface alone.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import crypto from 'crypto';

jest.mock('../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

import { prismaMock } from '../mocks/prisma.mock';
import { clearPaystackConfigCache } from '../../services/paystackService';
import { paystackAdapter } from '../../services/payments/paystackAdapter';
import { createFakeProvider } from '../../services/payments/fakeProvider';
import type { PaymentProvider } from '../../services/payments';
import * as Money from '../../utils/money';

const SECRET = 'sk_test_contract';
const originalFetch = global.fetch;

interface Harness {
  name: string;
  provider: PaymentProvider;
  /** Make the provider answer `verify(reference)` with a paid 249.00 GHS payment, fee 3.70, channel card. */
  arrangePaid: (reference: string) => void;
  arrangeStatus: (reference: string, status: string) => void;
  signedWebhook: (body: string) => Record<string, string>;
  badWebhook: (body: string) => Record<string, string>;
  successBody: (reference: string) => string;
  arrangeKeyCheck: (ok: boolean) => void;
  otherBody: () => string;
  setup: () => void;
}

const fetchReturning = (data: unknown) => {
  (global.fetch as any) = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: true, data }) });
};

const paystack: Harness = {
  name: 'paystack adapter (mocked HTTP)',
  provider: paystackAdapter,
  setup() {
    clearPaystackConfigCache();
    (prismaMock.systemConfig.findUnique as any).mockResolvedValue({
      paystackProvider: { publicKey: 'pk_test_contract', secretKey: SECRET, mode: 'test', isEnabled: true },
    });
  },
  arrangePaid: (reference) =>
    fetchReturning({ status: 'success', reference, amount: 24900, currency: 'GHS', fees: 370, channel: 'card', paid_at: '2026-10-23T10:00:00.000Z' }),
  arrangeStatus: (reference, status) =>
    fetchReturning({ status, reference, amount: 0, currency: 'GHS', fees: 0 }),
  signedWebhook: (body) => ({ 'x-paystack-signature': crypto.createHmac('sha512', SECRET).update(body).digest('hex') }),
  badWebhook: () => ({ 'x-paystack-signature': 'deadbeef' }),
  successBody: (reference) => JSON.stringify({ event: 'charge.success', data: { id: 77, reference } }),
  otherBody: () => JSON.stringify({ event: 'transfer.success', data: { reference: 'tr_1' } }),
  arrangeKeyCheck: (ok) => {
    (global.fetch as any) = jest.fn().mockResolvedValue(
      ok
        ? { ok: true, status: 200, json: async () => ({ status: true, data: [{ currency: 'ghs', balance: 0 }, { currency: 'NGN', balance: 0 }, { currency: 'NGN', balance: 0 }] }) }
        : { ok: false, status: 401, json: async () => ({ status: false, message: 'Invalid key' }) },
    );
  },
};

const fake = createFakeProvider();
const fakeHarness: Harness = {
  name: 'fake provider',
  provider: fake,
  setup() {},
  arrangePaid: (reference) => fake.setPayment(reference, { status: 'success', amount: '249.00', fee: '3.70', channel: 'card' }),
  arrangeStatus: (reference, status) => fake.setPayment(reference, { status: status as any, amount: 0 }),
  signedWebhook: () => ({ 'x-fake-signature': 'valid' }),
  badWebhook: () => ({ 'x-fake-signature': 'nope' }),
  successBody: (reference) => JSON.stringify({ type: 'payment.success', id: 'evt_1', reference }),
  otherBody: () => JSON.stringify({ type: 'refund.created', id: 'evt_2' }),
  arrangeKeyCheck: () => {},
};

describe.each([paystack, fakeHarness])('PaymentProvider contract: $name', (h) => {
  beforeEach(() => {
    h.setup();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('has an id and lists at least one method', () => {
    expect(h.provider.id).toEqual(expect.any(String));
    expect(h.provider.supportedMethods('GHS').length).toBeGreaterThan(0);
  });

  it('initialize returns the payment page and the provider reference', async () => {
    if (h.provider.id === 'paystack') fetchReturning({ authorization_url: 'https://pay.test/abc', access_code: 'ac', reference: 'ref_init' });
    const result = await h.provider.initialize('tenant-1', {
      amount: Money.parse('249.00'),
      currency: 'GHS',
      customer: { email: 'ama@example.com' },
      callbackUrl: 'https://app.test/checkout/payment/callback',
      metadata: { formSlug: 'f' },
    });
    expect(result.authorizationUrl).toMatch(/^https:\/\//);
    expect(result.providerReference).toEqual(expect.any(String));
  });

  it('verify maps a paid payment to major units with the fee, channel and time', async () => {
    h.arrangePaid('ref_paid');
    const v = await h.provider.verify('tenant-1', 'ref_paid');
    expect(v.status).toBe('success');
    expect(Money.toApi(v.amount)).toBe('249.00');
    expect(v.currency).toBe('GHS');
    expect(Money.toApi(v.fee)).toBe('3.70');
    expect(v.feeKnown).toBe(true);
    expect(v.channel).toBe('card');
  });

  it.each(['abandoned', 'failed', 'pending'])('verify reports %s', async (status) => {
    h.arrangeStatus('ref_x', status);
    const v = await h.provider.verify('tenant-1', 'ref_x');
    expect(v.status).toBe(status);
  });

  it('verifyWebhook accepts a good signature and refuses a bad or missing one', async () => {
    const body = h.successBody('ref_w');
    expect(await h.provider.verifyWebhook('tenant-1', body, h.signedWebhook(body))).toBe(true);
    expect(await h.provider.verifyWebhook('tenant-1', body, h.badWebhook(body))).toBe(false);
    expect(await h.provider.verifyWebhook('tenant-1', body, {})).toBe(false);
  });

  it('parseWebhook reads a success event and tells other events apart', () => {
    const ok = h.provider.parseWebhook(h.successBody('ref_w'));
    expect(ok).toMatchObject({ kind: 'payment_succeeded', reference: 'ref_w' });
    expect(ok.eventType).toEqual(expect.any(String));
    expect(h.provider.parseWebhook(h.otherBody()).kind).toBe('other');
  });

  it('testConnection reports ok with the currencies the account takes (upper case, no repeats)', async () => {
    h.arrangeKeyCheck(true);
    const check = await h.provider.testConnection('tenant-1');
    expect(check.ok).toBe(true);
    expect(check.supportedCurrencies).toEqual(expect.arrayContaining(['GHS']));
    expect(new Set(check.supportedCurrencies).size).toBe(check.supportedCurrencies.length);
  });

  it('getPublicKey never returns a secret', async () => {
    const key = await h.provider.getPublicKey('tenant-1');
    expect(key).not.toContain('sk_');
  });
});

describe('PaymentProvider contract: paystack specifics', () => {
  it('validateCredentials refuses a key that does not match the mode', () => {
    const v = paystackAdapter.validateCredentials!;
    expect(() => v('test', 'sk_test_abc')).not.toThrow();
    expect(() => v('live', 'sk_live_abc')).not.toThrow();
    expect(() => v('live', 'sk_test_abc')).toThrow(/Live but the secret key is not a live key \(sk_live_\.\.\.\)/);
    expect(() => v('test', 'sk_live_abc')).toThrow(/Test but the secret key is not a test key \(sk_test_\.\.\.\)/);
  });

  it('testConnection times out after 10 seconds and says so', async () => {
    paystack.setup();
    (global.fetch as any) = jest.fn().mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    const check = await paystackAdapter.testConnection('tenant-1');
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/within 10 seconds/);
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal).toBeDefined();
  });
  it('testConnection reports a rejected key as ok false, without the secret', async () => {
    paystack.setup();
    paystack.arrangeKeyCheck(false);
    const check = await paystackAdapter.testConnection('tenant-1');
    expect(check).toEqual({ ok: false, message: 'Invalid key', supportedCurrencies: [] });
    expect(JSON.stringify(check)).not.toContain(SECRET);
  });

  beforeEach(() => paystack.setup());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('initialize sends minor units to Paystack: 249.00 GHS is 24900', async () => {
    fetchReturning({ authorization_url: 'https://pay.test/abc', access_code: 'ac', reference: 'ref_init' });
    await paystackAdapter.initialize('tenant-1', {
      amount: Money.parse('249.00'),
      currency: 'GHS',
      customer: { email: 'ama@example.com' },
    });
    const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sent.amount).toBe(24900);
    expect(sent.currency).toBe('GHS');
    expect(sent).not.toHaveProperty('channels'); // the hosted page offers the account's channels (F-401)
  });

  it('verify without a fee figure marks the fee unknown', async () => {
    fetchReturning({ status: 'success', reference: 'r', amount: 100, currency: 'GHS' });
    const v = await paystackAdapter.verify('tenant-1', 'r');
    expect(v.feeKnown).toBe(false);
    expect(Money.toApi(v.fee)).toBe('0.00');
  });
});
