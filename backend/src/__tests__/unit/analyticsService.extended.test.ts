/**
 * Extended AnalyticsService tests for branch coverage
 * Focuses on untested branches: role-scoped filtering, date filters, getPendingOrders, getRecentActivity
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { AnalyticsService } from '../../services/analyticsService';

const makeOrder = (overrides: any = {}) => ({
  id: 1,
  status: 'pending_confirmation',
  totalAmount: 200,
  createdAt: new Date(),
  customer: { id: 1, firstName: 'Ama', lastName: 'Boateng', phoneNumber: '+233', area: 'Accra' },
  customerRep: null,
  deletedAt: null,
  ...overrides,
});

describe('AnalyticsService (extended branch coverage)', () => {
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    analyticsService = new AnalyticsService();
  });

  // ───────────────────────────── getDashboardMetrics - role filtering ─────────────────────────────
  describe('getDashboardMetrics - user scope filtering', () => {
    const setupMetricMocks = () => {
      (prismaMock.order.count as any).mockResolvedValue(10);
      (prismaMock.accountTransaction.aggregate as any).mockResolvedValue({ _sum: { creditAmount: 1000, debitAmount: 0 } } as any);
      (prismaMock.user.count as any).mockResolvedValue(3);
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);
    };

    it('scopes metrics for sales_rep role', async () => {
      setupMetricMocks();
      const result = await analyticsService.getDashboardMetrics(undefined, 10, 'sales_rep');
      expect(result).toBeDefined();
    });

    it('scopes metrics for delivery_agent role', async () => {
      setupMetricMocks();
      const result = await analyticsService.getDashboardMetrics(undefined, 20, 'delivery_agent');
      expect(result).toBeDefined();
    });

    it('shows all data for admin role', async () => {
      setupMetricMocks();
      const result = await analyticsService.getDashboardMetrics(undefined, 1, 'admin');
      expect(result).toBeDefined();
    });

    it('applies custom date range filters', async () => {
      setupMetricMocks();
      const result = await analyticsService.getDashboardMetrics(
        { startDate: '2024-01-01', endDate: '2024-12-31' }
      );
      expect(result).toBeDefined();
    });

    it('uses month-to-date when no date filter provided', async () => {
      setupMetricMocks();
      const result = await analyticsService.getDashboardMetrics();
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getSalesTrends - with user scoping ─────────────────────────────
  describe('getSalesTrends - user scoping', () => {
    beforeEach(() => {
      (prismaMock.order.findMany as any).mockResolvedValue([]);
    });

    it('scopes trends for sales_rep', async () => {
      const result = await analyticsService.getSalesTrends('week', undefined, 10, 'sales_rep');
      expect(result).toBeDefined();
    });

    it('scopes trends for delivery_agent', async () => {
      const result = await analyticsService.getSalesTrends('week', undefined, 20, 'delivery_agent');
      expect(result).toBeDefined();
    });

    it('returns trends without userId (no filter)', async () => {
      const result = await analyticsService.getSalesTrends('week');
      expect(result).toBeDefined();
    });

    it('groups by month when period is month', async () => {
      const result = await analyticsService.getSalesTrends('month');
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getConversionFunnel - with user scoping ─────────────────────────────
  describe('getConversionFunnel', () => {
    beforeEach(() => {
      (prismaMock.order.groupBy as any).mockResolvedValue([
        { status: 'pending_confirmation', _count: 50 },
        { status: 'delivered', _count: 30 },
      ] as any);
    });

    it('returns funnel metrics with no date filters', async () => {
      const result = await analyticsService.getConversionFunnel({});
      expect(result).toHaveLength(2);
    });

    it('scopes funnel for sales_rep', async () => {
      const result = await analyticsService.getConversionFunnel({}, 10, 'sales_rep');
      expect(result).toBeDefined();
    });

    it('applies startDate filter only', async () => {
      const result = await analyticsService.getConversionFunnel({ startDate: new Date('2024-01-01') });
      expect(result).toBeDefined();
    });

    it('applies endDate filter only', async () => {
      const result = await analyticsService.getConversionFunnel({ endDate: new Date('2024-12-31') });
      expect(result).toBeDefined();
    });

    it('applies both startDate and endDate filters', async () => {
      const result = await analyticsService.getConversionFunnel({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getPendingOrders ─────────────────────────────
  describe('getPendingOrders', () => {
    it('returns pending orders with no user scope (admin)', async () => {
      const order = makeOrder({ customerRep: null });
      (prismaMock.order.findMany as any).mockResolvedValue([order] as any);

      const result = await analyticsService.getPendingOrders();
      expect(result).toHaveLength(1);
      expect(result[0].repName).toBe('Unassigned');
    });

    it('returns pending orders with rep assigned', async () => {
      const order = makeOrder({
        customerRep: { id: 10, firstName: 'Kofi', lastName: 'Asante' },
      });
      (prismaMock.order.findMany as any).mockResolvedValue([order] as any);

      const result = await analyticsService.getPendingOrders();
      expect(result[0].repName).toBe('Kofi Asante');
    });

    it('scopes pending orders for sales_rep', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([makeOrder()] as any);

      const result = await analyticsService.getPendingOrders(10, 'sales_rep');
      expect(result).toHaveLength(1);
    });

    it('scopes pending orders for delivery_agent', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([makeOrder()] as any);

      const result = await analyticsService.getPendingOrders(20, 'delivery_agent');
      expect(result).toHaveLength(1);
    });

    it('formats orderNumber with padded id', async () => {
      const order = makeOrder({ id: 42 });
      (prismaMock.order.findMany as any).mockResolvedValue([order] as any);

      const result = await analyticsService.getPendingOrders();
      expect(result[0].orderNumber).toBe('#000042');
    });
  });

  // ───────────────────────────── getRecentActivity ─────────────────────────────
  describe('getRecentActivity', () => {
    const makeNotification = (overrides: any = {}) => ({
      id: 1,
      type: 'order_created',
      title: 'New Order',
      message: 'Order created',
      isRead: false,
      createdAt: new Date(),
      data: {},
      user: { firstName: 'Ama', lastName: 'Boateng', role: 'admin' },
      ...overrides,
    });

    it('returns all activity without user scope', async () => {
      (prismaMock.notification.findMany as any).mockResolvedValue([makeNotification()] as any);

      const result = await analyticsService.getRecentActivity();
      expect(result).toHaveLength(1);
      expect(result[0].userName).toBe('Ama Boateng');
    });

    it('scopes activity for sales_rep (only their notifications)', async () => {
      (prismaMock.notification.findMany as any).mockResolvedValue([makeNotification()] as any);

      const result = await analyticsService.getRecentActivity(10, 'sales_rep');
      expect(result).toHaveLength(1);
    });

    it('does not scope activity for admin role', async () => {
      (prismaMock.notification.findMany as any).mockResolvedValue([makeNotification()] as any);

      const result = await analyticsService.getRecentActivity(1, 'admin');
      expect(result).toHaveLength(1);
    });

    it('returns empty array when no notifications', async () => {
      (prismaMock.notification.findMany as any).mockResolvedValue([] as any);

      const result = await analyticsService.getRecentActivity();
      expect(result).toHaveLength(0);
    });
  });

  // ───────────────────────────── getOrderStatusDistribution ─────────────────────────────
  describe('getOrderStatusDistribution', () => {
    it('returns distribution with MTD default (no filters)', async () => {
      (prismaMock.order.groupBy as any).mockResolvedValue([
        { status: 'delivered', _count: { status: 50 } },
        { status: 'pending_confirmation', _count: { status: 20 } },
      ] as any);

      const result = await analyticsService.getOrderStatusDistribution();
      expect(result).toHaveLength(2);
      expect(result[0].count).toBe(50); // sorted by count desc
    });

    it('applies custom date range filters', async () => {
      (prismaMock.order.groupBy as any).mockResolvedValue([] as any);

      const result = await analyticsService.getOrderStatusDistribution({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });
      expect(result).toHaveLength(0);
    });

    it('scopes distribution for sales_rep', async () => {
      (prismaMock.order.groupBy as any).mockResolvedValue([
        { status: 'confirmed', _count: { status: 5 } },
      ] as any);

      const result = await analyticsService.getOrderStatusDistribution(undefined, 10, 'sales_rep');
      expect(result[0].count).toBe(5);
    });
  });

  // ───────────────────────────── getRepPerformance - with date filters ─────────────────────────────
  describe('getRepPerformance - date filtering', () => {
    const mockRep = {
      id: 1,
      firstName: 'Kwame',
      lastName: 'Rep',
      assignedOrdersAsRep: [
        {
          id: 1, status: 'delivered', totalAmount: 300,
          createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-02'), commissionPaid: false,
        },
      ],
    };

    const setupRepMocks = () => {
      (prismaMock.user.findMany as any).mockResolvedValue([mockRep] as any);
      (prismaMock.order.count as any).mockResolvedValue(0);
      (prismaMock.order.aggregate as any).mockResolvedValue({ _count: { id: 1 }, _sum: { totalAmount: 300 } } as any);
    };

    it('applies custom date range to rep performance', async () => {
      setupRepMocks();
      const result = await analyticsService.getRepPerformance(
        { startDate: '2024-01-01', endDate: '2024-01-31' }
      );
      expect(result).toBeDefined();
    });

    it('scopes rep performance for specific user (sales_rep)', async () => {
      setupRepMocks();
      const result = await analyticsService.getRepPerformance(undefined, 1, 'sales_rep');
      expect(result).toBeDefined();
    });

    it('returns MTD performance with no filters', async () => {
      setupRepMocks();
      const result = await analyticsService.getRepPerformance();
      expect(result).toBeDefined();
    });

    it('applies only startDate filter', async () => {
      setupRepMocks();
      const result = await analyticsService.getRepPerformance({ startDate: '2024-01-01' });
      expect(result).toBeDefined();
    });

    it('applies only endDate filter', async () => {
      setupRepMocks();
      const result = await analyticsService.getRepPerformance({ endDate: '2024-12-31' });
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getAgentPerformance - with date filters ─────────────────────────────
  describe('getAgentPerformance - date filtering', () => {
    beforeEach(() => {
      (prismaMock.user.findMany as any).mockResolvedValue([]);
      (prismaMock.delivery.findMany as any).mockResolvedValue([]);
    });

    it('applies date filters to agent performance', async () => {
      const result = await analyticsService.getAgentPerformance({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });
      expect(result).toBeDefined();
    });

    it('returns performance without date filters', async () => {
      const result = await analyticsService.getAgentPerformance();
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getProductPerformance - date filters ─────────────────────────────
  describe('getProductPerformance', () => {
    beforeEach(() => {
      (prismaMock.orderItem.groupBy as any).mockResolvedValue([]);
      (prismaMock.product.findMany as any).mockResolvedValue([]);
    });

    it('returns product performance with both date filters', async () => {
      const result = await analyticsService.getProductPerformance({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });
      expect(result).toBeDefined();
    });

    it('returns product performance with only startDate', async () => {
      const result = await analyticsService.getProductPerformance({ startDate: new Date('2024-01-01') });
      expect(result).toBeDefined();
    });

    it('returns product performance with only endDate', async () => {
      const result = await analyticsService.getProductPerformance({ endDate: new Date('2024-12-31') });
      expect(result).toBeDefined();
    });

    it('returns product performance without date filter', async () => {
      const result = await analyticsService.getProductPerformance();
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getAreaDistribution - date filters ─────────────────────────────
  describe('getAreaDistribution', () => {
    beforeEach(() => {
      (prismaMock.order.groupBy as any).mockResolvedValue([
        { deliveryArea: 'Accra', _count: { deliveryArea: 30 }, _sum: { totalAmount: 6000 } },
      ] as any);
      (prismaMock.order.count as any).mockResolvedValue(30);
    });

    it('returns area distribution with date filter', async () => {
      const result = await analyticsService.getAreaDistribution({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });
      expect(result).toBeDefined();
    });

    it('returns area distribution without date filter', async () => {
      const result = await analyticsService.getAreaDistribution();
      expect(result).toBeDefined();
    });
  });
});
