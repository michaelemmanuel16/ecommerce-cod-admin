/**
 * Extended PayoutService tests for branch coverage
 * Covers: commissionAmount || 0 falsy branch, delivery.actualDeliveryTime falsy path
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import payoutService from '../../services/payoutService';
import { OrderStatus } from '@prisma/client';

jest.mock('../../services/glAutomationService', () => ({
  GLAutomationService: {
    recordCommissionPayout: jest.fn().mockResolvedValue({ id: 1, transactions: [] })
  }
}));

describe('PayoutService (extended branch coverage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPendingPayments - commissionAmount falsy branch', () => {
    it('defaults commissionAmount to 0 when rep has no commission set (null)', async () => {
      const mockRep = { id: 1, commissionAmount: null };
      const mockOrders = [{
        id: 1, totalAmount: 200, updatedAt: new Date(),
        customer: { firstName: 'Ama', lastName: 'Asante' },
        delivery: { actualDeliveryTime: new Date() },
      }];

      (prismaMock.user.findUnique as any).mockResolvedValue(mockRep as any);
      (prismaMock.order.findMany as any).mockResolvedValue(mockOrders as any);

      const result = await payoutService.getPendingPayments(1);
      expect(result[0].commissionAmount).toBe(0);
    });

    it('defaults commissionAmount to 0 when rep has 0 commission', async () => {
      const mockRep = { id: 1, commissionAmount: 0 };
      const mockOrders = [{
        id: 1, totalAmount: 100, updatedAt: new Date(),
        customer: { firstName: 'Kofi', lastName: 'Boateng' },
        delivery: null,
      }];

      (prismaMock.user.findUnique as any).mockResolvedValue(mockRep as any);
      (prismaMock.order.findMany as any).mockResolvedValue(mockOrders as any);

      const result = await payoutService.getPendingPayments(1);
      expect(result[0].commissionAmount).toBe(0);
    });
  });
});
