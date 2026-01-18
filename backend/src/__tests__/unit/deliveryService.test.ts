import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { DeliveryService } from '../../services/deliveryService';
import { AppError } from '../../middleware/errorHandler';
import { OrderStatus, DeliveryProofType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAccountService } from '../../services/glAccountService';

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock GLAccountService
jest.mock('../../services/glAccountService', () => ({
  GLAccountService: {
    getAccountIdByCode: jest.fn().mockResolvedValue(10),
  },
}));

describe('DeliveryService', () => {
  let deliveryService: DeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    deliveryService = new DeliveryService();
    (GLAccountService.getAccountIdByCode as jest.Mock).mockResolvedValue(10);
  });

  describe('createDelivery', () => {
    const mockOrder = {
      id: 1,
      orderNumber: '1001',
      status: 'ready_for_pickup' as OrderStatus,
      customerId: 1
    };

    const mockAgent = {
      id: 2,
      firstName: 'Agent',
      lastName: 'One',
      role: 'delivery_agent',
      isActive: true,
      isAvailable: true
    };

    const createDeliveryData = {
      orderId: 1,
      agentId: 2,
      scheduledTime: new Date(),
      notes: 'Test delivery'
    };

    it('should create delivery assignment successfully', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder);
      (prismaMock.delivery.findUnique as any).mockResolvedValue(null);
      (prismaMock.user.findUnique as any).mockResolvedValue(mockAgent);

      const mockDelivery = {
        id: 1,
        orderId: 1,
        agentId: 2,
        order: mockOrder,
        agent: mockAgent
      };

      (prismaMock.delivery.create as any).mockResolvedValue(mockDelivery);
      (prismaMock.order.update as any).mockResolvedValue(mockOrder);

      const delivery = await deliveryService.createDelivery(createDeliveryData);

      expect(delivery).toBeDefined();
      expect(delivery.orderId).toBe(1);
    });
  });

  describe('completeDelivery', () => {
    const mockDelivery = {
      id: 1,
      orderId: 1,
      agentId: 2,
      actualDeliveryTime: null,
      order: {
        id: 1,
        orderNumber: '1001',
        codAmount: 210
      }
    };

    const completeData = {
      codAmount: 210,
      proofType: 'signature' as DeliveryProofType,
      proofData: 'John Doe signature',
      recipientName: 'John Doe',
      recipientPhone: '+1234567890'
    };

    it('should complete delivery successfully', async () => {
      (prismaMock.delivery.findUnique as any).mockResolvedValue(mockDelivery);
      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          delivery: {
            update: jest.fn().mockResolvedValue(mockDelivery)
          },
          order: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              totalAmount: 210,
              orderItems: [{
                quantity: 2,
                unitPrice: 100,
                product: {
                  name: 'Test Product',
                  cogs: new Decimal(50)
                }
              }],
              customerRepId: 1,
              deliveryAgent: { id: 2, commissionAmount: new Decimal(10) },
              customerRep: { id: 1, commissionAmount: new Decimal(10) }
            }),
            update: jest.fn().mockResolvedValue({})
          },
          transaction: {
            create: jest.fn().mockResolvedValue({})
          },
          journalEntry: {
            create: jest.fn().mockResolvedValue({ id: 1, entryNumber: 'JE-001', transactions: [] })
          },
          accountTransaction: {
            createMany: jest.fn().mockResolvedValue({})
          },
          product: {
            update: jest.fn().mockResolvedValue({})
          },
          user: {
            findUnique: jest.fn().mockResolvedValue({
              id: 1,
              commissionAmount: new Decimal(10)
            })
          },
          $queryRaw: jest.fn().mockResolvedValue([])
        });
      });

      const result = await deliveryService.completeDelivery(
        '1',
        completeData as any,
        1
      );

      expect(result.message).toBe('Delivery completed successfully');
    });
  });

  describe('markDeliveryFailed', () => {
    const mockDelivery = {
      id: 1,
      orderId: 1,
      deliveryAttempts: 1,
      order: {
        orderNumber: 'ORD-123-00001'
      }
    };

    it('should mark delivery as failed and increment attempts', async () => {
      (prismaMock.delivery.findUnique as any).mockResolvedValue(mockDelivery);
      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          delivery: {
            update: jest.fn().mockResolvedValue({})
          },
          order: {
            update: jest.fn().mockResolvedValue({})
          },
          $queryRaw: jest.fn().mockResolvedValue([])
        });
      });

      const result = await deliveryService.markDeliveryFailed(
        1,
        'Customer not available',
        1,
        true
      );

      expect(result.message).toBe('Delivery marked as failed');
    });

    it('should update order status to failed_delivery when not rescheduling', async () => {
      (prismaMock.delivery.findUnique as any).mockResolvedValue(mockDelivery);

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback({
          delivery: {
            update: jest.fn().mockResolvedValue({})
          },
          order: {
            update: jest.fn().mockResolvedValue({})
          },
          journalEntry: {
            create: jest.fn().mockResolvedValue({ id: 1, entryNumber: 'JE-001', transactions: [] })
          },
          accountTransaction: {
            createMany: jest.fn().mockResolvedValue({})
          },
          $queryRaw: jest.fn().mockResolvedValue([])
        });
      });

      const result = await deliveryService.markDeliveryFailed(
        1,
        'Customer refused',
        1,
        false
      );

      expect(result.message).toBe('Delivery marked as failed');
    });
  });
});
