import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/jwt', () => ({
  generateAccessToken: jest.fn(() => 'access'),
  generateRefreshToken: jest.fn(() => 'refresh'),
  verifyRefreshToken: jest.fn(),
}));

import { prismaMock } from '../mocks/prisma.mock';
import { registerTenant } from '../../controllers/authController';

function mockRes() {
  const res: any = {};
  res.json = jest.fn(() => res);
  res.status = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  return res;
}
const next = jest.fn();

describe('registerTenant — pricing-first plan selection (MAN-61)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
    (prismaMock.user.findUnique as any).mockResolvedValue(null); // email free
    (prismaMock.tenant.findUnique as any).mockResolvedValue(null); // slug free
    (prismaMock.tenant.create as any).mockImplementation(async (args: any) => ({
      id: 'T1', name: args.data.name, slug: args.data.slug,
    }));
    (prismaMock.user.create as any).mockResolvedValue({
      id: 1, email: 'a@b.c', firstName: 'A', lastName: 'B', role: 'super_admin', tenantId: 'T1', preferences: {},
    });
    (prismaMock.user.update as any).mockResolvedValue({ id: 1 });
  });

  const baseBody = { companyName: 'Acme', adminEmail: 'a@b.c', adminPassword: 'pw', adminName: 'A B' };

  it('registering with planName=growth lands the tenant on growth + pending', async () => {
    (prismaMock.plan.findFirst as any).mockResolvedValue({ id: 'plan-growth', name: 'growth', isActive: true });

    const req: any = { body: { ...baseBody, planName: 'growth' } };
    const res = mockRes();
    await registerTenant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const createArg = (prismaMock.tenant.create as any).mock.calls[0][0];
    expect(createArg.data.currentPlanId).toBe('plan-growth');
    expect(createArg.data.subscriptionStatus).toBe('pending');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('accepts planId as an alias for the plan name', async () => {
    (prismaMock.plan.findFirst as any).mockResolvedValue({ id: 'plan-scale', name: 'scale', isActive: true });
    const req: any = { body: { ...baseBody, planId: 'scale' } };
    await registerTenant(req, mockRes(), next);
    const createArg = (prismaMock.tenant.create as any).mock.calls[0][0];
    expect(createArg.data.currentPlanId).toBe('plan-scale');
    expect(createArg.data.subscriptionStatus).toBe('pending');
  });

  it('rejects a non-self-serve plan (e.g. enterprise) with 400', async () => {
    (prismaMock.plan.findFirst as any).mockResolvedValue({ id: 'plan-ent', name: 'enterprise', isActive: true });
    const req: any = { body: { ...baseBody, planName: 'enterprise' } };
    await registerTenant(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('registering without a plan creates the tenant with no plan (back-compat)', async () => {
    const req: any = { body: { ...baseBody } };
    const res = mockRes();
    await registerTenant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.plan.findFirst).not.toHaveBeenCalled();
    const createArg = (prismaMock.tenant.create as any).mock.calls[0][0];
    expect(createArg.data.currentPlanId).toBeUndefined();
    expect(createArg.data.subscriptionStatus).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
