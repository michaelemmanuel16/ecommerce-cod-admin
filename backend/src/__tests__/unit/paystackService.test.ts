import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { clearPaystackConfigCache, paystackService } from '../../services/paystackService';

const originalEnv = process.env;
const originalFetch = global.fetch;

describe('paystackService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearPaystackConfigCache();
    process.env = {
      ...originalEnv,
      PAYSTACK_SECRET_KEY: 'sk_test_unit',
      PAYSTACK_PUBLIC_KEY: 'pk_test_unit',
    };
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          authorization_url: 'https://checkout.paystack.com/test',
          access_code: 'access-code',
          reference: 'ref-123',
        },
      }),
    } as any) as any;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    clearPaystackConfigCache();
  });

  it('initializes subscription checkout with the Paystack plan code', async () => {
    await paystackService.initializeSubscription(
      'owner@example.com',
      4900,
      'ghs',
      'PLN_test',
      { tenantId: 'tenant-123', planId: 'plan-1' },
      'https://app.example.com/billing',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/initialize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test_unit',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          email: 'owner@example.com',
          amount: 4900,
          currency: 'GHS',
          plan: 'PLN_test',
          metadata: {
            tenantId: 'tenant-123',
            planId: 'plan-1',
            billingKind: 'saas_subscription',
          },
          callback_url: 'https://app.example.com/billing',
        }),
      }),
    );
  });

  it('disables a subscription with code and email token', async () => {
    await paystackService.disableSubscription('SUB_test', 'email-token');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.paystack.co/subscription/disable',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'SUB_test', token: 'email-token' }),
      }),
    );
  });
});

