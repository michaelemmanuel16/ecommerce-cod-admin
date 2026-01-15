import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent circular dependency
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

// Mock orderService
jest.mock('../../services/orderService', () => ({
  __esModule: true,
  default: {
    getAllOrders: jest.fn(),
    createOrder: jest.fn(),
    getOrderById: jest.fn(),
    updateOrderStatus: jest.fn(),
  },
}));

import {
  getAllOrders,
  createOrder,
  getOrder,
  updateOrderStatus,
} from '../../controllers/orderController';
import orderService from '../../services/orderService';

describe('Orders Controller', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

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
    mockNext = jest.fn();
  });

  describe('getAllOrders', () => {
    it('should return paginated orders', async () => {
      const mockOrders = [
        {
          id: 1,
          orderNumber: '1001',
          status: 'pending_confirmation',
          totalAmount: 100,
        },
        {
          id: 2,
          orderNumber: '1002',
          status: 'confirmed',
          totalAmount: 200,
        },
      ];

      mockReq.query = { page: '1', limit: '20' };

      (orderService.getAllOrders as jest.Mock).mockResolvedValue({
        orders: mockOrders,
        pagination: {
          page: 1,
          limit: 20,
          total: 2,
          pages: 1,
        },
      });

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

      (orderService.getAllOrders as jest.Mock).mockResolvedValue({
        orders: [],
        pagination: { page: 1, limit: 50, total: 0, pages: 0 },
      });

      await getAllOrders(mockReq, mockRes);

      expect(orderService.getAllOrders).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ['confirmed'],
        }),
        expect.anything()
      );
    });

    it('should search orders by order number', async () => {
      mockReq.query = { search: '1001' };

      (orderService.getAllOrders as jest.Mock).mockResolvedValue({
        orders: [],
        pagination: { page: 1, limit: 50, total: 0, pages: 0 },
      });

      await getAllOrders(mockReq, mockRes);

      expect(orderService.getAllOrders).toHaveBeenCalled();
    });
  });

  describe('createOrder', () => {
    it('should create a new order', async () => {
      const orderData = {
        customerId: 123,
        orderItems: [
          { productId: 1, quantity: 2, unitPrice: 50 },
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
        id: 123,
        orderNumber: '1001',
        ...orderData,
      };

      (orderService.createOrder as jest.Mock).mockResolvedValue(mockOrder);

      await createOrder(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ order: mockOrder });
    });
  });

  describe('getOrder', () => {
    it('should return order by id', async () => {
      const mockOrder = {
        id: 123,
        orderNumber: 'ORD-001',
        customer: { id: 1, firstName: 'John' },
      };

      mockReq.params = { id: '123' };
      (orderService.getOrderById as jest.Mock).mockResolvedValue(mockOrder);

      await getOrder(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({ order: mockOrder });
    });

    it('should throw error if order not found', async () => {
      mockReq.params = { id: '999' };
      (orderService.getOrderById as jest.Mock).mockRejectedValue(
        new Error('Order not found')
      );

      await expect(getOrder(mockReq, mockRes, mockNext)).rejects.toThrow('Order not found');
    });
  });

  describe('updateOrderStatus', () => {
    it('should update order status', async () => {
      const mockOrder = {
        id: 123,
        orderNumber: 'ORD-001',
        status: 'confirmed',
      };

      mockReq.params = { id: '123' };
      mockReq.body = { status: 'confirmed', notes: 'Order confirmed' };

      (orderService.updateOrderStatus as jest.Mock).mockResolvedValue(mockOrder);

      await updateOrderStatus(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({ order: mockOrder });
      expect(orderService.updateOrderStatus).toHaveBeenCalledWith(
        '123',
        expect.objectContaining({
          status: 'confirmed',
          notes: 'Order confirmed',
          changedBy: 'user-123',
        }),
        expect.anything()
      );
    });
  });
});
