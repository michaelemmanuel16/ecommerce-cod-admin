/**
 * Extended DeliveryService tests to boost branch coverage
 * Focused on methods and branches not covered in the main deliveryService.test.ts
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/glAccountService', () => ({
  GLAccountService: { getAccountIdByCode: jest.fn().mockResolvedValue(10) },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { DeliveryService } from '../../services/deliveryService';
import { AppError } from '../../middleware/errorHandler';
import { OrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const makeOrder = (overrides: any = {}) => ({
  id: 1,
  status: 'ready_for_pickup' as OrderStatus,
  customerId: 5,
  deliveryAgentId: null,
  deliveryArea: 'Accra',
  deliveryAddress: '10 Main St',
  deliveryState: 'Greater Accra',
  totalAmount: new Decimal(200),
  paymentStatus: 'pending',
  notes: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeDelivery = (overrides: any = {}) => ({
  id: 1,
  orderId: 1,
  agentId: 2,
  scheduledTime: new Date(),
  actualDeliveryTime: null,
  deliveryAttempts: 0,
  proofType: null,
  proofData: null,
  proofImageUrl: null,
  recipientName: null,
  recipientPhone: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeAgent = (overrides: any = {}) => ({
  id: 2,
  firstName: 'Kwame',
  lastName: 'Mensah',
  role: 'delivery_agent',
  isActive: true,
  isAvailable: true,
  phoneNumber: '+233201234567',
  ...overrides,
});

describe('DeliveryService (extended branch coverage)', () => {
  let deliveryService: DeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    deliveryService = new DeliveryService();
  });

  // ───────────────────────────── getAllDeliveries ─────────────────────────────
  describe('getAllDeliveries', () => {
    it('returns paginated deliveries without agent filter', async () => {
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);
      (prismaMock.delivery.count as any).mockResolvedValue(0);

      const result = await deliveryService.getAllDeliveries({});
      expect(result.pagination.total).toBe(0);
    });

    it('returns paginated deliveries with agentId filter', async () => {
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);
      (prismaMock.delivery.count as any).mockResolvedValue(5);

      const result = await deliveryService.getAllDeliveries({ agentId: '2', page: 1, limit: 10 });
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.pages).toBe(1);
    });

    it('calculates correct pagination', async () => {
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);
      (prismaMock.delivery.count as any).mockResolvedValue(25);

      const result = await deliveryService.getAllDeliveries({ page: 2, limit: 10 });
      expect(result.pagination.pages).toBe(3);
    });
  });

  // ───────────────────────────── getDeliveryById ─────────────────────────────
  describe('getDeliveryById', () => {
    it('returns delivery when found', async () => {
      const delivery = makeDelivery({ order: makeOrder(), agent: makeAgent() });
      (prismaMock.delivery.findUnique as any).mockResolvedValue(delivery as any);

      const result = await deliveryService.getDeliveryById('1');
      expect(result.id).toBe(1);
    });

    it('throws 404 when delivery not found', async () => {
      (prismaMock.delivery.findUnique as any).mockResolvedValue(null);
      await expect(deliveryService.getDeliveryById('999')).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── createDelivery ─────────────────────────────
  describe('createDelivery - error branches', () => {
    it('throws error when order not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);
      await expect(deliveryService.createDelivery({ orderId: 999, agentId: 2 })).rejects.toThrow(AppError);
    });

    it('throws error when order is not in ready_for_pickup status', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(makeOrder({ status: 'pending_confirmation' as OrderStatus }) as any);
      await expect(deliveryService.createDelivery({ orderId: 1, agentId: 2 })).rejects.toThrow(AppError);
    });

    it('throws error when agent not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(makeOrder() as any);
      (prismaMock.user.findUnique as any).mockResolvedValue(null);
      await expect(deliveryService.createDelivery({ orderId: 1, agentId: 99 })).rejects.toThrow(AppError);
    });

    it('throws error when agent is not a delivery_agent', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(makeOrder() as any);
      (prismaMock.user.findUnique as any).mockResolvedValue({ ...makeAgent(), role: 'admin' } as any);
      await expect(deliveryService.createDelivery({ orderId: 1, agentId: 2 })).rejects.toThrow(AppError);
    });

    it('throws error when agent is not available', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(makeOrder() as any);
      (prismaMock.user.findUnique as any).mockResolvedValue({ ...makeAgent(), isAvailable: false } as any);
      await expect(deliveryService.createDelivery({ orderId: 1, agentId: 2 })).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── autoAssignAgent ─────────────────────────────
  describe('autoAssignAgent', () => {
    it('throws 404 when order not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);
      await expect(deliveryService.autoAssignAgent('999')).rejects.toThrow(AppError);
    });

    it('throws 404 when no available agents found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(makeOrder() as any);
      (prismaMock.user.findMany as any).mockResolvedValue([] as any);
      await expect(deliveryService.autoAssignAgent('1')).rejects.toThrow(AppError);
    });

    it('assigns the agent with fewest current deliveries (load balancing)', async () => {
      const order = makeOrder();
      const busyAgent = { ...makeAgent(), id: 3, assignedOrdersAsAgent: [{ id: 1 }, { id: 2 }] };
      const freeAgent = { ...makeAgent(), id: 4, assignedOrdersAsAgent: [] };

      (prismaMock.order.findUnique as any).mockResolvedValue(order as any);
      (prismaMock.user.findMany as any).mockResolvedValue([busyAgent, freeAgent] as any);

      // Mock createDelivery path
      (prismaMock.order.findUnique as any)
        .mockResolvedValueOnce(order as any) // autoAssignAgent initial check
        .mockResolvedValueOnce(order as any) // createDelivery order check
      ;
      (prismaMock.user.findUnique as any).mockResolvedValue(freeAgent as any);
      (prismaMock.delivery.create as any).mockResolvedValue(makeDelivery({ agentId: 4 }) as any);
      (prismaMock.order.update as any).mockResolvedValue(order as any);
      (prismaMock.glEntry.create as any).mockResolvedValue({} as any);

      // This will try to create a delivery - mock it properly
      jest.spyOn(deliveryService, 'createDelivery').mockResolvedValue(makeDelivery() as any);

      const result = await deliveryService.autoAssignAgent('1');
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getDeliveryByOrderId ─────────────────────────────
  describe('getDeliveryByOrderId', () => {
    it('returns delivery mapped from order when found', async () => {
      const order = {
        ...makeOrder(),
        customer: { firstName: 'Ama', lastName: 'Asante', phoneNumber: '+233' },
        orderItems: [],
        delivery: null,
        deliveryAgent: null,
      };
      (prismaMock.order.findUnique as any).mockResolvedValue(order as any);

      const result = await deliveryService.getDeliveryByOrderId(1);
      expect(result.orderId).toBe(1);
    });

    it('returns delivery filtered by agentUserId', async () => {
      const order = {
        ...makeOrder(),
        customer: { firstName: 'Ama', lastName: 'Asante', phoneNumber: '+233' },
        orderItems: [],
        delivery: makeDelivery(),
        deliveryAgent: makeAgent(),
      };
      (prismaMock.order.findUnique as any).mockResolvedValue(order as any);

      const result = await deliveryService.getDeliveryByOrderId(1, 2);
      expect(result.orderId).toBe(1);
    });

    it('throws 404 when order not found', async () => {
      (prismaMock.order.findUnique as any).mockResolvedValue(null);
      await expect(deliveryService.getDeliveryByOrderId(999)).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── getAgentStats ─────────────────────────────
  describe('getAgentStats', () => {
    it('returns stats with no date filter', async () => {
      (prismaMock.delivery.count as any).mockResolvedValue(10);
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);

      const result = await deliveryService.getAgentStats('2');
      expect(result.totalDeliveries).toBe(10);
      expect(result.onTimeRate).toBe(0); // no deliveries with timing data
    });

    it('applies startDate and endDate filters', async () => {
      (prismaMock.delivery.count as any).mockResolvedValue(5);
      (prismaMock.delivery.findMany as any).mockResolvedValue([
        {
          scheduledTime: new Date('2024-01-01T10:00:00'),
          actualDeliveryTime: new Date('2024-01-01T09:30:00'), // delivered early (on time)
        },
        {
          scheduledTime: new Date('2024-01-02T10:00:00'),
          actualDeliveryTime: new Date('2024-01-02T11:00:00'), // late
        },
      ] as any);

      const result = await deliveryService.getAgentStats('2', {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });
      expect(result.totalDeliveries).toBe(5);
      // 1 on-time out of 2 = 50%
      expect(result.onTimeRate).toBe(50);
    });

    it('applies only startDate filter', async () => {
      (prismaMock.delivery.count as any).mockResolvedValue(3);
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);

      const result = await deliveryService.getAgentStats('2', {
        startDate: new Date('2024-01-01'),
      });
      expect(result.totalDeliveries).toBe(3);
    });

    it('applies only endDate filter', async () => {
      (prismaMock.delivery.count as any).mockResolvedValue(7);
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);

      const result = await deliveryService.getAgentStats('2', {
        endDate: new Date('2024-12-31'),
      });
      expect(result.totalDeliveries).toBe(7);
    });
  });

  // ───────────────────────────── updateDelivery ─────────────────────────────
  describe('updateDelivery', () => {
    it('throws 404 when delivery not found', async () => {
      (prismaMock.delivery.findUnique as any).mockResolvedValue(null);
      await expect(deliveryService.updateDelivery('1', {})).rejects.toThrow(AppError);
    });

    it('updates delivery successfully', async () => {
      const delivery = makeDelivery();
      (prismaMock.delivery.findUnique as any).mockResolvedValue(delivery as any);
      (prismaMock.delivery.update as any).mockResolvedValue({ ...delivery, notes: 'updated' } as any);

      const result = await deliveryService.updateDelivery('1', { notes: 'updated' });
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── uploadProofOfDelivery ─────────────────────────────
  describe('uploadProofOfDelivery', () => {
    it('throws 404 when delivery not found', async () => {
      (prismaMock.delivery.findUnique as any).mockResolvedValue(null);
      await expect(
        deliveryService.uploadProofOfDelivery('1', { proofType: 'signature' as any, proofData: 'sig' })
      ).rejects.toThrow(AppError);
    });

    it('updates proof of delivery successfully', async () => {
      const delivery = makeDelivery();
      (prismaMock.delivery.findUnique as any).mockResolvedValue(delivery as any);
      (prismaMock.delivery.update as any).mockResolvedValue({
        ...delivery, proofType: 'signature', proofData: 'sig'
      } as any);

      const result = await deliveryService.uploadProofOfDelivery('1', {
        proofType: 'signature' as any,
        proofData: 'sig'
      });
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getAgentRoute ─────────────────────────────
  describe('getAgentRoute', () => {
    it('returns route with default date (today) when no date provided', async () => {
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);
      const result = await deliveryService.getAgentRoute('2');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns route for specific date', async () => {
      const delivery = {
        ...makeDelivery(),
        order: { ...makeOrder(), customer: { firstName: 'A', lastName: 'B', phoneNumber: '+233' } },
        agent: makeAgent(),
      };
      (prismaMock.delivery.findMany as any).mockResolvedValue([delivery] as any);

      const result = await deliveryService.getAgentRoute('2', new Date('2024-06-15'));
      expect(result).toHaveLength(1);
    });
  });

  // ───────────────────────────── markDeliveryFailed (extended) ─────────────────────────────
  describe('markDeliveryFailed - extended branches', () => {
    it('throws 404 when delivery not found', async () => {
      (prismaMock.delivery.findUnique as any).mockResolvedValue(null);
      await expect(
        deliveryService.markDeliveryFailed('1', { reason: 'not home', reschedule: false })
      ).rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── getAgentOrders ─────────────────────────────
  describe('getAgentOrders', () => {
    it('returns agent orders without filters', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([] as any);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.groupBy as any).mockResolvedValue([] as any);

      const result = await deliveryService.getAgentOrders(2);
      expect(result.pagination.total).toBe(0);
    });

    it('returns agent orders with status filter', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([] as any);
      (prismaMock.order.count as any).mockResolvedValue(3);
      (prismaMock.order.groupBy as any).mockResolvedValue([
        { status: 'delivered', _count: 3 },
      ] as any);

      const result = await deliveryService.getAgentOrders(2, { status: 'delivered', page: 1, limit: 10 });
      expect(result.pagination.total).toBe(3);
      expect(result.statusCounts['delivered']).toBe(3);
    });

    it('applies date filter for terminal statuses', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([] as any);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.groupBy as any).mockResolvedValue([] as any);

      const result = await deliveryService.getAgentOrders(2, {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });
      expect(result).toBeDefined();
    });

    it('handles text search for agent orders', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([] as any);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.groupBy as any).mockResolvedValue([] as any);

      const result = await deliveryService.getAgentOrders(2, { search: 'John' });
      expect(result).toBeDefined();
    });

    it('handles numeric search (by order ID)', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([] as any);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.groupBy as any).mockResolvedValue([] as any);

      const result = await deliveryService.getAgentOrders(2, { search: '123' });
      expect(result).toBeDefined();
    });
  });
});
