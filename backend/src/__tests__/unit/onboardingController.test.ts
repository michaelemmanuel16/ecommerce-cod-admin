import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';

jest.mock('../../server', () => ({ io: { emit: jest.fn(), to: jest.fn().mockReturnThis() } }));
jest.mock('../../queues/workflowQueue', () => ({ workflowQueue: { add: jest.fn() } }));

import { setupOnboarding, getOnboardingStatus } from '../../controllers/onboardingController';
import { AppError } from '../../middleware/errorHandler';

const mockUser = {
  id: 1,
  email: 'admin@test.com',
  role: 'super_admin',
  tenantId: 'tenant-123',
};

const mockTenant = {
  id: 'tenant-123',
  name: 'Test Co',
  slug: 'test-co',
  logo: null,
  region: 'GH',
  currency: 'GHS',
  defaultDeliveryFee: 20,
};

function makeReq(body = {}, user = mockUser) {
  return { user, body } as any;
}

function makeRes() {
  return { json: jest.fn() } as any;
}

function makeNext() {
  return jest.fn() as any;
}

describe('OnboardingController', () => {
  describe('setupOnboarding', () => {
    it('should update tenant and mark onboarding complete', async () => {
      (prismaMock.tenant.update as any).mockResolvedValue(mockTenant);
      (prismaMock.user.findUnique as any).mockResolvedValue({ preferences: {} });
      (prismaMock.user.update as any).mockResolvedValue({ ...mockUser, preferences: { onboardingCompleted: true } });

      const req = makeReq({ region: 'GH', currency: 'GHS', defaultDeliveryFee: 20 });
      const res = makeRes();
      await setupOnboarding(req, res, makeNext());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Onboarding setup complete' })
      );
      expect(prismaMock.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tenant-123' } })
      );
    });

    it('should throw 401 when no user', async () => {
      const next = makeNext();
      await setupOnboarding({ user: null, body: {} } as any, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });

    it('should throw 400 when user has no tenantId', async () => {
      const next = makeNext();
      await setupOnboarding(makeReq({}, { ...mockUser, tenantId: null } as any), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });

  describe('getOnboardingStatus', () => {
    it('should return onboardingCompleted true when set', async () => {
      (prismaMock.user.findUnique as any).mockResolvedValue({
        preferences: { onboardingCompleted: true },
        tenantId: 'tenant-123',
      });

      const res = makeRes();
      await getOnboardingStatus(makeReq(), res, makeNext());

      expect(res.json).toHaveBeenCalledWith({ onboardingCompleted: true });
    });

    it('should return false when preferences are empty', async () => {
      (prismaMock.user.findUnique as any).mockResolvedValue({ preferences: {}, tenantId: 'tenant-123' });
      const res = makeRes();
      await getOnboardingStatus(makeReq(), res, makeNext());
      expect(res.json).toHaveBeenCalledWith({ onboardingCompleted: false });
    });
  });
});
