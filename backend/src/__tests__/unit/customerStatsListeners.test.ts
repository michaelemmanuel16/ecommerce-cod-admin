import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  prismaBase: { $executeRaw: jest.fn(), order: { findUnique: jest.fn() } },
}));

import { prismaBase } from '../../utils/prisma';
import { customerStatsService } from '../../services/customerStatsService';

const base = prismaBase as any;

describe('customerStatsService listeners', () => {
  beforeEach(() => { jest.clearAllMocks(); base.$executeRaw.mockResolvedValue(1); });

  it('order.status_changed recomputes the customer of the order', async () => {
    base.order.findUnique.mockResolvedValue({ customerId: 7 });
    await customerStatsService.onOrderEvent({
      orderId: 5, tenantId: 't1', from: 'delivered', to: 'returned', actor: { kind: 'user' }, depth: 0,
    });
    expect(base.order.findUnique).toHaveBeenCalledWith({ where: { id: 5 }, select: { customerId: true } });
    expect(base.$executeRaw).toHaveBeenCalledTimes(1);
    expect(base.$executeRaw.mock.calls[0][0].values).toContain(7);
  });

  it('order.deleted recomputes the customer carried by the event', async () => {
    await customerStatsService.onOrderDeleted({ orderId: 5, tenantId: 't1', customerId: 9 });
    expect(base.order.findUnique).not.toHaveBeenCalled();
    expect(base.$executeRaw.mock.calls[0][0].values).toContain(9);
  });

  it('a missing order recomputes nothing', async () => {
    base.order.findUnique.mockResolvedValue(null);
    await customerStatsService.onOrderEvent({ orderId: 5, tenantId: 't1', status: 'pending_confirmation' });
    expect(base.$executeRaw).not.toHaveBeenCalled();
  });

  it('a failing recompute never throws into the caller', async () => {
    base.order.findUnique.mockResolvedValue({ customerId: 7 });
    base.$executeRaw.mockRejectedValue(new Error('db down'));
    await expect(customerStatsService.onOrderEvent({ orderId: 5, tenantId: 't1', status: 'pending_confirmation' })).resolves.toBeUndefined();
  });
});
