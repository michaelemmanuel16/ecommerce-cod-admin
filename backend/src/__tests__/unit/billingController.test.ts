import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';

// Mock server and queue modules
jest.mock('../../server', () => ({ io: { emit: jest.fn(), to: jest.fn().mockReturnThis() } }));
jest.mock('../../queues/workflowQueue', () => ({ workflowQueue: { add: jest.fn() } }));
// Mock tenantContext to return a tenant ID (required for billing controller)
jest.mock('../../utils/tenantContext');
jest.mock('../../services/paystackService', () => ({
  paystackService: {
    initializeSubscription: jest.fn(),
    disableSubscription: jest.fn(),
  },
}));

import {
  listPlans,
  getSubscription,
  startSubscription,
  cancelSubscription,
  upgradePlan,
} from '../../controllers/billingController';
import { AppError } from '../../middleware/errorHandler';
import * as tenantContext from '../../utils/tenantContext';
import { paystackService } from '../../services/paystackService';

const mockTenant = {
  id: 'tenant-123',
  name: 'Test Tenant',
  slug: 'test-tenant',
  plan: 'starter',
  subscriptionStatus: 'trial',
  trialEndsAt: new Date('2026-04-30'),
  currentPlan: null,
  currentPlanId: null,
};

const mockPlan = {
  id: 'plan-1',
  name: 'starter',
  displayName: 'Starter',
  priceGHS: 0,
  maxOrders: 100,
  isActive: true,
  paystackPlanCode: 'PLN_test',
};

function makeRes() {
  const res: any = { json: jest.fn() };
  return res;
}

function makeNext() {
  return jest.fn() as any;
}

describe('BillingController', () => {
  beforeEach(() => {
    jest.spyOn(tenantContext, 'getTenantId').mockReturnValue('tenant-123');
  });
  describe('listPlans', () => {
    it('should return active plans ordered by price', async () => {
      (prismaMock.plan.findMany as any).mockResolvedValue([mockPlan]);
      const res = makeRes();
      await listPlans({} as any, res, makeNext());
      expect(res.json).toHaveBeenCalledWith({ plans: [mockPlan] });
      expect(prismaMock.plan.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { priceGHS: 'asc' },
      });
    });

    it('should call next on database error', async () => {
      const err = new Error('DB error');
      (prismaMock.plan.findMany as any).mockRejectedValue(err);
      const next = makeNext();
      await listPlans({} as any, makeRes(), next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('getSubscription', () => {
    it('should return subscription with usage stats', async () => {
      (prismaMock.tenant.findUnique as any).mockResolvedValue({
        ...mockTenant,
        currentPlan: mockPlan,
      });
      (prismaMock.order.count as any).mockResolvedValue(42);

      const res = makeRes();
      const next = makeNext();
      await getSubscription({} as any, res, next);

      // If next was called with an error, surface it for debugging
      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionStatus: 'trial',
          usage: expect.objectContaining({ ordersThisMonth: 42 }),
        })
      );
    });

    it('should throw 404 when tenant not found', async () => {
      (prismaMock.tenant.findUnique as any).mockResolvedValue(null);
      const next = makeNext();
      await getSubscription({} as any, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });

  describe('upgradePlan', () => {
    it('should upgrade tenant plan', async () => {
      (prismaMock.plan.findUnique as any).mockResolvedValue(mockPlan);
      (prismaMock.tenant.update as any).mockResolvedValue({
        ...mockTenant,
        plan: 'starter',
        currentPlan: mockPlan,
      });

      const req = { body: { planName: 'starter' } } as any;
      const res = makeRes();
      await upgradePlan(req, res, makeNext());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Starter') })
      );
    });

    it('should throw 400 when planName missing', async () => {
      const next = makeNext();
      await upgradePlan({ body: {} } as any, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });

    it('should throw 404 when plan not found', async () => {
      (prismaMock.plan.findUnique as any).mockResolvedValue(null);
      const next = makeNext();
      await upgradePlan({ body: { planName: 'unknown' } } as any, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });

  describe('startSubscription', () => {
    it('should initialize Paystack hosted checkout with plan code', async () => {
      (prismaMock.plan.findUnique as any).mockResolvedValue(mockPlan);
      (prismaMock.tenant.findUnique as any).mockResolvedValue({ currency: 'GHS' });
      (paystackService.initializeSubscription as jest.Mock).mockResolvedValue({
        authorization_url: 'https://checkout.paystack.com/test',
        access_code: 'access-code',
        reference: 'ref-123',
      } as never);

      const req = {
        params: { planId: 'plan-1' },
        user: { email: 'owner@example.com' },
      } as any;
      const res = makeRes();
      const next = makeNext();

      await startSubscription(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(paystackService.initializeSubscription).toHaveBeenCalledWith(
        'owner@example.com',
        0,
        'GHS',
        'PLN_test',
        expect.objectContaining({ tenantId: 'tenant-123', planId: 'plan-1' }),
        undefined,
      );
      expect(res.json).toHaveBeenCalledWith({
        authorizationUrl: 'https://checkout.paystack.com/test',
        accessCode: 'access-code',
        reference: 'ref-123',
      });
    });

    it('should reject plans without a Paystack plan code', async () => {
      (prismaMock.plan.findUnique as any).mockResolvedValue({ ...mockPlan, paystackPlanCode: null });
      const next = makeNext();

      await startSubscription(
        { params: { planId: 'plan-1' }, user: { email: 'owner@example.com' } } as any,
        makeRes(),
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(paystackService.initializeSubscription).not.toHaveBeenCalled();
    });
  });

  describe('cancelSubscription', () => {
    it('should disable the stored Paystack subscription and mark tenant cancelled', async () => {
      (prismaMock.tenant.findUnique as any).mockResolvedValue({
        paystackSubscriptionCode: 'SUB_test',
        paystackSubscriptionToken: 'email-token',
      });
      (paystackService.disableSubscription as jest.Mock).mockResolvedValue({ status: true } as never);
      (prismaMock.tenant.update as any).mockResolvedValue({
        ...mockTenant,
        subscriptionStatus: 'cancelled',
      });

      const res = makeRes();
      const next = makeNext();
      await cancelSubscription({} as any, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(paystackService.disableSubscription).toHaveBeenCalledWith('SUB_test', 'email-token');
      expect(prismaMock.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tenant-123' },
          data: expect.objectContaining({
            subscriptionStatus: 'cancelled',
            paystackSubscriptionCode: null,
            paystackSubscriptionToken: null,
          }),
        }),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Subscription cancelled' }),
      );
    });

    it('should reject cancellation when no subscription is stored', async () => {
      (prismaMock.tenant.findUnique as any).mockResolvedValue({
        paystackSubscriptionCode: null,
        paystackSubscriptionToken: null,
      });
      const next = makeNext();

      await cancelSubscription({} as any, makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(paystackService.disableSubscription).not.toHaveBeenCalled();
    });
  });
});
