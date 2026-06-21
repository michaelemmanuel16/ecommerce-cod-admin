import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

import {
  platformPaystackService,
  isPlatformBillingConfigured,
} from '../../services/platformPaystackService';

const originalFetch = global.fetch;
const originalSecret = process.env.PLATFORM_PAYSTACK_SECRET_KEY;

describe('platformPaystackService — CodAdmin-as-merchant SaaS billing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PLATFORM_PAYSTACK_SECRET_KEY = 'sk_test_platform';
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalSecret === undefined) {
      delete process.env.PLATFORM_PAYSTACK_SECRET_KEY;
    } else {
      process.env.PLATFORM_PAYSTACK_SECRET_KEY = originalSecret;
    }
  });

  it('isPlatformBillingConfigured reflects env presence', () => {
    expect(isPlatformBillingConfigured()).toBe(true);
    delete process.env.PLATFORM_PAYSTACK_SECRET_KEY;
    expect(isPlatformBillingConfigured()).toBe(false);
  });

  it('initializeSubscriptionTransaction sends plan, NGN, and the platform secret', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { authorization_url: 'https://paystack.co/x', access_code: 'ac', reference: 'ref_1' } }),
    });

    const res = await platformPaystackService.initializeSubscriptionTransaction(
      'owner@tenant.com',
      'PLN_growth',
      1000000, // ₦10,000 in kobo
      { tenantId: 'tenant-A', planId: 'growth', kind: 'saas_subscription' },
      'https://app/settings/billing/callback',
    );

    expect(res.reference).toBe('ref_1');
    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(opts.headers.Authorization).toBe('Bearer sk_test_platform');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      email: 'owner@tenant.com',
      amount: 1000000,
      currency: 'NGN',
      plan: 'PLN_growth',
      callback_url: 'https://app/settings/billing/callback',
    });
    expect(body.metadata).toMatchObject({ tenantId: 'tenant-A', kind: 'saas_subscription' });
  });

  it('verifyTransaction GETs the verify endpoint with the reference', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ status: true, data: { status: 'success' } }) });

    await platformPaystackService.verifyTransaction('ref_abc');

    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/verify/ref_abc');
    expect(opts.method).toBe('GET');
  });

  it('getSubscription GETs /subscription/:code', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { subscription_code: 'SUB_1', email_token: 'tok_1', status: 'active' } }),
    });

    const res = await platformPaystackService.getSubscription('SUB_1');

    expect((global.fetch as any).mock.calls[0][0]).toBe('https://api.paystack.co/subscription/SUB_1');
    expect(res.data.email_token).toBe('tok_1');
  });

  it('disableSubscription posts code + email token to /subscription/disable', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ status: true }) });

    await platformPaystackService.disableSubscription('SUB_1', 'tok_1');

    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.paystack.co/subscription/disable');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ code: 'SUB_1', token: 'tok_1' });
  });

  it('validateWebhookSignature accepts a correct HMAC and rejects a wrong one', async () => {
    const crypto = await import('crypto');
    const rawBody = JSON.stringify({ event: 'charge.success' });
    const validSig = crypto.createHmac('sha512', 'sk_test_platform').update(rawBody).digest('hex');
    expect(platformPaystackService.validateWebhookSignature(rawBody, validSig)).toBe(true);

    const wrongSig = crypto.createHmac('sha512', 'sk_wrong').update(rawBody).digest('hex');
    expect(platformPaystackService.validateWebhookSignature(rawBody, wrongSig)).toBe(false);
  });

  it('validateWebhookSignature returns false when the platform secret is unset', () => {
    delete process.env.PLATFORM_PAYSTACK_SECRET_KEY;
    expect(platformPaystackService.validateWebhookSignature('{}', 'deadbeef')).toBe(false);
  });

  it('transaction methods throw PLATFORM_PAYSTACK_NOT_CONFIGURED when the secret is unset', async () => {
    delete process.env.PLATFORM_PAYSTACK_SECRET_KEY;
    await expect(
      platformPaystackService.initializeSubscriptionTransaction('a@b.c', 'PLN_x', 100, {}, 'https://cb'),
    ).rejects.toMatchObject({ errorCode: 'PLATFORM_PAYSTACK_NOT_CONFIGURED', statusCode: 503 });
  });
});
