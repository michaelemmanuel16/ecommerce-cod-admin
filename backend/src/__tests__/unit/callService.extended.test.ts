/**
 * Extended CallService tests for branch coverage
 * Covers missing branches: order customer mismatch, individual getCalls filters, date partial filters
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../server', () => {
  const m = { emit: jest.fn(), to: jest.fn() };
  m.to.mockReturnValue(m);
  return { io: m };
});

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { CallService } from '../../services/callService';
import { AppError } from '../../middleware/errorHandler';

const mockCustomer = { id: 1, firstName: 'Jane', lastName: 'Smith', phoneNumber: '+1234567890' };
const mockSalesRep = { id: 5, email: 'rep@example.com', role: 'sales_rep', firstName: 'John', lastName: 'Doe' };
const mockCall = {
  id: 1, customerId: 1, orderId: 100, salesRepId: 5, outcome: 'confirmed', duration: 120, notes: 'Test',
  createdAt: new Date(),
  salesRep: { id: 5, firstName: 'John', lastName: 'Doe' },
  customer: { id: 1, firstName: 'Jane', lastName: 'Smith', phoneNumber: '+1234567890' },
  order: { id: 100, status: 'confirmed' },
};

describe('CallService (extended branch coverage)', () => {
  let callService: CallService;

  beforeEach(() => {
    jest.clearAllMocks();
    callService = new CallService();
  });

  // ───────────────────────────── createCall - order mismatch ─────────────────────────────
  describe('createCall - order customer mismatch', () => {
    it('throws 400 when order belongs to different customer', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(mockCustomer as any);
      (prismaMock.order.findUnique as any).mockResolvedValue({ id: 100, customerId: 99 } as any); // different customer

      await expect(callService.createCall({
        customerId: 1,
        orderId: 100,
        salesRepId: 5,
        outcome: 'confirmed' as any,
      })).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── getCalls - individual filters ─────────────────────────────
  describe('getCalls - individual filter branches', () => {
    beforeEach(() => {
      (prismaMock.call.findMany as any).mockResolvedValue([mockCall] as any);
      (prismaMock.call.count as any).mockResolvedValue(1);
    });

    it('filters by customerId', async () => {
      const result = await callService.getCalls({ customerId: 1 });
      expect(prismaMock.call.findMany).toHaveBeenCalled();
      expect(result.calls).toHaveLength(1);
    });

    it('filters by orderId', async () => {
      const result = await callService.getCalls({ orderId: 100 });
      expect(prismaMock.call.findMany).toHaveBeenCalled();
      expect(result.calls).toHaveLength(1);
    });

    it('applies only startDate filter (no endDate)', async () => {
      const result = await callService.getCalls({ startDate: new Date('2024-01-01') });
      expect(result.calls).toHaveLength(1);
    });

    it('applies only endDate filter (no startDate)', async () => {
      const result = await callService.getCalls({ endDate: new Date('2024-12-31') });
      expect(result.calls).toHaveLength(1);
    });
  });

  // ───────────────────────────── getCallStats - partial date branches ─────────────────────────────
  describe('getCallStats - partial date filter branches', () => {
    const mockReps = [{ id: 5, firstName: 'John', lastName: 'Doe' }];

    beforeEach(() => {
      (prismaMock.user.findMany as any).mockResolvedValue(mockReps as any);
      (prismaMock.call.count as any).mockResolvedValue(5);
      (prismaMock.call.groupBy as any).mockResolvedValue([
        { outcome: 'confirmed', _count: 3 },
        { outcome: 'no_answer', _count: 2 },
      ] as any);
      (prismaMock.call.findMany as any).mockResolvedValue([
        { duration: 60, createdAt: new Date() },
        { duration: 120, createdAt: new Date() },
      ] as any);
    });

    it('applies only startDate to getCallStats (no endDate)', async () => {
      const result = await callService.getCallStats({ startDate: new Date('2024-01-01') });
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
    });

    it('applies only endDate to getCallStats (no startDate)', async () => {
      const result = await callService.getCallStats({ endDate: new Date('2024-12-31') });
      expect(result).toBeDefined();
    });

    it('calculates avgDuration = 0 when no calls with duration', async () => {
      (prismaMock.call.findMany as any).mockResolvedValue([] as any); // no calls with duration
      const result = await callService.getCallStats({});
      expect(result[0].avgDuration).toBe(0);
    });
  });
});
