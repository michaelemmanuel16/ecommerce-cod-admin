import * as Money from '../../utils/money';
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

// Mock workflow queue
jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: {
    add: jest.fn().mockResolvedValue({}),
  },
}));

// The state machine has its own tests (orderStateMachine.test.ts, integration/orderStateMachine.test.ts):
// here orderService is checked to hand the move to it with the right actor and options.
jest.mock('../../services/orderStateMachine', () => ({
  ...(jest.requireActual('../../services/orderStateMachine') as object),
  transitionOrder: jest.fn(),
}));

// Automock the KPI functions; revenueScope is a pure mapping the callers use as is.
jest.mock('../../services/kpi/revenue', () => ({
  ...jest.createMockFromModule<object>('../../services/kpi/revenue'),
  revenueScope: jest.requireActual<typeof import('../../services/kpi/revenue')>('../../services/kpi/revenue').revenueScope,
}));
import { revenueResult } from '../mocks/kpiResults';
import { deliveredRevenue } from '../../services/kpi/revenue';
// Available to sell is read from the levels; these tests run on a mocked client
jest.mock('../../services/stockService', () => ({ getAvailableMany: async (ids: number[]) => new Map(ids.map((id) => [id, 1000])), RESERVING: ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'] }));
import { prismaMock } from '../mocks/prisma.mock';
import orderService from '../../services/orderService';
import { transitionOrder } from '../../services/orderStateMachine';
import { AppError } from '../../middleware/errorHandler';
import { OrderStatus } from '@prisma/client';
// Mock appEvents
jest.mock('../../utils/appEvents', () => ({
  __esModule: true,
  default: {
    emit: jest.fn(),
  },
  emitOrderCreatedEvent: jest.fn(),
  emitOrderDeletedEvent: jest.fn(),
  AppEvent: {
    BULK_ORDERS_IMPORTED: 'BULK_ORDERS_IMPORTED',
    AGENT_COLLECTION_RECONCILED: 'AGENT_COLLECTION_RECONCILED',
    ORDER_CREATED: 'order.created',
  },
}));
import appEvents, { AppEvent } from '../../utils/appEvents';
import { useTestTenant } from '../mocks/tenant.mock';

describe('OrderService', () => {
  useTestTenant();
  let serviceInstance: typeof orderService; // Renamed to avoid conflict with imported instance

  beforeEach(() => {
    serviceInstance = orderService; // Assign the imported instance
  });

  // generateOrderNumber is a private method and is tested indirectly through createOrder

  describe('createOrder', () => {
    const mockCustomer = {
      id: 1,
      firstName: 'John',
      lastName: 'Doe',
      phoneNumber: '+1234567890',
      email: 'john@example.com',
      address: '123 Main St',
      city: 'New York',
      state: 'NY',
      zipCode: '10001',
      area: 'Manhattan',
      totalOrders: 5,
      totalSpent: 500,
      isActive: true,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      alternatePhone: null,
      landmark: null,
      notes: null
    };

    const mockProduct = {
      id: 1,
      name: 'Test Product',
      sku: 'TEST-001',
      price: 100,
      cogs: 50,
      stockQuantity: 50,
      category: 'Electronics',
      description: 'Test description',
      imageUrl: null,
      isActive: true,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const createOrderData = {
      customerId: 1,
      orderItems: [
        {
          productId: 1,
          quantity: 2,
          unitPrice: 100
        }
      ],
      subtotal: 200,
      shippingCost: 10,
      discount: 0,
      totalAmount: 210,
      deliveryAddress: '123 Main St',
      deliveryCity: 'New York',
      deliveryState: 'NY',
      deliveryZipCode: '10001',
      deliveryArea: 'Manhattan',
      createdById: 1
    };

    it('should create order with valid data', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(mockCustomer);
      (prismaMock.product.findMany as any).mockResolvedValue([mockProduct]);
      (prismaMock.order.count as any).mockResolvedValue(0);

      const mockOrder = {
        id: 1,
        orderNumber: '1001',
        customerId: 1,
        subtotal: 200,
        totalAmount: 210,
        status: 'pending_confirmation' as OrderStatus,
        customer: mockCustomer,
        orderItems: [
          {
            id: 1,
            orderId: 1,
            productId: 1,
            quantity: 2,
            unitPrice: 100,
            totalPrice: 200,
            product: mockProduct,
            createdAt: new Date()
          }
        ]
      };

      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          order: {
            create: jest.fn().mockResolvedValue(mockOrder) as any,
            count: jest.fn().mockResolvedValue(0) as any
          },
          product: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }) as any,
            update: jest.fn().mockResolvedValue(mockProduct) as any
          },
          customer: {
            update: jest.fn().mockResolvedValue(mockCustomer) as any
          }
        });
      });

      const order = await orderService.createOrder(createOrderData as any) as any;

      expect(order).toBeDefined();
      expect(order.orderNumber).toBeDefined();
      expect(order.customerId).toBe(1);
    });

    // MAN-82: a manual order for a repeat customer (matched by phone) should link a
    // newly-provided email so admin orders also grow the owned email list — mirroring
    // the public checkout path. Previously only alternatePhone was updated.
    const phoneOrderData = {
      ...createOrderData,
      customerId: undefined,
      customerPhone: '+1234567890',
    };

    function mockOrderCreationTx() {
      (prismaMock.product.findMany as any).mockResolvedValue([mockProduct]);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.$transaction as any).mockImplementation(async (callback: any) =>
        callback({
          order: {
            create: jest.fn().mockResolvedValue({ id: 1, orderNumber: '1001', customerId: 1, customer: mockCustomer, orderItems: [] }) as any,
            count: jest.fn().mockResolvedValue(0) as any,
          },
          product: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }) as any,
            update: jest.fn().mockResolvedValue(mockProduct) as any,
          },
          customer: { update: jest.fn().mockResolvedValue(mockCustomer) as any },
        }),
      );
    }

    it('updates a repeat customer email on a manual order when a new one is provided (MAN-82)', async () => {
      const existingCustomer = { ...mockCustomer, email: 'old@example.com', alternatePhone: null };
      (prismaMock.customer.findMany as any).mockResolvedValue([existingCustomer]);
      (prismaMock.customer.update as any).mockResolvedValue({ ...existingCustomer, email: 'new@example.com' });
      mockOrderCreationTx();

      await orderService.createOrder({ ...phoneOrderData, customerEmail: 'new@example.com' } as any);

      expect(prismaMock.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existingCustomer.id },
          data: expect.objectContaining({ email: 'new@example.com' }),
        }),
      );
    });

    it('does not update a repeat customer when the email is unchanged (MAN-82)', async () => {
      const existingCustomer = { ...mockCustomer, email: 'same@example.com', alternatePhone: null };
      (prismaMock.customer.findMany as any).mockResolvedValue([existingCustomer]);
      mockOrderCreationTx();

      await orderService.createOrder({ ...phoneOrderData, customerEmail: 'same@example.com' } as any);

      // Only the in-transaction stats update may run; the outer profile update must not.
      expect(prismaMock.customer.update).not.toHaveBeenCalled();
    });

    it('should throw error when customer not found', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(null);

      await expect(orderService.createOrder(createOrderData as any)).rejects.toThrow(
        new AppError('Customer not found', 404)
      );
    });

    it('should throw error when product not found', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(mockCustomer);
      (prismaMock.product.findMany as any).mockResolvedValue([]);

      await expect(orderService.createOrder(createOrderData as any)).rejects.toThrow(
        new AppError('Product ID 1 not found', 404)
      );
    });

    it('should throw error when product is out of stock (atomic check)', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(mockCustomer);
      (prismaMock.product.findMany as any).mockResolvedValue([mockProduct]);

      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          product: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }) as any,
            update: jest.fn().mockResolvedValue(mockProduct) as any
          },
          order: {
            create: jest.fn().mockRejectedValue(new Error('Should not be called')) as any,
            count: jest.fn().mockResolvedValue(0) as any
          },
          customer: {
            update: jest.fn().mockResolvedValue({}) as any
          }
        };

        // The service first checks stock with updateMany
        const result = await tx.product.updateMany({
          where: { id: 1, stockQuantity: { gte: 2 } },
          data: { stockQuantity: { decrement: 2 } }
        });

        if (result.count === 0) {
          throw new AppError('Insufficient stock for product Test Product', 400);
        }

        return callback(tx);
      });

      await expect(orderService.createOrder(createOrderData as any)).rejects.toThrow(
        /Insufficient stock for product Test Product/
      );
    });
  });

  describe('updateOrderStatus', () => {
    const mockOrder = {
      id: 1,
      orderNumber: '1001',
      status: 'pending_confirmation' as OrderStatus,
      customerId: 1,
      subtotal: 200,
      totalAmount: 210,
      orderItems: []
    };

    const mockedTransition = transitionOrder as unknown as jest.MockedFunction<(...args: any[]) => Promise<any>>;
    beforeEach(() => mockedTransition.mockReset());

    it('should hand the move to the state machine and return the updated order', async () => {
      const updatedOrder = { ...mockOrder, status: 'confirmed' as OrderStatus };
      mockedTransition.mockResolvedValue({ changed: true, from: 'pending_confirmation' });
      // the caller reads the order once after the commit
      (prismaMock.order.findFirst as any).mockResolvedValue(updatedOrder);

      const updated = await orderService.updateOrderStatus(1, {
        status: 'confirmed' as OrderStatus,
        notes: 'Order confirmed',
        changedBy: 1
      });

      expect(updated.status).toBe('confirmed');
      // no requester: the system actor, with the changedBy user id kept for the history row
      expect(mockedTransition).toHaveBeenCalledWith(1, 'confirmed', { kind: 'system', userId: 1 },
        expect.objectContaining({ note: 'Order confirmed' }));
    });

    it('should use the requester as a user actor', async () => {
      mockedTransition.mockResolvedValue({ changed: true, order: mockOrder, from: 'pending_confirmation', to: 'confirmed' });

      await orderService.updateOrderStatus(1, { status: 'confirmed' as OrderStatus }, { id: 7, role: 'manager' } as any);

      expect(mockedTransition).toHaveBeenCalledWith(1, 'confirmed', { kind: 'user', userId: 7, role: 'manager' },
        expect.any(Object));
    });

    it('should set paymentStatus collected when the status is delivered', async () => {
      mockedTransition.mockResolvedValue({ changed: true, order: { ...mockOrder, status: 'delivered' }, from: 'out_for_delivery', to: 'delivered' });

      await orderService.updateOrderStatus(1, { status: 'delivered' as OrderStatus, actor: { kind: 'integration' } });

      expect(mockedTransition).toHaveBeenCalledWith(1, 'delivered', { kind: 'integration' },
        expect.objectContaining({ paymentStatus: 'collected' }));
    });

    it('should throw error when order not found', async () => {
      mockedTransition.mockRejectedValue(new AppError('Order not found', 404));

      await expect(
        orderService.updateOrderStatus(999, {
          status: 'confirmed' as OrderStatus
        })
      ).rejects.toThrow(new AppError('Order not found', 404));
    });
  });

  describe('cancelOrder', () => {
    const mockOrder = {
      id: 1,
      orderNumber: '1001',
      status: 'confirmed' as OrderStatus,
      customerId: 1,
      totalAmount: 210,
      orderItems: [
        {
          id: 1,
          productId: 1,
          quantity: 2,
          unitPrice: 100,
          totalPrice: 200
        }
      ]
    };

    it('should cancel order through the state machine and update customer stats', async () => {
      const afterCommit = jest.fn();
      (transitionOrder as any).mockResolvedValue({ changed: true, order: {}, from: 'confirmed', to: 'cancelled', afterCommit });
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          product: {
            update: jest.fn().mockResolvedValue({}) as any
          },
          order: {
            update: jest.fn().mockResolvedValue({
              ...mockOrder,
              status: 'cancelled'
            }) as any
          },
          customer: {
            update: jest.fn().mockResolvedValue({}) as any
          }
        });
      });

      const result = await orderService.cancelOrder(1, 1, 'Customer request');

      expect(result.message).toBe('Order cancelled successfully');
      expect(transitionOrder).toHaveBeenCalledWith(1, 'cancelled', { kind: 'system', userId: 1 },
        expect.objectContaining({ note: 'Customer request' }));
      expect(afterCommit).toHaveBeenCalled();
    });

    it('should throw error when cancelling delivered order', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue({
        ...mockOrder,
        status: 'delivered' as OrderStatus
      } as any);

      await expect(
        orderService.cancelOrder(1)
      ).rejects.toThrow(
        new AppError('Cannot cancel order in current status', 400)
      );
    });

    it('should throw error when cancelling already cancelled order', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue({
        ...mockOrder,
        status: 'cancelled' as OrderStatus
      } as any);

      await expect(
        orderService.cancelOrder(1)
      ).rejects.toThrow(
        new AppError('Cannot cancel order in current status', 400)
      );
    });
  });

  // Bulk import tests - verifying error handling implementation
  describe('bulkImportOrders - Error Handling', () => {
    // Note: These tests verify the service handles errors gracefully
    // The actual error code detection (P2002, P2024) is implemented in orderService.ts lines 577-623

    it('should return proper error structure when import fails', async () => {
      // Mock transaction to reject
      (prismaMock.$transaction as any).mockRejectedValue(new Error('Test error'));

      const orderData = [{
        customerFirstName: 'Test',
        customerLastName: 'User',
        customerPhone: '0501111111',
        deliveryAddress: 'Test Address',
        deliveryState: 'Greater Accra',
        deliveryArea: 'Accra',
        totalAmount: 100,
        orderDate: new Date(),
      }];

      const result = await orderService.bulkImportOrders(orderData, 1, undefined, undefined, true);

      // Verify error structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('duplicates');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should handle generic Prisma errors (P* codes)', async () => {
      // Mock generic Prisma error
      const prismaError: any = new Error('Foreign key constraint failed');
      prismaError.code = 'P2003';

      (prismaMock.$transaction as any).mockRejectedValue(prismaError);

      const orderData = [{
        customerFirstName: 'Bob',
        customerLastName: 'Johnson',
        customerPhone: '0503456789',
        deliveryAddress: '789 Pine Rd',
        deliveryState: 'Greater Accra',
        deliveryArea: 'Accra',
        totalAmount: 200,
        orderDate: new Date('2024-01-03'),
      }];

      const result = await orderService.bulkImportOrders(orderData, 1, undefined, undefined, true);

      // Generic Prisma error should be tracked as failed
      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toHaveLength(1);
      // Error message varies but should exist
      expect(result.errors[0].error).toBeDefined();
      expect(typeof result.errors[0].error).toBe('string');
    });

    it('should handle non-Prisma errors', async () => {
      // Mock generic error (no code)
      const genericError = new Error('Network error');

      (prismaMock.$transaction as any).mockRejectedValue(genericError);

      const orderData = [{
        customerFirstName: 'Eve',
        customerLastName: 'Williams',
        customerPhone: '0504567890',
        deliveryAddress: '321 Elm St',
        deliveryState: 'Greater Accra',
        deliveryArea: 'Spintex',
        totalAmount: 250,
        orderDate: new Date('2024-01-04'),
      }];

      const result = await orderService.bulkImportOrders(orderData, 1, undefined, undefined, true);

      // Generic error should be tracked as failed
      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBeDefined();
    });
  });

  describe('bulkDeleteOrders', () => {
    const mockOrders = [
      {
        id: 1,
        customerId: 1,
        totalAmount: 100,
        status: 'pending_confirmation' as OrderStatus,
        orderItems: [{ productId: 1, quantity: 2 }]
      },
      {
        id: 2,
        customerId: 1,
        totalAmount: 200,
        status: 'confirmed' as OrderStatus,
        orderItems: [{ productId: 2, quantity: 1 }]
      }
    ];

    it('should bulk delete orders successfully', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue(mockOrders as any);

      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          customer: { update: jest.fn().mockResolvedValue({}) as any },
          orderHistory: { createMany: jest.fn().mockResolvedValue({ count: 2 }) as any },
          order: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) as any },
          agentCollection: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) as any },
          auditLog: { create: jest.fn().mockResolvedValue({}) as any },
        });
      });

      const result = await orderService.bulkDeleteOrders([1, 2], 1);

      expect(result.message).toContain('Successfully deleted 2 order(s)');
      expect(result.deleted).toBe(2);
      expect(result.skipped).toEqual([]);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it('should throw error if no order IDs provided', async () => {
      await expect(orderService.bulkDeleteOrders([])).rejects.toThrow(
        new AppError('No order IDs provided', 400)
      );
    });

    it('should skip ids that are not found and delete nothing', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([]);
      const result = await orderService.bulkDeleteOrders([999]);
      expect(result).toMatchObject({ deleted: 0, skipped: [{ id: 999, reason: 'Order not found' }] });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('should skip an order that cannot be deleted', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([
        { ...mockOrders[0], status: 'out_for_delivery' as OrderStatus }
      ] as any);

      const result = await orderService.bulkDeleteOrders([1]);
      expect(result.skipped).toEqual([{ id: 1, reason: 'Cancel or return the order first.' }]);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getOrderStats', () => {
    it('should calculate order statistics correctly', async () => {
      (prismaMock.order.count as any).mockResolvedValue(100);
      (prismaMock.order.groupBy as any).mockResolvedValue([
        { status: 'delivered' as OrderStatus, _count: 50 },
        { status: 'pending_confirmation' as OrderStatus, _count: 30 },
        { status: 'cancelled' as OrderStatus, _count: 20 }
      ] as any);
      (deliveredRevenue as jest.MockedFunction<typeof deliveredRevenue>).mockResolvedValue(revenueResult('5000.00', 50));
      (prismaMock.order.aggregate as any).mockResolvedValueOnce({ _avg: { totalAmount: 50 } } as any);

      const stats = await orderService.getOrderStats({});

      expect(stats.totalOrders).toBe(100);
      expect(Money.toApi(stats.totalRevenue)).toBe('5000.00');
      expect(Money.toApi(stats.avgOrderValue)).toBe('50.00');
      expect(stats.ordersByStatus.delivered).toBe(50);
      expect(stats.ordersByStatus.pending_confirmation).toBe(30);
      expect(stats.ordersByStatus.cancelled).toBe(20);
    });

    it('takes revenue from the KPI layer, scoped to the requester (delivery-date basis, [from, to))', async () => {
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.groupBy as any).mockResolvedValue([]);
      (deliveredRevenue as jest.MockedFunction<typeof deliveredRevenue>).mockResolvedValue(revenueResult('0.00', 0));
      (prismaMock.order.aggregate as any).mockResolvedValueOnce({ _avg: { totalAmount: null } } as any);

      await orderService.getOrderStats(
        { startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31T23:59:59.999Z') },
        { id: 4, role: 'sales_rep' } as any,
      );

      const [, from, to, scope] = (deliveredRevenue as jest.MockedFunction<typeof deliveredRevenue>).mock.calls[0];
      expect(from).toEqual(new Date('2024-01-01'));
      expect(to).toEqual(new Date('2024-02-01T00:00:00.000Z'));
      expect(scope).toEqual({ customerRepId: 4, deliveryAgentId: undefined });
    });
  });
});
