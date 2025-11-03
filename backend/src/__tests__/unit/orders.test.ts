import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  getAllOrders,
  createOrder,
  getOrder,
  updateOrderStatus,
} from '../../controllers/orderController';
import { prismaMock } from '../mocks/prisma.mock';

describe('Orders Controller', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockReq = {
      query: {},
      params: {},
      body: {},
      user: { id: 'user-123' },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('getAllOrders', () => {
    it('should return paginated orders', async () => {
      const mockOrders = [
        {
          id: 'order-1',
          orderNumber: '1001',
          status: 'pending_confirmation',
          totalAmount: 100,
        },
        {
          id: 'order-2',
          orderNumber: '1002',
          status: 'confirmed',
          totalAmount: 200,
        },
      ];

      mockReq.query = { page: '1', limit: '20' };

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);
      prismaMock.order.count.mockResolvedValue(2);

      await getAllOrders(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        orders: mockOrders,
        pagination: {
          page: 1,
          limit: 20,
          total: 2,
          pages: 1,
        },
      });
    });

    it('should filter orders by status', async () => {
      mockReq.query = { status: 'confirmed' };

      prismaMock.order.findMany.mockResolvedValue([]);
      prismaMock.order.count.mockResolvedValue(0);

      await getAllOrders(mockReq, mockRes);

      expect(prismaMock.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'confirmed',
          }),
        })
      );
    });

    it('should search orders by order number', async () => {
      mockReq.query = { search: '1001' };

      prismaMock.order.findMany.mockResolvedValue([]);
      prismaMock.order.count.mockResolvedValue(0);

      await getAllOrders(mockReq, mockRes);

      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });
  });

  describe('createOrder', () => {
    it('should create a new order', async () => {
      const orderData = {
        customerId: 'customer-123',
        orderItems: [
          { productId: 'product-1', quantity: 2, unitPrice: 50 },
        ],
        subtotal: 100,
        totalAmount: 100,
        deliveryAddress: '123 Main St',
        deliveryCity: 'New York',
        deliveryState: 'NY',
        deliveryZipCode: '10001',
        deliveryArea: 'Manhattan',
      };

      mockReq.body = orderData;

      const mockOrder = {
        id: 'order-123',
        orderNumber: '1001',
        ...orderData,
      };

      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue(mockOrder as any);
      prismaMock.customer.update.mockResolvedValue({} as any);

      await createOrder(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ order: mockOrder });
      expect(prismaMock.customer.update).toHaveBeenCalled();
    });
  });

  describe('getOrder', () => {
    it('should return order by id', async () => {
      const mockOrder = {
        id: 'order-123',
        orderNumber: 'ORD-001',
        customer: { id: 'customer-1', firstName: 'John' },
      };

      mockReq.params = { id: 'order-123' };
      prismaMock.order.findUnique.mockResolvedValue(mockOrder as any);

      await getOrder(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({ order: mockOrder });
    });

    it('should throw error if order not found', async () => {
      mockReq.params = { id: 'invalid-id' };
      prismaMock.order.findUnique.mockResolvedValue(null);

      await expect(getOrder(mockReq, mockRes)).rejects.toThrow('Order not found');
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status', async () => {
      const mockOrder = {
        id: 'order-123',
        orderNumber: 'ORD-001',
        status: 'confirmed',
      };

      mockReq.params = { id: 'order-123' };
      mockReq.body = { status: 'confirmed', notes: 'Order confirmed' };

      prismaMock.order.update.mockResolvedValue(mockOrder as any);

      await updateOrderStatus(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({ order: mockOrder });
      expect(prismaMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-123' },
          data: expect.objectContaining({
            status: 'confirmed',
          }),
        })
      );
    });
  });
});
