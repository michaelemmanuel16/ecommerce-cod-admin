import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { DeliveryService } from '../../services/deliveryService';
import { AppError } from '../../middleware/errorHandler';
import { OrderStatus, DeliveryProofType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

describe('DeliveryService', () => {
  let deliveryService: DeliveryService;

  beforeEach(() => {
    deliveryService = new DeliveryService();
  });

  describe('createDelivery', () => {
    const mockOrder = {
      id: 'order-1',
      orderNumber: '1001',
      status: 'ready_for_pickup' as OrderStatus,
      customerId: 'customer-1'
    };

    const mockAgent = {
      id: 'agent-1',
      firstName: 'Agent',
      lastName: 'One',
      role: 'delivery_agent' as any,
      isActive: true,
      isAvailable: true
    };

    const createDeliveryData = {
      orderId: 'order-1',
      agentId: 'agent-1',
      scheduledTime: new Date(),
      notes: 'Test delivery'
    };

    it('should create delivery assignment successfully', async () => {
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.delivery.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(mockAgent as any);

      const mockDelivery = {
        id: 'delivery-1',
        orderId: 'order-1',
        agentId: 'agent-1',
        order: mockOrder,
        agent: mockAgent
      };

      prismaMock.delivery.create.mockResolvedValue(mockDelivery as any);
      prismaMock.order.update.mockResolvedValue(mockOrder as any);

      const delivery = await deliveryService.createDelivery(createDeliveryData);

      expect(delivery).toBeDefined();
      expect(delivery.orderId).toBe('order-1');
      expect(delivery.agentId).toBe('agent-1');
      expect(prismaMock.order.update).toHaveBeenCalled();
    });

    it('should throw error when order not found', async () => {
      prismaMock.order.findUnique.mockResolvedValue(null);

      await expect(
        deliveryService.createDelivery(createDeliveryData)
      ).rejects.toThrow(new AppError('Order not found', 404));
    });

    it('should throw error when order is not ready', async () => {
      prismaMock.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'pending_confirmation' as OrderStatus
      } as any);

      await expect(
        deliveryService.createDelivery(createDeliveryData)
      ).rejects.toThrow(
        new AppError(
          'Order must be confirmed, preparing, or ready for pickup before delivery assignment',
          400
        )
      );
    });

    it('should throw error when delivery already exists', async () => {
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.delivery.findUnique.mockResolvedValue({
        id: 'existing-delivery'
      } as any);

      await expect(
        deliveryService.createDelivery(createDeliveryData)
      ).rejects.toThrow(new AppError('Delivery already exists for this order', 400));
    });

    it('should throw error when agent is not available', async () => {
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.delivery.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue({
        ...mockAgent,
        isAvailable: false
      } as any);

      await expect(
        deliveryService.createDelivery(createDeliveryData)
      ).rejects.toThrow(new AppError('Delivery agent is not available', 400));
    });

    it('should throw error when user is not a delivery agent', async () => {
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.delivery.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue({
        ...mockAgent,
        role: 'sales_rep' as any
      } as any);

      await expect(
        deliveryService.createDelivery(createDeliveryData)
      ).rejects.toThrow(new AppError('Invalid delivery agent', 400));
    });
  });

  describe('completeDelivery', () => {
    const mockDelivery = {
      id: 'delivery-1',
      orderId: 'order-1',
      agentId: 'agent-1',
      actualDeliveryTime: null,
      order: {
        id: 'order-1',
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
      prismaMock.delivery.findUnique.mockResolvedValue(mockDelivery as any);
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
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
              customerRepId: 1
            }),
            update: jest.fn().mockResolvedValue({})
          },
          transaction: {
            create: jest.fn().mockResolvedValue({})
          },
          journalEntry: {
            create: jest.fn().mockResolvedValue({ id: 1, entryNumber: 'JE-001' })
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
        'delivery-1',
        completeData,
        'user-1'
      );

      expect(result.message).toBe('Delivery completed successfully');
    });

    it('should throw error when delivery not found', async () => {
      prismaMock.delivery.findUnique.mockResolvedValue(null);

      await expect(
        deliveryService.completeDelivery('delivery-1', completeData)
      ).rejects.toThrow(new AppError('Delivery not found', 404));
    });

    it('should throw error when delivery already completed', async () => {
      prismaMock.delivery.findUnique.mockResolvedValue({
        ...mockDelivery,
        actualDeliveryTime: new Date()
      } as any);

      await expect(
        deliveryService.completeDelivery('delivery-1', completeData)
      ).rejects.toThrow(new AppError('Delivery already completed', 400));
    });

    it('should create COD transaction with correct amount', async () => {
      prismaMock.delivery.findUnique.mockResolvedValue(mockDelivery as any);

      let createdTransaction: any;
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
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
              customerRepId: 1
            }),
            update: jest.fn().mockResolvedValue({})
          },
          transaction: {
            create: jest.fn().mockImplementation((data) => {
              createdTransaction = data.data;
              return Promise.resolve({});
            })
          },
          journalEntry: {
            create: jest.fn().mockResolvedValue({ id: 1, entryNumber: 'JE-001' })
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

      await deliveryService.completeDelivery('delivery-1', completeData, 'user-1');

      expect(createdTransaction.type).toBe('cod_collection');
      expect(createdTransaction.amount).toBe(210);
      expect(createdTransaction.status).toBe('collected');
    });
  });

  describe('autoAssignAgent', () => {
    const mockOrder = {
      id: 'order-1',
      orderNumber: '1001',
      deliveryArea: 'Manhattan',
      status: 'ready_for_pickup' as OrderStatus
    };

    const mockAgents = [
      {
        id: 'agent-1',
        firstName: 'Agent',
        lastName: 'One',
        role: 'delivery_agent' as any,
        isActive: true,
        isAvailable: true,
        assignedOrdersAsAgent: []
      },
      {
        id: 'agent-2',
        firstName: 'Agent',
        lastName: 'Two',
        role: 'delivery_agent' as any,
        isActive: true,
        isAvailable: true,
        assignedOrdersAsAgent: [{ id: 'order-x' }, { id: 'order-y' }]
      }
    ];

    it('should auto-assign agent with lowest workload', async () => {
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.user.findMany.mockResolvedValue(mockAgents as any);
      prismaMock.user.findUnique.mockResolvedValue(mockAgents[0] as any);
      prismaMock.delivery.findUnique.mockResolvedValue(null);
      prismaMock.delivery.create.mockResolvedValue({
        id: 'delivery-1',
        orderId: 'order-1',
        agentId: 'agent-1'
      } as any);
      prismaMock.order.update.mockResolvedValue(mockOrder as any);

      const delivery = await deliveryService.autoAssignAgent('order-1');

      expect(delivery.agentId).toBe('agent-1'); // Agent with 0 orders vs 2 orders
    });

    it('should throw error when no available agents found', async () => {
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.user.findMany.mockResolvedValue([]);

      await expect(
        deliveryService.autoAssignAgent('order-1')
      ).rejects.toThrow(new AppError('No available delivery agents found', 404));
    });
  });

  describe('getAgentRoute', () => {
    it('should return deliveries for specified date range', async () => {
      const today = new Date();
      const mockDeliveries = [
        {
          id: 'delivery-1',
          orderId: 'order-1',
          scheduledTime: today,
          order: {
            orderNumber: '1001',
            customer: {
              firstName: 'John',
              lastName: 'Doe',
              phoneNumber: '+1234567890'
            },
            deliveryAddress: '123 Main St',
            deliveryArea: 'Manhattan',
            deliveryCity: 'New York',
            status: 'out_for_delivery',
            codAmount: 210
          },
          notes: 'Test delivery',
          deliveryAttempts: 0
        }
      ];

      prismaMock.delivery.findMany.mockResolvedValue(mockDeliveries as any);

      const route = await deliveryService.getAgentRoute('agent-1', today);

      expect(route).toHaveLength(1);
      expect(route[0].orderId).toBe('order-1');
      expect(route[0].customer.firstName).toBe('John');
    });

    it('should return empty array when no deliveries scheduled', async () => {
      prismaMock.delivery.findMany.mockResolvedValue([]);

      const route = await deliveryService.getAgentRoute('agent-1', new Date());

      expect(route).toHaveLength(0);
    });
  });

  describe('getAgentStats', () => {
    it('should calculate agent statistics correctly', async () => {
      const mockDeliveries = [
        {
          scheduledTime: new Date('2024-01-01T10:00:00'),
          actualDeliveryTime: new Date('2024-01-01T10:30:00')
        },
        {
          scheduledTime: new Date('2024-01-01T11:00:00'),
          actualDeliveryTime: new Date('2024-01-01T11:45:00')
        }
      ];

      prismaMock.delivery.count
        .mockResolvedValueOnce(10) // totalDeliveries
        .mockResolvedValueOnce(8) // completedDeliveries
        .mockResolvedValueOnce(2); // failedDeliveries

      prismaMock.delivery.findMany.mockResolvedValue(mockDeliveries as any);

      const stats = await deliveryService.getAgentStats('agent-1');

      expect(stats.totalDeliveries).toBe(10);
      expect(stats.completedDeliveries).toBe(8);
      expect(stats.failedDeliveries).toBe(2);
      expect(stats.pendingDeliveries).toBe(2);
      expect(stats.successRate).toBe(80);
      expect(stats.avgDeliveryTime).toBeGreaterThan(0);
    });
  });

  describe('markDeliveryFailed', () => {
    const mockDelivery = {
      id: 'delivery-1',
      orderId: 'order-1',
      deliveryAttempts: 1,
      order: {
        orderNumber: 'ORD-123-00001'
      }
    };

    it('should mark delivery as failed and increment attempts', async () => {
      prismaMock.delivery.findUnique.mockResolvedValue(mockDelivery as any);
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
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
        'delivery-1',
        'Customer not available',
        'user-1',
        true
      );

      expect(result.message).toBe('Delivery marked as failed');
    });

    it('should update order status to failed_delivery when not rescheduling', async () => {
      prismaMock.delivery.findUnique.mockResolvedValue(mockDelivery as any);

      let updatedOrderStatus: string | undefined;
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback({
          delivery: {
            update: jest.fn().mockResolvedValue({})
          },
          order: {
            update: jest.fn().mockImplementation((args) => {
              updatedOrderStatus = args.data.status;
              return Promise.resolve({});
            })
          },
          journalEntry: {
            create: jest.fn().mockResolvedValue({ id: 1, entryNumber: 'JE-001' })
          },
          accountTransaction: {
            createMany: jest.fn().mockResolvedValue({})
          },
          $queryRaw: jest.fn().mockResolvedValue([])
        });
      });

      await deliveryService.markDeliveryFailed(
        'delivery-1',
        'Customer refused',
        'user-1',
        false
      );

      expect(updatedOrderStatus).toBe('failed_delivery');
    });

    it('should update order status to ready_for_pickup when rescheduling', async () => {
      prismaMock.delivery.findUnique.mockResolvedValue(mockDelivery as any);

      let updatedOrderStatus: string | undefined;
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback({
          delivery: {
            update: jest.fn().mockResolvedValue({})
          },
          order: {
            update: jest.fn().mockImplementation((args) => {
              updatedOrderStatus = args.data.status;
              return Promise.resolve({});
            })
          },
          $queryRaw: jest.fn().mockResolvedValue([])
        });
      });

      await deliveryService.markDeliveryFailed(
        'delivery-1',
        'Customer not available',
        'user-1',
        true
      );

      expect(updatedOrderStatus).toBe('ready_for_pickup');
    });
  });
});
