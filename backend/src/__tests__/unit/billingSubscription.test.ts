import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

// Tenant context — these controllers read the active tenant via getTenantId().
const mockGetTenantId = jest.fn<() => string | null>(() => 'T1');
jest.mock('../../utils/tenantContext', () => ({
  getTenantId: () => mockGetTenantId(),
}));

// Mock the platform Paystack service (no real HTTP).
const mockInit = jest.fn();
const mockVerify = jest.fn();
const mockGetSub = jest.fn();
const mockDisable = jest.fn();
jest.mock('../../services/platformPaystackService', () => ({
  isPlatformBillingConfigured: jest.fn(() => true),
  platformPaystackService: {
    initializeSubscriptionTransaction: (...a: any[]) => (mockInit as any)(...a),
    verifyTransaction: (...a: any[]) => (mockVerify as any)(...a),
    getSubscription: (...a: any[]) => (mockGetSub as any)(...a),
    disableSubscription: (...a: any[]) => (mockDisable as any)(...a),
  },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { startSubscription, verifySubscription, cancelSubscription } from '../../controllers/billingController';

function mockRes() {
  const res: any = {};
  res.json = jest.fn(() => res);
  res.status = jest.fn(() => res);
  return res;
}
const next = jest.fn();

describe('billing subscription endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTenantId.mockReturnValue('T1');
  });

  it('startSubscription returns the auth URL and passes the plan code + server-computed amount', async () => {
    (prismaMock.plan.findFirst as any).mockResolvedValue({
      id: 'plan-growth', name: 'growth', isActive: true, paystackPlanCode: 'PLN_growth', priceNGN: '10000',
    });
    mockInit.mockResolvedValue({ authorization_url: 'https://paystack.co/x', reference: 'ref_1' });

    const req: any = { body: { planName: 'growth' }, user: { email: 'owner@t.com' } };
    const res = mockRes();
    await startSubscription(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const args = mockInit.mock.calls[0];
    expect(args[0]).toBe('owner@t.com');
    expect(args[1]).toBe('PLN_growth');
    expect(args[2]).toBe(1000000); // ₦10,000 → kobo, computed from the plan row
    expect(args[3]).toMatchObject({ tenantId: 'T1', kind: 'saas_subscription' });
    expect(res.json).toHaveBeenCalledWith({ authorizationUrl: 'https://paystack.co/x', reference: 'ref_1' });
  });

  it('startSubscription rejects a plan with no Paystack code (Enterprise/Free)', async () => {
    (prismaMock.plan.findFirst as any).mockResolvedValue({
      id: 'plan-ent', name: 'enterprise', isActive: true, paystackPlanCode: null, priceNGN: null,
    });
    const req: any = { body: { planName: 'enterprise' }, user: { email: 'owner@t.com' } };
    await startSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('verifySubscription binds the subscription + marks active on a successful charge', async () => {
    mockVerify.mockResolvedValue({
      data: {
        status: 'success',
        metadata: { tenantId: 'T1', planId: 'plan-growth' },
        customer: { customer_code: 'CUS_1' },
        authorization: { authorization_code: 'AUTH_1', last4: '4242' },
        subscription_code: 'SUB_1',
        next_payment_date: '2026-07-11T00:00:00.000Z',
      },
    });
    (prismaMock.tenant.findUnique as any).mockResolvedValue({
      paystackCustomerCode: null, paystackAuthorizationCode: null, paystackSubscriptionCode: null,
    });
    (prismaMock.tenant.update as any).mockResolvedValue({ id: 'T1' });

    const req: any = { params: { reference: 'ref_1' } };
    const res = mockRes();
    await verifySubscription(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const updateArg = (prismaMock.tenant.update as any).mock.calls[0][0];
    expect(updateArg.data.subscriptionStatus).toBe('active');
    expect(updateArg.data.paystackSubscriptionCode).toBe('SUB_1');
    expect(updateArg.data.currentPlanId).toBe('plan-growth');
    expect(res.json).toHaveBeenCalledWith({ status: 'active' });
  });

  it('verifySubscription refuses to bind a transaction for a different tenant', async () => {
    mockVerify.mockResolvedValue({
      data: { status: 'success', metadata: { tenantId: 'OTHER', planId: 'plan-growth' } },
    });
    const req: any = { params: { reference: 'ref_1' } };
    await verifySubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });

  it('verifySubscription rejects an unsuccessful payment', async () => {
    mockVerify.mockResolvedValue({ data: { status: 'failed' } });
    const req: any = { params: { reference: 'ref_1' } };
    await verifySubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('cancelSubscription fetches the email token then disables the subscription', async () => {
    (prismaMock.tenant.findUnique as any).mockResolvedValue({
      paystackSubscriptionCode: 'SUB_1', subscriptionRenewsAt: new Date('2026-07-11T00:00:00.000Z'),
    });
    mockGetSub.mockResolvedValue({ data: { email_token: 'tok_1' } });
    mockDisable.mockResolvedValue(undefined);
    (prismaMock.tenant.update as any).mockResolvedValue({ id: 'T1' });

    const req: any = {};
    const res = mockRes();
    await cancelSubscription(req, res, next);

    expect(mockGetSub).toHaveBeenCalledWith('SUB_1');
    expect(mockDisable).toHaveBeenCalledWith('SUB_1', 'tok_1');
    const updateArg = (prismaMock.tenant.update as any).mock.calls[0][0];
    expect(updateArg.data.subscriptionStatus).toBe('cancelled');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  it('cancelSubscription 400s when there is no subscription to cancel', async () => {
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ paystackSubscriptionCode: null });
    const req: any = {};
    await cancelSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockDisable).not.toHaveBeenCalled();
  });
});
