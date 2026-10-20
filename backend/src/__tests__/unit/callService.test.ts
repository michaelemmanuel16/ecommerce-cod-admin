import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent it from starting
jest.mock('../../server', () => {
  const m = {
    emit: jest.fn(),
    to: jest.fn(),
  };
  m.to.mockReturnValue(m);
  return { io: m };
});

// Import prismaMock first to activate the jest.mock in prisma.mock.ts
import { prismaMock } from '../mocks/prisma.mock';
import { CallService } from '../../services/callService';
import { AppError } from '../../middleware/errorHandler';
import { useTestTenant } from '../mocks/tenant.mock';

describe('CallService', () => {
  useTestTenant();
  let callService: CallService;

  beforeEach(() => {
    callService = new CallService();
    jest.clearAllMocks();
  });

  describe('createCall', () => {
    const validCallData = {
      customerId: 1,
      orderId: 100,
      salesRepId: 5,
      outcome: 'confirmed' as const,
      duration: 120,
      notes: 'Customer confirmed delivery address'
    };

    const mockSalesRep = {
      id: 5,
      email: 'rep@example.com',
      role: 'sales_rep',
      firstName: 'John',
      lastName: 'Doe'
    };

    const mockCustomer = {
      id: 1,
      firstName: 'Jane',
      lastName: 'Smith',
      phoneNumber: '+1234567890'
    };

    const mockOrder = {
      id: 100,
      customerId: 1, // Must match validCallData.customerId
      status: 'confirmed'
    };

    const mockCreatedCall = {
      id: 1,
      ...validCallData,
      createdAt: new Date(),
      salesRep: mockSalesRep,
      customer: mockCustomer,
      order: mockOrder
    };

    it('clamps a future startedAt to now and an early one to the order creation time', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockSalesRep as any);
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      const createdAt = new Date('2026-10-01T10:00:00Z');
      prismaMock.order.findUnique.mockResolvedValue({ ...mockOrder, createdAt } as any);
      prismaMock.call.create.mockResolvedValue(mockCreatedCall as any);
      prismaMock.order.updateMany.mockResolvedValue({ count: 1 } as any);

      const before = Date.now();
      await callService.createCall({ ...validCallData, startedAt: new Date(Date.now() + 86_400_000) });
      const future = (prismaMock.call.create.mock.calls[0][0] as any).data.startedAt as Date;
      expect(future.getTime()).toBeGreaterThanOrEqual(before);
      expect(future.getTime()).toBeLessThanOrEqual(Date.now());

      await callService.createCall({ ...validCallData, startedAt: new Date('2026-09-01T00:00:00Z') });
      expect((prismaMock.call.create.mock.calls[1][0] as any).data.startedAt).toEqual(createdAt);
      expect((prismaMock.order.updateMany.mock.calls[1][0] as any).data.firstContactAt).toEqual(createdAt);
    });

    it('sets firstContactAt on the first call and not on the second (race-safe updateMany)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockSalesRep as any);
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.call.create.mockResolvedValue(mockCreatedCall as any);
      const first = new Date('2026-10-20T08:00:00Z');
      const second = new Date('2026-10-20T09:00:00Z');
      // Stateful stand-in for the DB: only a null firstContactAt matches the where clause.
      let stored: Date | null = null;
      prismaMock.order.updateMany.mockImplementation((async (args: any) => {
        if (args.where.firstContactAt === null && stored === null) {
          stored = args.data.firstContactAt;
          return { count: 1 };
        }
        return { count: 0 };
      }) as any);

      await callService.createCall({ ...validCallData, startedAt: first });
      expect(stored).toEqual(first);
      await callService.createCall({ ...validCallData, startedAt: second });
      expect(stored).toEqual(first);

      expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
        where: { id: 100, firstContactAt: null },
        data: { firstContactAt: first }
      });
      const createData = (prismaMock.call.create.mock.calls[0][0] as any).data;
      expect(createData.startedAt).toEqual(first);
      expect(createData.source).toBe('manual');
    });

    it('should create a call successfully with valid data', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockSalesRep as any);
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.call.create.mockResolvedValue(mockCreatedCall as any);

      const result = await callService.createCall(validCallData);

      expect(result).toEqual(mockCreatedCall);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: validCallData.salesRepId }
      });
      expect(prismaMock.customer.findUnique).toHaveBeenCalledWith({
        where: { id: validCallData.customerId }
      });
      expect(prismaMock.order.findUnique).toHaveBeenCalledWith({
        where: { id: validCallData.orderId }
      });
      expect(prismaMock.call.create).toHaveBeenCalled();
    });

    it('should create a call without orderId', async () => {
      const dataWithoutOrder = { ...validCallData, orderId: undefined };
      prismaMock.user.findUnique.mockResolvedValue(mockSalesRep as any);
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.call.create.mockResolvedValue({ ...mockCreatedCall, orderId: null, order: null } as any);

      const result = await callService.createCall(dataWithoutOrder);

      expect(result).toBeDefined();
      expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
    });

    it('should throw error if sales rep does not exist', async () => {
      const dataWithoutOrder = { ...validCallData, orderId: undefined };
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(callService.createCall(dataWithoutOrder)).rejects.toThrow(
        new AppError('Invalid user', 400)
      );
    });

    it('should throw error if sales rep does not have permission', async () => {
      const dataWithoutOrder = { ...validCallData, orderId: undefined };
      const deliveryAgent = { ...mockSalesRep, role: 'delivery_agent' };
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.user.findUnique.mockResolvedValue(deliveryAgent as any);

      await expect(callService.createCall(dataWithoutOrder)).rejects.toThrow(
        new AppError('User does not have permission to log calls', 403)
      );
    });

    it('should allow admin to log calls', async () => {
      const admin = { ...mockSalesRep, role: 'admin' };
      prismaMock.user.findUnique.mockResolvedValue(admin as any);
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.call.create.mockResolvedValue(mockCreatedCall as any);

      const result = await callService.createCall(validCallData);

      expect(result).toBeDefined();
    });

    it('should allow manager to log calls', async () => {
      const manager = { ...mockSalesRep, role: 'manager' };
      prismaMock.user.findUnique.mockResolvedValue(manager as any);
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.call.create.mockResolvedValue(mockCreatedCall as any);

      const result = await callService.createCall(validCallData);

      expect(result).toBeDefined();
    });

    it('should allow super_admin to log calls', async () => {
      const superAdmin = { ...mockSalesRep, role: 'super_admin' };
      prismaMock.user.findUnique.mockResolvedValue(superAdmin as any);
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.call.create.mockResolvedValue(mockCreatedCall as any);

      const result = await callService.createCall(validCallData);

      expect(result).toBeDefined();
    });

    it('should throw error if customer does not exist', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      await expect(callService.createCall(validCallData)).rejects.toThrow(
        new AppError('Customer not found', 404)
      );
    });

    it('should throw error if order does not exist when orderId is provided', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.order.findUnique.mockResolvedValue(null);

      await expect(callService.createCall(validCallData)).rejects.toThrow(
        new AppError('Order not found', 404)
      );
    });
  });

  describe('getCalls', () => {
    const mockCalls = [
      {
        id: 1,
        customerId: 1,
        orderId: 100,
        salesRepId: 5,
        outcome: 'confirmed',
        duration: 120,
        notes: 'Test call',
        createdAt: new Date(),
        salesRep: { id: 5, firstName: 'John', lastName: 'Doe' },
        customer: { id: 1, firstName: 'Jane', lastName: 'Smith', phoneNumber: '+1234567890' },
        order: { id: 100, status: 'confirmed' }
      }
    ];

    it('should return calls with default pagination', async () => {
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);
      prismaMock.call.count.mockResolvedValue(1);

      const result = await callService.getCalls({});

      expect(result.calls).toEqual(mockCalls);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(50);
      expect(result.pagination.pages).toBe(1);
    });

    it('should filter calls by outcome', async () => {
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);
      prismaMock.call.count.mockResolvedValue(1);

      await callService.getCalls({ outcome: 'confirmed' });

      expect(prismaMock.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ outcome: 'confirmed' })
        })
      );
    });

    it('should filter calls by salesRepId', async () => {
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);
      prismaMock.call.count.mockResolvedValue(1);

      await callService.getCalls({ salesRepId: 5 });

      expect(prismaMock.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ salesRepId: 5 })
        })
      );
    });

    it('should filter calls by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);
      prismaMock.call.count.mockResolvedValue(1);

      await callService.getCalls({ startDate, endDate });

      expect(prismaMock.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: startDate, lte: endDate }
          })
        })
      );
    });

    it('should handle custom pagination', async () => {
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);
      prismaMock.call.count.mockResolvedValue(50);

      const result = await callService.getCalls({ page: 2, limit: 10 });

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.pages).toBe(5);
      expect(prismaMock.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });
  });

  describe('getCallsByOrder', () => {
    const mockCalls = [
      {
        id: 1,
        customerId: 1,
        orderId: 100,
        salesRepId: 5,
        outcome: 'confirmed',
        duration: 120,
        notes: 'Test call',
        createdAt: new Date(),
        salesRep: { id: 5, firstName: 'John', lastName: 'Doe' }
      }
    ];

    it('should return calls for specific order', async () => {
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);

      const result = await callService.getCallsByOrder(100);

      expect(result).toEqual(mockCalls);
      expect(prismaMock.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: 100 }
        })
      );
    });
  });

  describe('getCallsByCustomer', () => {
    const mockCalls = [
      {
        id: 1,
        customerId: 1,
        orderId: 100,
        salesRepId: 5,
        outcome: 'confirmed',
        duration: 120,
        notes: 'Test call',
        createdAt: new Date(),
        salesRep: { id: 5, firstName: 'John', lastName: 'Doe' },
        order: { id: 100, status: 'confirmed' }
      }
    ];

    it('should return calls for specific customer', async () => {
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);

      const result = await callService.getCallsByCustomer(1);

      expect(result).toEqual(mockCalls);
      expect(prismaMock.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 1 }
        })
      );
    });
  });

  describe('getCallStats', () => {
    const mockSalesReps = [
      { id: 5, firstName: 'John', lastName: 'Doe' }
    ];

    const mockCalls = [
      {
        id: 1,
        salesRepId: 5,
        outcome: 'confirmed',
        duration: 120,
        createdAt: new Date('2024-12-28T10:00:00'),
        salesRep: { id: 5, firstName: 'John', lastName: 'Doe' }
      },
      {
        id: 2,
        salesRepId: 5,
        outcome: 'no_answer',
        duration: 30,
        createdAt: new Date('2024-12-27T14:00:00'),
        salesRep: { id: 5, firstName: 'John', lastName: 'Doe' }
      }
    ];

    it('should calculate stats for all reps', async () => {
      prismaMock.user.findMany.mockResolvedValue(mockSalesReps as any);
      prismaMock.call.count.mockResolvedValue(2);
      prismaMock.call.groupBy.mockResolvedValue([
        { outcome: 'confirmed', _count: 1 },
        { outcome: 'no_answer', _count: 1 }
      ] as any);
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);

      const result = await callService.getCallStats({});

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('repId');
      expect(result[0]).toHaveProperty('repName');
      expect(result[0]).toHaveProperty('totalCalls');
      expect(result[0]).toHaveProperty('todayCalls');
      expect(result[0]).toHaveProperty('weekCalls');
      expect(result[0]).toHaveProperty('monthCalls');
      expect(result[0]).toHaveProperty('avgCallsPerDay');
      expect(result[0]).toHaveProperty('avgDuration');
      expect(result[0]).toHaveProperty('outcomeBreakdown');
      expect(result[0]).toHaveProperty('timeline');
    });

    it('should filter stats by date range', async () => {
      const startDate = new Date('2024-12-01');
      const endDate = new Date('2024-12-31');
      prismaMock.user.findMany.mockResolvedValue(mockSalesReps as any);
      prismaMock.call.count.mockResolvedValue(2);
      prismaMock.call.groupBy.mockResolvedValue([
        { outcome: 'confirmed', _count: 1 },
        { outcome: 'no_answer', _count: 1 }
      ] as any);
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);

      await callService.getCallStats({ startDate, endDate });

      expect(prismaMock.user.findMany).toHaveBeenCalled();
    });

    it('should filter stats by specific rep', async () => {
      prismaMock.user.findMany.mockResolvedValue(mockSalesReps as any);
      prismaMock.call.count.mockResolvedValue(2);
      prismaMock.call.groupBy.mockResolvedValue([
        { outcome: 'confirmed', _count: 1 },
        { outcome: 'no_answer', _count: 1 }
      ] as any);
      prismaMock.call.findMany.mockResolvedValue(mockCalls as any);

      await callService.getCallStats({ salesRepId: 5 });

      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 5 })
        })
      );
    });

    it('should handle empty call list', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);

      const result = await callService.getCallStats({});

      expect(result).toEqual([]);
    });
  });
});
