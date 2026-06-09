import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

// providerCrypto decryption is a pass-through for plaintext values (no
// PROVIDER_ENCRYPTION_KEY set), so we don't need to mock it.

import { prismaMock } from '../mocks/prisma.mock';
import { paystackService, clearPaystackConfigCache } from '../../services/paystackService';

const originalFetch = global.fetch;

describe('paystackService — per-tenant scoping', () => {
  beforeEach(() => {
    clearPaystackConfigCache();
    jest.clearAllMocks();
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('initializeTransaction calls Paystack with the tenant\'s secret', async () => {
    (prismaMock.systemConfig.findUnique as any).mockResolvedValue({
      paystackProvider: {
        publicKey: 'pk_test_A',
        secretKey: 'sk_test_A',
        mode: 'test',
        isEnabled: true,
      },
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { authorization_url: 'https://paystack.co/x', reference: 'ref_1' } }),
    });

    await paystackService.initializeTransaction(
      'tenant-A',
      'buyer@example.com',
      10000,
      'GHS',
      { orderId: 1 },
    );

    expect(prismaMock.systemConfig.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-A' },
      select: { paystackProvider: true },
    });
    const fetchCall = (global.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe('Bearer sk_test_A');
  });

  it('two tenants resolve to separate secret keys', async () => {
    (prismaMock.systemConfig.findUnique as any).mockImplementation(async (args: any) => {
      if (args.where.tenantId === 'tenant-A') {
        return { paystackProvider: { publicKey: 'pk_A', secretKey: 'sk_A', mode: 'test', isEnabled: true } };
      }
      if (args.where.tenantId === 'tenant-B') {
        return { paystackProvider: { publicKey: 'pk_B', secretKey: 'sk_B', mode: 'live', isEnabled: true } };
      }
      return null;
    });

    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });

    await paystackService.verifyTransaction('tenant-A', 'ref_x');
    expect((global.fetch as any).mock.calls[0][1].headers.Authorization).toBe('Bearer sk_A');

    await paystackService.verifyTransaction('tenant-B', 'ref_x');
    expect((global.fetch as any).mock.calls[1][1].headers.Authorization).toBe('Bearer sk_B');
  });

  it('initializeTransaction throws if the tenant has no Paystack config', async () => {
    (prismaMock.systemConfig.findUnique as any).mockResolvedValue(null);

    await expect(
      paystackService.initializeTransaction('tenant-empty', 'a@b.c', 100, 'GHS', {}),
    ).rejects.toThrow(/not configured/i);
  });

  it('initializeTransaction throws if the tenant has Paystack disabled', async () => {
    (prismaMock.systemConfig.findUnique as any).mockResolvedValue({
      paystackProvider: { publicKey: 'pk', secretKey: 'sk', isEnabled: false },
    });

    await expect(
      paystackService.initializeTransaction('tenant-disabled', 'a@b.c', 100, 'GHS', {}),
    ).rejects.toThrow(/disabled/i);
  });

  it('getPublicKey returns the tenant\'s public key', async () => {
    (prismaMock.systemConfig.findUnique as any).mockResolvedValue({
      paystackProvider: { publicKey: 'pk_test_visible', secretKey: 'sk', isEnabled: true },
    });

    const key = await paystackService.getPublicKey('tenant-A');
    expect(key).toBe('pk_test_visible');
  });

  it('validateWebhookSignature uses the tenant\'s secret key (Paystack signs with sk)', async () => {
    const crypto = await import('crypto');
    const secret = 'sk_test_tenantA';
    (prismaMock.systemConfig.findUnique as any).mockResolvedValue({
      paystackProvider: { publicKey: 'pk', secretKey: secret, isEnabled: true },
    });

    const rawBody = JSON.stringify({ event: 'charge.success' });
    const validSig = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    expect(await paystackService.validateWebhookSignature('tenant-A', rawBody, validSig)).toBe(true);

    const wrongSig = crypto.createHmac('sha512', 'wrong-secret').update(rawBody).digest('hex');
    expect(await paystackService.validateWebhookSignature('tenant-A', rawBody, wrongSig)).toBe(false);
  });
});
