import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';

// Sockets are irrelevant to assignment logic; stub them so no real IO module loads.
jest.mock('../../utils/socketInstance', () => ({
  getSocketInstance: () => null,
}));
jest.mock('../../sockets/index', () => ({
  emitOrderUpdated: jest.fn(),
  emitOrderAssigned: jest.fn(),
}));

import { executeAction } from '../../queues/workflowQueue';

const salesRepAction = (overrides: any = {}) => ({
  type: 'assign_user',
  config: {
    userType: 'sales_rep',
    distributionMode: 'even',
    assignments: [{ userId: 2, weight: 100 }],
    ...overrides,
  },
});

describe('executeAssignUserAction (via executeAction)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('forward-only (default: applyToAllUnassigned unset/false)', () => {
    it('assigns ONLY the triggering order and never sweeps history', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue({
        id: 100,
        customerRepId: null,
        orderItems: [],
      });
      (prismaMock.order.update as any).mockResolvedValue({ id: 100, customerRepId: 2 });

      const result = await executeAction(salesRepAction(), { id: 100 });

      expect(prismaMock.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 100 } })
      );
      // The bug was a tenant-wide sweep — findMany must NOT be used in forward-only mode.
      expect(prismaMock.order.findMany).not.toHaveBeenCalled();
      expect(prismaMock.order.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 100 }, data: { customerRepId: 2 } })
      );
      expect(result.assigned).toBe(1);
    });

    it('never swaps: leaves an order that already has a user untouched', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue({
        id: 100,
        customerRepId: 9, // already assigned to someone else
        orderItems: [],
      });

      const result = await executeAction(salesRepAction(), { id: 100 });

      expect(prismaMock.order.update).not.toHaveBeenCalled();
      expect(prismaMock.order.findMany).not.toHaveBeenCalled();
      expect(result.assigned).toBe(0);
    });

    it('does nothing when there is no triggering order in context', async () => {
      const result = await executeAction(salesRepAction(), {});

      expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.order.findMany).not.toHaveBeenCalled();
      expect(prismaMock.order.update).not.toHaveBeenCalled();
      expect(result.assigned).toBe(0);
    });
  });

  describe('opt-in backfill (applyToAllUnassigned: true)', () => {
    it('sweeps every currently-unassigned order for the role', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([
        { id: 1, customerRepId: null, orderItems: [] },
        { id: 2, customerRepId: null, orderItems: [] },
      ]);
      (prismaMock.order.update as any).mockResolvedValue({ id: 1, customerRepId: 2 });

      const result = await executeAction(
        salesRepAction({ applyToAllUnassigned: true }),
        { id: 999 } // triggering order ignored in backfill mode
      );

      expect(prismaMock.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerRepId: null } })
      );
      expect(prismaMock.order.update).toHaveBeenCalledTimes(2);
      expect(result.assigned).toBe(2);
    });
  });
});
