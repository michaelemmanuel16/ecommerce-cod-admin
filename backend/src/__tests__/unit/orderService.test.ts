import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { OrderService } from '../../services/orderService';
import { AppError } from '../../middleware/errorHandler';
import { OrderStatus } from '@prisma/client';

describe('OrderService', () => {
  let orderService: OrderService;

  beforeEach(() => {
    orderService = new OrderService();
  });

  describe('generateOrderNumber', () => {
    it('should generate unique order number with correct format', async () => {
      prismaMock.order.count.mockResolvedValue(5);

      const orderNumber = await orderService.generateOrderNumber();

      expect(orderNumber).toMatch(/^\d{4}$/);
      expect(orderNumber).toBe('1006'); // 1000 + count + 1
    });

    it('should generate 4-digit order number', async () => {
      prismaMock.order.count.mockResolvedValue(99);

      const orderNumber = await orderService.generateOrderNumber();

      expect(orderNumber).toBe('1100'); // 1000 + 99 + 1
    });
  });

  describe('createOrder', () => {
    const mockCustomer = {
      id: 'customer-1',
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
      id: 'product-1',
      name: 'Test Product',
      sku: 'TEST-001',
      price: 100,
      costPrice: 50,
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
      customerId: 'customer-1',
      orderItems: [
        {
          productId: 'product-1',
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
      createdById: 'user-1'
    };

    it('should create order with valid data', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer);
      prismaMock.product.findUnique.mockResolvedValue(mockProduct);
      prismaMock.order.count.mockResolvedValue(0);

      const mockOrder = {
        id: 'order-1',
        orderNumber: '1001',
        customerId: 'customer-1',
        subtotal: 200,
        totalAmount: 210,
        status: 'pending_confirmation' as OrderStatus,
        customer: mockCustomer,
        orderItems: [
          {
            id: 'item-1',
            orderId: 'order-1',
            productId: 'product-1',
            quantity: 2,
            unitPrice: 100,
            totalPrice: 200,
            product: mockProduct,
            createdAt: new Date()
          }
        ]
      };

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
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

      const order = await orderService.createOrder(createOrderData);

      expect(order).toBeDefined();
      expect(order.orderNumber).toBeDefined();
      expect(order.customerId).toBe('customer-1');
    });

    it('should throw error when customer not found', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);

      await expect(orderService.createOrder(createOrderData)).rejects.toThrow(
        new AppError('Customer not found', 404)
      );
    });

    it('should throw error when product not found', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer);
      prismaMock.product.findUnique.mockResolvedValue(null);

      await expect(orderService.createOrder(createOrderData)).rejects.toThrow(
        new AppError('Product product-1 not found', 404)
      );
    });

    it('should throw error when product is out of stock', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer);
      prismaMock.product.findUnique.mockResolvedValue({
        ...mockProduct,
        stockQuantity: 1
      });

      await expect(orderService.createOrder(createOrderData)).rejects.toThrow(
        new AppError(
          'Insufficient stock for product Test Product. Available: 1',
          400
        )
      );
    });
  });

  describe('updateOrderStatus', () => {
    const mockOrder = {
      id: 'order-1',
      orderNumber: '1001',
      status: 'pending_confirmation' as OrderStatus,
      customerId: 'customer-1',
      subtotal: 200,
      totalAmount: 210
    };

    it('should update order status with valid transition', async () => {
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.order.update.mockResolvedValue({
        ...mockOrder,
        status: 'confirmed' as OrderStatus
      } as any);

      const updated = await orderService.updateOrderStatus('order-1', {
        status: 'confirmed' as OrderStatus,
        notes: 'Order confirmed',
        changedBy: 'user-1'
      });

      expect(updated.status).toBe('confirmed');
      expect(prismaMock.order.update).toHaveBeenCalled();
    });

    it('should throw error on invalid status transition', async () => {
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);

      await expect(
        orderService.updateOrderStatus('order-1', {
          status: 'delivered' as OrderStatus
        })
      ).rejects.toThrow(
        new AppError(
          'Invalid status transition from pending_confirmation to delivered',
          400
        )
      );
    });

    it('should throw error when order not found', async () => {
      prismaMock.order.findUnique.mockResolvedValue(null);

      await expect(
        orderService.updateOrderStatus('order-1', {
          status: 'confirmed' as OrderStatus
        })
      ).rejects.toThrow(new AppError('Order not found', 404));
    });
  });

  describe('cancelOrder', () => {
    const mockOrder = {
      id: 'order-1',
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
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
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

      const result = await orderService.cancelOrder('order-1', 'user-1', 'Customer request');

      expect(result.message).toBe('Order cancelled successfully');
    });

    it('should throw error when cancelling delivered order', async () => {
      prismaMock.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'delivered' as OrderStatus
      } as any);

      await expect(
        orderService.cancelOrder('order-1')
      ).rejects.toThrow(
        new AppError('Cannot cancel order in current status', 400)
      );
    });

    it('should throw error when cancelling already cancelled order', async () => {
      prismaMock.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'cancelled' as OrderStatus
      } as any);

      await expect(
        orderService.cancelOrder('order-1')
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

      prismaMock.customer.findUnique.mockResolvedValue(mockCustomer as any);
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-123-00001'
      } as any);

      const results = await orderService.bulkImportOrders(bulkOrderData, 'user-1');

      expect(results.success).toBe(1);
      expect(results.failed).toBe(0);
      expect(results.errors).toHaveLength(0);
    });

    it('should create new customer if not exists', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue({
        id: 'customer-new',
        phoneNumber: '+1234567890'
      } as any);
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-123-00001'
      } as any);

      const results = await orderService.bulkImportOrders(bulkOrderData, 'user-1');

      expect(results.success).toBe(1);
      expect(prismaMock.customer.create).toHaveBeenCalled();
    });

    it('should handle errors and continue processing', async () => {
      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockRejectedValue(new Error('Database error'));

      const results = await orderService.bulkImportOrders(bulkOrderData, 'user-1');

      expect(results.success).toBe(0);
      expect(results.failed).toBe(1);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0].error).toBe('Database error');
    });
  });

  describe('getOrderStats', () => {
    it('should calculate order statistics correctly', async () => {
      prismaMock.order.count.mockResolvedValue(100);
      prismaMock.order.groupBy.mockResolvedValue([
        { status: 'delivered' as OrderStatus, _count: 50 },
        { status: 'pending_confirmation' as OrderStatus, _count: 30 },
        { status: 'cancelled' as OrderStatus, _count: 20 }
      ] as any);
      prismaMock.order.aggregate
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
