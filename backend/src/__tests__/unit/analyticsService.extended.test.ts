/**
 * Extended AnalyticsService tests for branch coverage
 * Focuses on untested branches: role-scoped filtering, date filters, getPendingOrders, getRecentActivity
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/kpi/revenue');
jest.mock('../../services/kpi/rates', () => ({ ...jest.requireActual<object>('../../services/kpi/rates'), rates: jest.fn() }));
jest.mock('../../services/kpi/reps');
jest.mock('../../services/kpi/partners');
jest.mock('../../services/kpi/products');

import { prismaMock } from '../mocks/prisma.mock';
import { useTestTenant } from '../mocks/tenant.mock';
import { ratesResult, repRatesResult, repRevenueResult, revenueResult } from '../mocks/kpiResults';
import { AnalyticsService } from '../../services/analyticsService';
import { deliveredRevenue, deliveredRevenueByArea, deliveredRevenueByDay, deliveredRevenueByRep } from '../../services/kpi/revenue';
import { rates } from '../../services/kpi/rates';
import { repRates } from '../../services/kpi/reps';
import { partnerRates } from '../../services/kpi/partners';
import { productDeliveredUnits } from '../../services/kpi/products';

const mocked = <T extends (...args: any[]) => any>(fn: T) => fn as unknown as jest.MockedFunction<T>;

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
  useTestTenant();

  beforeEach(() => {
    jest.clearAllMocks();
    analyticsService = new AnalyticsService();
  });

  // ───────────────────────────── getDashboardMetrics - role filtering ─────────────────────────────
  describe('getDashboardMetrics - user scope filtering', () => {
    const setupMetricMocks = () => {
      (prismaMock.order.count as any).mockResolvedValue(10);
      mocked(deliveredRevenue).mockResolvedValue(revenueResult('1000.00', 4));
      mocked(rates).mockResolvedValue(ratesResult(70, 60, 30));
      (prismaMock.user.count as any).mockResolvedValue(3);
      (prismaMock.delivery.findMany as any).mockResolvedValue([] as any);
    };

    it('scopes metrics for sales_rep role (orders, revenue and rates)', async () => {
      setupMetricMocks();
      await analyticsService.getDashboardMetrics(undefined, 10, 'sales_rep');
      expect((prismaMock.order.count as any).mock.calls[0][0].where.customerRepId).toBe(10);
      expect(mocked(deliveredRevenue).mock.calls[0][3]).toEqual({ customerRepId: 10, deliveryAgentId: undefined });
      expect(mocked(rates).mock.calls[0][3]).toEqual({ repId: 10 });
    });

    it('scopes metrics for delivery_agent role (orders, revenue and rates)', async () => {
      setupMetricMocks();
      await analyticsService.getDashboardMetrics(undefined, 20, 'delivery_agent');
      expect((prismaMock.order.count as any).mock.calls[0][0].where.deliveryAgentId).toBe(20);
      expect(mocked(deliveredRevenue).mock.calls[0][3]).toEqual({ customerRepId: undefined, deliveryAgentId: 20 });
      expect(mocked(rates).mock.calls[0][3]).toEqual({ partnerId: 20 });
    });

    it('shows all data for admin role', async () => {
      setupMetricMocks();
      await analyticsService.getDashboardMetrics(undefined, 1, 'admin');
      const where = (prismaMock.order.count as any).mock.calls[0][0].where;
      expect(where.customerRepId).toBeUndefined();
      expect(where.deliveryAgentId).toBeUndefined();
      expect(mocked(rates).mock.calls[0][3]).toEqual({});
    });

    it('applies custom date range filters', async () => {
      setupMetricMocks();
      const result = await analyticsService.getDashboardMetrics(
        { startDate: '2024-01-01', endDate: '2024-12-31' }
      );
      expect(result.totalRevenue).toBe('1000.00');
      expect(mocked(deliveredRevenue).mock.calls[0][1]).toEqual(new Date('2024-01-01T00:00:00.000Z'));
      expect(mocked(deliveredRevenue).mock.calls[0][2]).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    });

    it('uses month-to-date when no date filter provided', async () => {
      setupMetricMocks();
      const result = await analyticsService.getDashboardMetrics();
      expect(result.deliveredOrders).toBe(4);
      expect(mocked(deliveredRevenue).mock.calls[0][1].getUTCDate()).toBe(1);
    });
  });

  // ───────────────────────────── getSalesTrends - with user scoping ─────────────────────────────
  describe('getSalesTrends - user scoping', () => {
    beforeEach(() => {
      (prismaMock.order.findMany as any).mockResolvedValue([]);
      mocked(deliveredRevenueByDay).mockResolvedValue([]);
    });

    it('scopes trends for sales_rep', async () => {
      const result = await analyticsService.getSalesTrends({ period: 'daily' }, 10, 'sales_rep');
      expect(result).toEqual([]);
      expect((prismaMock.order.findMany as any).mock.calls[0][0].where.customerRepId).toBe(10);
      expect(mocked(deliveredRevenueByDay).mock.calls[0][3]).toEqual({ customerRepId: 10, deliveryAgentId: undefined });
    });

    it('scopes trends for delivery_agent', async () => {
      const result = await analyticsService.getSalesTrends({ period: 'daily' }, 20, 'delivery_agent');
      expect(result).toEqual([]);
      expect((prismaMock.order.findMany as any).mock.calls[0][0].where.deliveryAgentId).toBe(20);
      expect(mocked(deliveredRevenueByDay).mock.calls[0][3]).toEqual({ customerRepId: undefined, deliveryAgentId: 20 });
    });

    it('returns trends without userId (no filter)', async () => {
      const result = await analyticsService.getSalesTrends({ period: 'daily' });
      expect(result).toEqual([]);
      expect((prismaMock.order.findMany as any).mock.calls[0][0].where.customerRepId).toBeUndefined();
    });

    it('groups by month when period is monthly', async () => {
      (prismaMock.order.findMany as any).mockResolvedValue([{ createdAt: new Date('2024-03-05T10:00:00Z') }]);
      const result = await analyticsService.getSalesTrends({ period: 'monthly', startDate: '2024-03-01', endDate: '2024-03-31' });
      expect(result).toEqual([{ date: '2024-03', orders: 1, revenue: '0.00', delivered: 0 }]);
    });

    it('uses the last `days` days when no range is given', async () => {
      await analyticsService.getSalesTrends({ days: 7 });
      const createdAt = (prismaMock.order.findMany as any).mock.calls[0][0].where.createdAt;
      const days = (createdAt.lt.getTime() - createdAt.gte.getTime()) / 86400000;
      expect(days).toBeGreaterThan(7);
      expect(days).toBeLessThan(8.01);
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
    const setupRepMocks = () => {
      (prismaMock.user.findMany as any).mockResolvedValue([{ id: 1, firstName: 'Kwame', lastName: 'Rep' }] as any);
      mocked(repRates).mockResolvedValue(repRatesResult({ 1: { placed: 4, confirmed: 3, confirmationRate: 75, deliveredFromConfirmedRate: 50 } }));
      mocked(deliveredRevenueByRep).mockResolvedValue(repRevenueResult({ 1: { revenue: '300.00', deliveredOrders: 1 } }));
      (prismaMock.order.groupBy as any).mockResolvedValue([]);
    };

    it('applies custom date range to rep performance', async () => {
      setupRepMocks();
      const result = await analyticsService.getRepPerformance(
        { startDate: '2024-01-01', endDate: '2024-01-31' }
      );
      expect(result[0].confirmationRate).toBe(75);
      expect(mocked(repRates).mock.calls[0][1]).toEqual(new Date('2024-01-01T00:00:00.000Z'));
      expect(mocked(repRates).mock.calls[0][2]).toEqual(new Date('2024-02-01T00:00:00.000Z'));
    });

    it('scopes rep performance for specific user (sales_rep)', async () => {
      setupRepMocks();
      await analyticsService.getRepPerformance(undefined, 1, 'sales_rep');
      expect((prismaMock.user.findMany as any).mock.calls[0][0].where).toMatchObject({ role: 'sales_rep', id: 1 });
    });

    it('returns MTD performance with no filters', async () => {
      setupRepMocks();
      const result = await analyticsService.getRepPerformance();
      expect(result).toHaveLength(1);
      expect(mocked(repRates).mock.calls[0][1].getUTCDate()).toBe(1);
    });

    it('applies only startDate filter', async () => {
      setupRepMocks();
      await analyticsService.getRepPerformance({ startDate: '2024-01-01' });
      expect(mocked(repRates).mock.calls[0][1]).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    });

    it('applies only endDate filter', async () => {
      setupRepMocks();
      await analyticsService.getRepPerformance({ endDate: '2024-12-31' });
      expect(mocked(repRates).mock.calls[0][2]).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    });
  });

  // ───────────────────────────── getAgentPerformance - with date filters ─────────────────────────────
  describe('getAgentPerformance - date filtering', () => {
    beforeEach(() => {
      (prismaMock.user.findMany as any).mockResolvedValue([]);
      (prismaMock.order.groupBy as any).mockResolvedValue([]);
      mocked(partnerRates).mockResolvedValue([]);
    });

    it('applies date filters to agent performance', async () => {
      const result = await analyticsService.getAgentPerformance({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });
      expect(result).toEqual([]);
      expect(mocked(partnerRates).mock.calls[0][1]).toEqual(new Date('2024-01-01T00:00:00.000Z'));
      expect(mocked(partnerRates).mock.calls[0][2]).toEqual(new Date('2024-02-01T00:00:00.000Z'));
    });

    it('returns performance without date filters', async () => {
      const result = await analyticsService.getAgentPerformance();
      expect(result).toEqual([]);
      expect(mocked(partnerRates).mock.calls[0][1].getUTCDate()).toBe(1);
    });
  });

  // ───────────────────────────── getProductPerformance - date filters ─────────────────────────────
  describe('getProductPerformance', () => {
    beforeEach(() => {
      mocked(productDeliveredUnits).mockResolvedValue({ units: {} as any, lineRevenue: {} as any, byProduct: [] });
      (prismaMock.product.findMany as any).mockResolvedValue([]);
    });

    it('returns product performance with both date filters', async () => {
      const result = await analyticsService.getProductPerformance({ startDate: '2024-01-01', endDate: '2024-01-31' });
      expect(result).toEqual([]);
      const [, , from, to] = mocked(productDeliveredUnits).mock.calls[0];
      expect([from, to]).toEqual([new Date('2024-01-01T00:00:00.000Z'), new Date('2024-02-01T00:00:00.000Z')]);
    });

    it('asks the KPI layer for the tenant', async () => {
      await analyticsService.getProductPerformance();
      expect(mocked(productDeliveredUnits).mock.calls[0][0]).toBe('tenant-test');
    });

    it('returns product performance with only startDate', async () => {
      await analyticsService.getProductPerformance({ startDate: '2024-01-01' });
      expect(mocked(productDeliveredUnits).mock.calls[0][2]).toEqual(new Date('2024-01-01T00:00:00.000Z'));
    });

    it('returns product performance with only endDate', async () => {
      await analyticsService.getProductPerformance({ endDate: '2024-12-31' });
      expect(mocked(productDeliveredUnits).mock.calls[0][3]).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    });

    it('returns product performance without date filter (month to date)', async () => {
      await analyticsService.getProductPerformance();
      expect(mocked(productDeliveredUnits).mock.calls[0][2].getUTCDate()).toBe(1);
    });
  });

  // ───────────────────────────── getAreaDistribution - date filters ─────────────────────────────
  describe('getAreaDistribution', () => {
    beforeEach(() => {
      mocked(deliveredRevenueByArea).mockResolvedValue([{ area: 'Accra', revenue: '6000.00', deliveredOrders: 30 }]);
    });

    it('returns area distribution with date filter', async () => {
      const result = await analyticsService.getAreaDistribution({ startDate: '2024-01-01', endDate: '2024-01-31' });
      expect(result).toEqual([{ area: 'Accra', orderCount: 30, revenue: '6000.00' }]);
      expect(mocked(deliveredRevenueByArea).mock.calls[0][2]).toEqual(new Date('2024-02-01T00:00:00.000Z'));
    });

    it('returns area distribution without date filter', async () => {
      const result = await analyticsService.getAreaDistribution();
      expect(result).toHaveLength(1);
    });
  });
});
