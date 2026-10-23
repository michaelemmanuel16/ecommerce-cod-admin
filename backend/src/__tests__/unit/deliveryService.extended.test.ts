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

    it('reads a date-only endDate as the whole store day; an ISO endDate as the instant', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([] as any);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.groupBy as any).mockResolvedValue([] as any);
      const createdAt = () => (prismaMock.order.findMany as any).mock.calls.at(-1)[0].where.OR[1].createdAt;

      await deliveryService.getAgentOrders(2, { startDate: '2024-12-01', endDate: '2024-12-31' });
      expect(createdAt()).toEqual({ gte: new Date('2024-12-01T00:00:00.000Z'), lte: new Date('2024-12-31T23:59:59.999Z') });

      await deliveryService.getAgentOrders(2, { startDate: '2024-12-01', endDate: '2024-12-31T10:00:00.000Z' });
      expect(createdAt().lte).toEqual(new Date('2024-12-31T10:00:00.000Z'));
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
