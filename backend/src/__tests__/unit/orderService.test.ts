import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent it from starting
jest.mock('../../server', () => ({
  io: {
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
  },
}));

// Mock workflow queue
jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: {
    add: jest.fn().mockResolvedValue({}),
  },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { OrderService } from '../../services/orderService';
import { AppError } from '../../middleware/errorHandler';
import { OrderStatus } from '@prisma/client';

describe('OrderService', () => {
  let orderService: OrderService;

  beforeEach(() => {
    orderService = new OrderService();
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
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer);
      prismaMock.product.findUnique.mockResolvedValue(mockProduct);
      prismaMock.order.count.mockResolvedValue(0);

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
            create: jest.fn().mockResolvedValue(mockOrder)
          },
          product: {
            update: jest.fn().mockResolvedValue(mockProduct)
          },
          customer: {
            update: jest.fn().mockResolvedValue(mockCustomer)
          }
        });
      });

      const order = await orderService.createOrder(createOrderData as any);

      expect(order).toBeDefined();
      expect(order.orderNumber).toBeDefined();
      expect(order.customerId).toBe(1);
    });

    it('should throw error when customer not found', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      await expect(orderService.createOrder(createOrderData as any)).rejects.toThrow(
        new AppError('Customer not found', 404)
      );
    });

    it('should throw error when product not found', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer);
      prismaMock.product.findUnique.mockResolvedValue(null);

      await expect(orderService.createOrder(createOrderData as any)).rejects.toThrow(
        new AppError('Product 1 not found', 404)
      );
    });

    it('should throw error when product is out of stock', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer);
      prismaMock.product.findUnique.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 1
      });

      await expect(orderService.createOrder(createOrderData as any)).rejects.toThrow(
        new AppError(
          'Insufficient stock for product Test Product. Available: 1',
          400
        )
      );
    });
  });

  describe('updateOrderStatus', () => {
    const mockOrder = {
      id: 1,
      orderNumber: '1001',
      status: 'pending_confirmation' as OrderStatus,
      customerId: 'customer-1',
      subtotal: 200,
      totalAmount: 210
    };

    it('should update order status with valid transition', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.order.update as any).mockResolvedValue({
        ...mockOrder,
        status: 'confirmed' as OrderStatus
      } as any);

      const updated = await orderService.updateOrderStatus('1', {
        status: 'confirmed' as OrderStatus,
        notes: 'Order confirmed',
        changedBy: 1
      });

      expect(updated.status).toBe('confirmed');
      expect(prismaMock.order.update).toHaveBeenCalled();
    });

    it('should allow any status transition for admin flexibility', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.order.update as any).mockResolvedValue({
        ...mockOrder,
        status: 'delivered' as OrderStatus
      } as any);

      // Status validation is disabled to allow admin flexibility
      const updated = await orderService.updateOrderStatus('1', {
        status: 'delivered' as OrderStatus
      });

      expect(updated.status).toBe('delivered');
      expect(prismaMock.order.update).toHaveBeenCalled();
    });

    it('should throw error when order not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);

      await expect(
        orderService.updateOrderStatus('999', {
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
      customerId: 'customer-1',
      totalAmount: 210,
      orderItems: [
        {
          id: 'item-1',
          productId: 'product-1',
          quantity: 2,
          unitPrice: 100,
          totalPrice: 200
        }
      ]
    };

    it('should cancel order and restock products', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          product: {
            update: jest.fn().mockResolvedValue({})
          },
          order: {
            update: jest.fn().mockResolvedValue({
              ...mockOrder,
              status: 'cancelled'
            })
          },
          customer: {
            update: jest.fn().mockResolvedValue({})
          }
        });
      });

      const result = await orderService.cancelOrder('1', 1, 'Customer request');

      expect(result.message).toBe('Order cancelled successfully');
    });

    it('should throw error when cancelling delivered order', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue({
        ...mockOrder,
        status: 'delivered' as OrderStatus
      } as any);

      await expect(
        orderService.cancelOrder('1')
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
        orderService.cancelOrder('1')
      ).rejects.toThrow(
        new AppError('Cannot cancel order in current status', 400)
      );
    });
  });

  describe('bulkImportOrders', () => {
    const bulkOrderData = [
      {
        customerPhone: '+1234567890',
        customerFirstName: 'John',
        customerLastName: 'Doe',
        subtotal: 100,
        totalAmount: 110,
        deliveryAddress: '123 Main St',
        deliveryCity: 'New York',
        deliveryState: 'NY',
        deliveryZipCode: '10001',
        deliveryArea: 'Manhattan'
      }
    ];

    it('should bulk import orders successfully', async () => {
      const mockCustomer = {
        id: 'customer-1',
        phoneNumber: '+1234567890',
        firstName: 'John',
        lastName: 'Doe'
      };

      (prismaMock.customer.findUnique as any).mockResolvedValue(mockCustomer as any);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.create as any).mockResolvedValue({
        id: 1,
        orderNumber: 'ORD-123-00001'
      } as any);

      const results = await orderService.bulkImportOrders(bulkOrderData, 1);

      expect(results.success).toBe(1);
      expect(results.failed).toBe(0);
      expect(results.errors).toHaveLength(0);
    });

    it('should create new customer if not exists', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(null);
      (prismaMock.customer.create as any).mockResolvedValue({
        id: 10,
        phoneNumber: '+1234567890'
      } as any);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.create as any).mockResolvedValue({
        id: 1,
        orderNumber: 'ORD-123-00001'
      } as any);

      const results = await orderService.bulkImportOrders(bulkOrderData, 1);

      expect(results.success).toBe(1);
      expect(prismaMock.customer.create).toHaveBeenCalled();
    });

    it('should handle errors and continue processing', async () => {
      (prismaMock.customer.findUnique as any).mockResolvedValue(null);
      (prismaMock.customer.create as any).mockRejectedValue(new Error('Database error'));

      const results = await orderService.bulkImportOrders(bulkOrderData, 1);

      expect(results.success).toBe(0);
      expect(results.failed).toBe(1);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0].error).toBe('Database error');
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
      (prismaMock.order.aggregate as any)
        .mockResolvedValueOnce({ _sum: { totalAmount: 5000 } } as any)
        .mockResolvedValueOnce({ _avg: { totalAmount: 50 } } as any);

      const stats = await orderService.getOrderStats({});

      expect(stats.totalOrders).toBe(100);
      expect(stats.totalRevenue).toBe(5000);
      expect(stats.avgOrderValue).toBe(50);
      expect(stats.ordersByStatus.delivered).toBe(50);
      expect(stats.ordersByStatus.pending_confirmation).toBe(30);
      expect(stats.ordersByStatus.cancelled).toBe(20);
    });
  });
});
