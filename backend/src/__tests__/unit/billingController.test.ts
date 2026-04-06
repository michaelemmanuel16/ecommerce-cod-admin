import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';

// Mock server and queue modules
jest.mock('../../server', () => ({ io: { emit: jest.fn(), to: jest.fn().mockReturnThis() } }));
jest.mock('../../queues/workflowQueue', () => ({ workflowQueue: { add: jest.fn() } }));
// Mock tenantContext to return a tenant ID (required for billing controller)
jest.mock('../../utils/tenantContext');

import { listPlans, getSubscription, upgradePlan } from '../../controllers/billingController';
import { AppError } from '../../middleware/errorHandler';
import * as tenantContext from '../../utils/tenantContext';

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
});
