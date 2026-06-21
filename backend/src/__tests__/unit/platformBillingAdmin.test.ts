import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

import { prismaMock } from '../mocks/prisma.mock';
import { grantFreePlan } from '../../services/platformService';
import { listBillingEvents } from '../../controllers/platformController';

function mockRes() {
  const res: any = {};
  res.json = jest.fn(() => res);
  res.status = jest.fn(() => res);
  return res;
}
const next = jest.fn();

describe('Free-plan grant (admin) + billing-events list (F3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('grantFreePlan with an expiry date → Free, active, expiry persisted', async () => {
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ id: 'T1' });
    (prismaMock.plan.findUnique as any).mockResolvedValue({ id: 'free-id', name: 'free' });
    (prismaMock.tenant.update as any).mockImplementation(async (a: any) => a.data);

    const expires = new Date('2026-12-31T00:00:00.000Z');
    await grantFreePlan('T1', expires);

    const updateArg = (prismaMock.tenant.update as any).mock.calls[0][0];
    expect(updateArg.data.currentPlanId).toBe('free-id');
    expect(updateArg.data.subscriptionStatus).toBe('active');
    expect(updateArg.data.freeAccessExpiresAt).toEqual(expires);
  });

  it('grantFreePlan with no date → free forever (null expiry)', async () => {
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ id: 'T1' });
    (prismaMock.plan.findUnique as any).mockResolvedValue({ id: 'free-id', name: 'free' });
    (prismaMock.tenant.update as any).mockImplementation(async (a: any) => a.data);

    await grantFreePlan('T1');

    const updateArg = (prismaMock.tenant.update as any).mock.calls[0][0];
    expect(updateArg.data.freeAccessExpiresAt).toBeNull();
  });

  it('listBillingEvents maps platform WebhookEvent rows to type/tenant/amount/timestamp', async () => {
    const ts = new Date('2026-06-11T10:00:00.000Z');
    (prismaMock.webhookEvent.findMany as any).mockResolvedValue([
      {
        id: 7,
        eventType: 'charge.success',
        reference: 'ref_1',
        receivedAt: ts,
        tenant: { id: 'T1', name: "Super's Company", currentPlan: { priceNGN: '10000' } },
      },
    ]);

    const req: any = { query: {} };
    const res = mockRes();
    await listBillingEvents(req, res, next);

    expect(prismaMock.webhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: 'paystack-platform' } }),
    );
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.events[0]).toMatchObject({
      type: 'charge.success',
      tenant: { id: 'T1', name: "Super's Company" },
      amountNGN: '10000',
    });
    expect(payload.events[0].timestamp).toEqual(ts);
  });
});
