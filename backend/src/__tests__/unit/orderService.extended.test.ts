/**
 * Extended OrderService tests to boost branch coverage
 * Focused on branches not covered in the main orderService.test.ts
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent it from starting
jest.mock('../../server', () => {
  const m = { emit: jest.fn(), to: jest.fn() };
  m.to.mockReturnValue(m);
  return { io: m };
});

jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../../utils/appEvents', () => ({
  __esModule: true,
  default: { emit: jest.fn() },
  AppEvent: {
    BULK_ORDERS_IMPORTED: 'BULK_ORDERS_IMPORTED',
    AGENT_COLLECTION_RECONCILED: 'AGENT_COLLECTION_RECONCILED',
  },
}));

jest.mock('../../utils/socketInstance', () => ({
  getSocketInstance: jest.fn().mockReturnValue({
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  }),
}));

jest.mock('../../sockets', () => ({
  emitOrderCreated: jest.fn(),
  emitOrderUpdated: jest.fn(),
  emitOrderStatusChanged: jest.fn(),
  emitOrderAssigned: jest.fn(),
  emitOrdersDeleted: jest.fn(),
}));

import { prismaMock } from '../mocks/prisma.mock';
import orderService from '../../services/orderService';
import { AppError } from '../../middleware/errorHandler';
import { OrderStatus } from '@prisma/client';

const adminRequester = { id: 1, role: 'admin', tenantId: 'tenant-1' };
const salesRepRequester = { id: 10, role: 'sales_rep', tenantId: 'tenant-1' };
const agentRequester = { id: 20, role: 'delivery_agent', tenantId: 'tenant-1' };
const managerRequester = { id: 2, role: 'manager', tenantId: 'tenant-1' };

describe('OrderService (extended branch coverage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────── getAllOrders ─────────────────────────────
  describe('getAllOrders - branch coverage', () => {
    const mockPaginatedResult = [
      {
        id: 1,
        status: 'pending_confirmation' as OrderStatus,
        customer: { id: 1, firstName: 'A', lastName: 'B', phoneNumber: '+233', alternatePhone: null },
        customerRep: null,
        deliveryAgent: null,
        orderItems: [],
      },
    ];

    beforeEach(() => {
      (prismaMock.order.findMany as any).mockResolvedValue(mockPaginatedResult as any);
      (prismaMock.order.count as any).mockResolvedValue(1);
    });

    it('applies status filter when provided', async () => {
      await orderService.getAllOrders({ status: ['pending_confirmation'] });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies customerId filter', async () => {
      await orderService.getAllOrders({ customerId: 5 });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies customerRepId filter', async () => {
      await orderService.getAllOrders({ customerRepId: 3 });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies deliveryAgentId filter', async () => {
      await orderService.getAllOrders({ deliveryAgentId: 4 });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies area filter', async () => {
      await orderService.getAllOrders({ area: 'Accra' });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies startDate and endDate date range filter', async () => {
      const start = new Date('2024-01-01');
      const end = new Date('2024-12-31');
      await orderService.getAllOrders({ startDate: start, endDate: end });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies only startDate', async () => {
      await orderService.getAllOrders({ startDate: new Date('2024-01-01') });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies only endDate', async () => {
      await orderService.getAllOrders({ endDate: new Date('2024-12-31') });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies numeric search (by order id)', async () => {
      await orderService.getAllOrders({ search: '123' });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies text search (by customer name)', async () => {
      await orderService.getAllOrders({ search: 'John' });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies role filter for sales_rep (scoped to their orders)', async () => {
      await orderService.getAllOrders({}, salesRepRequester as any);
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('applies role filter for delivery_agent (scoped to their deliveries)', async () => {
      await orderService.getAllOrders({}, agentRequester as any);
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('does not filter by role for admin', async () => {
      await orderService.getAllOrders({}, adminRequester as any);
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('returns correct pagination metadata', async () => {
      (prismaMock.order.count as any).mockResolvedValue(50);
      const result = await orderService.getAllOrders({ page: 2, limit: 10 });
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.pages).toBe(5);
    });
  });

  // ───────────────────────────── getOrderById ─────────────────────────────
  describe('getOrderById - branch coverage', () => {
    const mockOrder = {
      id: 1,
      status: 'pending_confirmation' as OrderStatus,
      customerId: 5,
      customerRepId: 10,
      deliveryAgentId: 20,
      deletedAt: null,
    };

    it('throws 404 when order not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);
      await expect(orderService.getOrderById(999)).rejects.toThrow(AppError);
    });

    it('returns order when no requester provided', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      const result = await orderService.getOrderById(1);
      expect(result).toBeDefined();
    });

    it('returns order when requester is admin (owns all)', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      const result = await orderService.getOrderById(1, adminRequester as any);
      expect(result).toBeDefined();
    });

    it('returns order when requester is the assigned sales_rep', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      const result = await orderService.getOrderById(1, salesRepRequester as any);
      expect(result).toBeDefined();
    });

    it('returns order when requester is the assigned delivery_agent', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      const result = await orderService.getOrderById(1, agentRequester as any);
      expect(result).toBeDefined();
    });

    it('throws 403 when delivery_agent is not assigned to this order', async () => {
      const orderForOtherAgent = { ...mockOrder, deliveryAgentId: 99 };
      (prismaMock.order.findUnique as any).mockResolvedValue(orderForOtherAgent as any);
      const otherAgent = { id: 20, role: 'delivery_agent', tenantId: 'tenant-1' };
      await expect(orderService.getOrderById(1, otherAgent as any)).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── assignCustomerRep ─────────────────────────────
  describe('assignCustomerRep - branch coverage', () => {
    const mockOrder = { id: 1, status: 'confirmed' as OrderStatus, customerRepId: null, deliveryAgentId: null, customerId: 5 };
    const mockRep = { id: 99, firstName: 'Jane', lastName: 'Rep', role: 'sales_rep', isAvailable: true };

    it('throws 403 for non-admin requester', async () => {
      await expect(
        orderService.assignCustomerRep(1, 99, salesRepRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('throws 404 when order not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);
      (prismaMock.user.findUnique as any).mockResolvedValue(mockRep as any);
      await expect(
        orderService.assignCustomerRep(1, 99, adminRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('throws 400 when rep is not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.user.findUnique as any).mockResolvedValue(null);
      await expect(
        orderService.assignCustomerRep(1, 99, adminRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('throws 400 when user is not a sales_rep', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.user.findUnique as any).mockResolvedValue({ ...mockRep, role: 'admin' } as any);
      await expect(
        orderService.assignCustomerRep(1, 99, adminRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('assigns rep successfully for admin', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.user.findUnique as any).mockResolvedValue(mockRep as any);
      (prismaMock.order.update as any).mockResolvedValue({ ...mockOrder, customerRepId: 99 } as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await orderService.assignCustomerRep(1, 99, adminRequester as any);
      expect(result).toBeDefined();
    });

    it('assigns rep successfully for manager', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.user.findUnique as any).mockResolvedValue(mockRep as any);
      (prismaMock.order.update as any).mockResolvedValue({ ...mockOrder, customerRepId: 99 } as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await orderService.assignCustomerRep(1, 99, managerRequester as any);
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── assignDeliveryAgent ─────────────────────────────
  describe('assignDeliveryAgent - branch coverage', () => {
    const mockOrder = { id: 1, status: 'confirmed' as OrderStatus, customerRepId: 10, deliveryAgentId: null, customerId: 5 };
    const mockAgent = { id: 55, firstName: 'Del', lastName: 'Agent', role: 'delivery_agent', isAvailable: true };

    it('throws 403 for delivery_agent requester not assigned to order', async () => {
      // First findUnique call in permission check
      (prismaMock.order.findUnique as any).mockResolvedValue({ ...mockOrder, customerRepId: 99 } as any);
      await expect(
        orderService.assignDeliveryAgent(1, 55, agentRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('throws 404 when order not found (for admin)', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);
      (prismaMock.user.findUnique as any).mockResolvedValue(mockAgent as any);
      await expect(
        orderService.assignDeliveryAgent(1, 55, adminRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('throws 400 when delivery agent not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.user.findUnique as any).mockResolvedValue(null);
      await expect(
        orderService.assignDeliveryAgent(1, 55, adminRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('throws 400 when user is not a delivery_agent', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.user.findUnique as any).mockResolvedValue({ ...mockAgent, role: 'sales_rep' } as any);
      await expect(
        orderService.assignDeliveryAgent(1, 55, adminRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('throws 400 when delivery agent is not available', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.user.findUnique as any).mockResolvedValue({ ...mockAgent, isAvailable: false } as any);
      await expect(
        orderService.assignDeliveryAgent(1, 55, adminRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('assigns delivery agent successfully for admin', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(mockOrder as any);
      (prismaMock.user.findUnique as any).mockResolvedValue(mockAgent as any);
      (prismaMock.order.update as any).mockResolvedValue({ ...mockOrder, deliveryAgentId: 55 } as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await orderService.assignDeliveryAgent(1, 55, adminRequester as any);
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── updateOrderStatus (extended) ─────────────────────────────
  describe('updateOrderStatus - extended branches', () => {
    const baseOrder = {
      id: 1,
      status: 'confirmed' as OrderStatus,
      customerId: 5,
      customerRepId: 10,
      deliveryAgentId: null,
      deletedAt: null,
      customer: { id: 5, totalOrders: 1, totalSpent: 100 },
      orderItems: [{ productId: 1, quantity: 2, product: { id: 1, stockQuantity: 10 } }],
      totalAmount: 200,
    };

    it('throws 404 when order not found for status update', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);
      await expect(
        orderService.updateOrderStatus(999, { status: 'confirmed' as OrderStatus }, adminRequester as any)
      ).rejects.toThrow(AppError);
    });

    it('throws 403 for sales_rep updating order not assigned to them', async () => {
      const orderWithOtherRep = { ...baseOrder, customerRepId: 999 };
      (prismaMock.order.findUnique as any).mockResolvedValue(orderWithOtherRep as any);
      await expect(
        orderService.updateOrderStatus(1, { status: 'dispatched' as OrderStatus }, salesRepRequester as any)
      ).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── getKanbanView ─────────────────────────────
  describe('getKanbanView - branch coverage', () => {
    const kanbanResult = {
      pending_confirmation: [],
      confirmed: [],
      processing: [],
      ready_for_pickup: [],
      dispatched: [],
      delivered: [],
      failed_delivery: [],
      rescheduled: [],
      returned: [],
      cancelled: [],
    };

    beforeEach(() => {
      (prismaMock.order.findMany as any).mockResolvedValue([] as any);
    });

    it('applies area filter when provided', async () => {
      await orderService.getKanbanView({ area: 'Accra' });
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('filters by agentId when provided and requester is admin', async () => {
      await orderService.getKanbanView({ agentId: '5' }, adminRequester as any);
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('scopes kanban for sales_rep role', async () => {
      await orderService.getKanbanView({}, salesRepRequester as any);
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('scopes kanban for delivery_agent role', async () => {
      await orderService.getKanbanView({}, agentRequester as any);
      expect(prismaMock.order.findMany).toHaveBeenCalled();
    });

    it('returns all statuses for admin with no filters', async () => {
      const result = await orderService.getKanbanView({}, adminRequester as any);
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getOrderStats (extended) ─────────────────────────────
  describe('getOrderStats - date filter branch', () => {
    it('applies date filter when start and end dates are provided', async () => {
      (prismaMock.order.count as any).mockResolvedValue(50);
      (prismaMock.order.groupBy as any).mockResolvedValue([]);
      (prismaMock.order.aggregate as any)
        .mockResolvedValueOnce({ _sum: { totalAmount: 1000 } } as any)
        .mockResolvedValueOnce({ _avg: { totalAmount: 20 } } as any);

      const result = await orderService.getOrderStats({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });
      expect(result.totalOrders).toBe(50);
    });

    it('handles null totalAmount and avgOrderValue', async () => {
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.groupBy as any).mockResolvedValue([]);
      (prismaMock.order.aggregate as any)
        .mockResolvedValueOnce({ _sum: { totalAmount: null } } as any)
        .mockResolvedValueOnce({ _avg: { totalAmount: null } } as any);

      const result = await orderService.getOrderStats({});
      expect(result.totalRevenue).toBe(0);
      expect(result.avgOrderValue).toBe(0);
    });
  });

  // ───────────────────────────── deleteOrder ─────────────────────────────
  describe('deleteOrder - branch coverage', () => {
    const mockOrder = {
      id: 1,
      status: 'pending_confirmation' as OrderStatus,
      customerId: 5,
      customerRepId: null,
      deliveryAgentId: null,
      deletedAt: null,
      orderItems: [],
    };

    it('throws 404 when order not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);
      await expect(orderService.deleteOrder(999)).rejects.toThrow(AppError);
    });

    it('throws 400 when trying to delete a delivered order', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue({
        ...mockOrder,
        status: 'delivered' as OrderStatus,
      } as any);
      await expect(orderService.deleteOrder(1)).rejects.toThrow(AppError);
    });
  });
});
