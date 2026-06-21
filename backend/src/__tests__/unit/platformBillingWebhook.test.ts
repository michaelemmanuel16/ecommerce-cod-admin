import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

import { prismaMock } from '../mocks/prisma.mock';
import { handlePlatformWebhook } from '../../controllers/platformBillingWebhookController';

const SECRET = 'sk_test_platform';

function signedReq(event: object) {
  const rawBody = JSON.stringify(event);
  const sig = crypto.createHmac('sha512', SECRET).update(rawBody).digest('hex');
  return { headers: { 'x-paystack-signature': sig }, rawBody, body: event } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('handlePlatformWebhook — SaaS subscription reconciliation', () => {
  const originalSecret = process.env.PLATFORM_PAYSTACK_SECRET_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PLATFORM_PAYSTACK_SECRET_KEY = SECRET;
    // Default happy-path resolution + idempotency row.
    (prismaMock.tenant.findFirst as any).mockResolvedValue({ id: 'T1' });
    (prismaMock.tenant.findUnique as any).mockResolvedValue({
      id: 'T1',
      paystackCustomerCode: null,
      paystackAuthorizationCode: null,
      paystackSubscriptionCode: null,
    });
    (prismaMock.webhookEvent.create as any).mockResolvedValue({ id: 1 });
    (prismaMock.tenant.update as any).mockResolvedValue({ id: 'T1' });
    (prismaMock.tenant.updateMany as any).mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.PLATFORM_PAYSTACK_SECRET_KEY;
    else process.env.PLATFORM_PAYSTACK_SECRET_KEY = originalSecret;
  });

  it('rejects a webhook with an invalid signature (401, no side effects)', async () => {
    const req: any = { headers: { 'x-paystack-signature': 'deadbeef' }, rawBody: '{}', body: {} };
    const res = mockRes();
    await handlePlatformWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });

  it('subscription.create → binds subscription code + active', async () => {
    const req = signedReq({
      event: 'subscription.create',
      data: {
        subscription_code: 'SUB_1',
        next_payment_date: '2026-07-11T00:00:00.000Z',
        customer: { customer_code: 'CUS_1' },
        plan: { plan_code: 'PLN_growth' },
      },
    });
    const res = mockRes();
    await handlePlatformWebhook(req, res);

    expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith({
      where: { paystackCustomerCode: 'CUS_1' },
      select: { id: true },
    });
    const updateArg = (prismaMock.tenant.update as any).mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'T1' });
    expect(updateArg.data.subscriptionStatus).toBe('active');
    expect(updateArg.data.paystackSubscriptionCode).toBe('SUB_1');
    expect(updateArg.data.subscriptionRenewsAt).toBeInstanceOf(Date);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('charge.success (saas_subscription) → resolves by metadata.tenantId, clears failure', async () => {
    const req = signedReq({
      event: 'charge.success',
      data: {
        reference: 'ref_1',
        amount: 1000000,
        metadata: { kind: 'saas_subscription', tenantId: 'T1', planId: 'growth' },
        customer: { customer_code: 'CUS_1' },
        next_payment_date: '2026-08-11T00:00:00.000Z',
      },
    });
    const res = mockRes();
    await handlePlatformWebhook(req, res);

    const updateArg = (prismaMock.tenant.update as any).mock.calls[0][0];
    expect(updateArg.data.subscriptionStatus).toBe('active');
    expect(updateArg.data.paymentFailedAt).toBeNull();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('charge.success that is NOT a subscription charge is ignored (no tenant update)', async () => {
    const req = signedReq({
      event: 'charge.success',
      data: { reference: 'ref_x', amount: 5000, metadata: {}, customer: { customer_code: 'CUS_9' } },
    });
    const res = mockRes();
    await handlePlatformWebhook(req, res);

    expect(prismaMock.webhookEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ignored: true }));
  });

  it('invoice.payment_failed → past_due + payment failure stamp', async () => {
    const req = signedReq({
      event: 'invoice.payment_failed',
      data: { subscription: { subscription_code: 'SUB_1' } },
    });
    const res = mockRes();
    await handlePlatformWebhook(req, res);

    expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith({
      where: { paystackSubscriptionCode: 'SUB_1' },
      select: { id: true },
    });
    const manyArg = (prismaMock.tenant.updateMany as any).mock.calls[0][0];
    expect(manyArg.where).toMatchObject({ id: 'T1', paymentFailedAt: null });
    expect(manyArg.data.subscriptionStatus).toBe('past_due');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('subscription.disable → cancelled', async () => {
    const req = signedReq({
      event: 'subscription.disable',
      data: { subscription_code: 'SUB_1' },
    });
    const res = mockRes();
    await handlePlatformWebhook(req, res);

    const updateArg = (prismaMock.tenant.update as any).mock.calls[0][0];
    expect(updateArg.data.subscriptionStatus).toBe('cancelled');
  });

  it('replayed event (P2002 on dedup insert) is acked without re-processing', async () => {
    (prismaMock.webhookEvent.create as any).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }),
    );
    const req = signedReq({
      event: 'subscription.create',
      data: { subscription_code: 'SUB_1', customer: { customer_code: 'CUS_1' } },
    });
    const res = mockRes();
    await handlePlatformWebhook(req, res);

    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true }));
  });

  it('deletes the dedup row when event processing throws (so retries can re-enter)', async () => {
    (prismaMock.tenant.update as any).mockRejectedValue(new Error('db blip'));
    const req = signedReq({
      event: 'subscription.disable',
      data: { subscription_code: 'SUB_1' },
    });
    const res = mockRes();
    await handlePlatformWebhook(req, res);

    expect(prismaMock.webhookEvent.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    // Outer catch still acks 200.
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
