import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Automock the KPI functions; revenueScope is a pure mapping the callers use as is.
jest.mock('../../services/kpi/revenue', () => ({
  ...jest.createMockFromModule<object>('../../services/kpi/revenue'),
  revenueScope: jest.requireActual<typeof import('../../services/kpi/revenue')>('../../services/kpi/revenue').revenueScope,
}));
jest.mock('../../services/kpi/rates', () => ({ ...jest.requireActual<object>('../../services/kpi/rates'), rates: jest.fn() }));
jest.mock('../../services/kpi/reps');
jest.mock('../../services/kpi/partners');
jest.mock('../../services/kpi/products');

import { prismaMock } from '../mocks/prisma.mock';
import { useTestTenant, TEST_TENANT_ID } from '../mocks/tenant.mock';
import { partnerRow, ratesResult, repRatesResult, repRevenueResult, revenueResult } from '../mocks/kpiResults';
import { AnalyticsService } from '../../services/analyticsService';
import { deliveredRevenue, deliveredRevenueByArea, deliveredRevenueByDay, deliveredRevenueByRep } from '../../services/kpi/revenue';
import { rates } from '../../services/kpi/rates';
import { repRates } from '../../services/kpi/reps';
import { partnerRates } from '../../services/kpi/partners';
import { productDeliveredUnits } from '../../services/kpi/products';
import * as Money from '../../utils/money';

const mocked = <T extends (...args: any[]) => any>(fn: T) => fn as unknown as jest.MockedFunction<T>;

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  useTestTenant();

  beforeEach(() => {
    analyticsService = new AnalyticsService();
  });

  describe('getDashboardMetrics', () => {
    it('reads revenue, delivered orders and the three rates from the KPI layer', async () => {
      prismaMock.order.count
        .mockResolvedValueOnce(100) // totalOrders
        .mockResolvedValueOnce(10) // todayOrders
        .mockResolvedValueOnce(30); // pendingOrders
      mocked(deliveredRevenue)
        .mockResolvedValueOnce(revenueResult('92000.00', 376)) // range
        .mockResolvedValueOnce(revenueResult('500.00', 2)); // today
      mocked(rates).mockResolvedValue(ratesResult(71, 48, 34.2));
      prismaMock.user.count.mockResolvedValue(5); // activeAgents

      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      prismaMock.delivery.findMany.mockResolvedValue([
        { scheduledTime: twoHoursAgo, actualDeliveryTime: now }
      ] as any);

      const metrics = await analyticsService.getDashboardMetrics({ startDate: '2026-10-01', endDate: '2026-10-17' });

      expect(metrics.totalOrders).toBe(100);
      expect(metrics.todayOrders).toBe(10);
      expect(metrics.pendingOrders).toBe(30);
      expect(metrics.deliveredOrders).toBe(376);
      expect(metrics.totalRevenue).toBe('92000.00');
      expect(metrics.todayRevenue).toBe('500.00');
      expect(metrics.activeAgents).toBe(5);
      expect(metrics.confirmationRate).toBe(71);
      expect(metrics.deliverySuccessRate).toBe(48);
      expect(metrics.orderToCashYield).toBe(34.2);
      expect(metrics.avgDeliveryTime).toBeGreaterThan(0);
      expect(metrics).not.toHaveProperty('deliveryRate');
    });

    it('passes the store-zone range [1 Oct, end of 17 Oct) to the KPI layer', async () => {
      prismaMock.order.count.mockResolvedValue(0);
      mocked(deliveredRevenue).mockResolvedValue(revenueResult('0.00'));
      mocked(rates).mockResolvedValue(ratesResult(null, null, null));
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.delivery.findMany.mockResolvedValue([] as any);

      await analyticsService.getDashboardMetrics({ startDate: '2026-10-01', endDate: '2026-10-17' });

      const [tenantId, from, to] = mocked(deliveredRevenue).mock.calls[0];
      expect(tenantId).toBe(TEST_TENANT_ID);
      expect(from).toEqual(new Date('2026-10-01T00:00:00.000Z')); // Accra is UTC+0
      expect(to).toEqual(new Date('2026-10-18T00:00:00.000Z'));
      expect(mocked(rates).mock.calls[0].slice(1, 3)).toEqual([from, to]);
    });

    it('handles zero orders: null rates, zero revenue', async () => {
      prismaMock.order.count.mockResolvedValue(0);
      mocked(deliveredRevenue).mockResolvedValue(revenueResult('0.00', 0));
      mocked(rates).mockResolvedValue(ratesResult(null, null, null));
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.delivery.findMany.mockResolvedValue([] as any);

      const metrics = await analyticsService.getDashboardMetrics();

      expect(metrics.totalOrders).toBe(0);
      expect(metrics.totalRevenue).toBe('0.00');
      expect(metrics.deliverySuccessRate).toBeNull();
      expect(metrics.avgDeliveryTime).toBe(0);
    });
  });

  describe('getSalesTrends', () => {
    it('counts orders by placement day and revenue by delivery day', async () => {
      prismaMock.order.findMany.mockResolvedValue([
        { createdAt: new Date('2024-01-01T10:00:00Z') },
        { createdAt: new Date('2024-01-01T11:00:00Z') },
        { createdAt: new Date('2024-01-02T09:00:00Z') },
      ] as any);
      mocked(deliveredRevenueByDay).mockResolvedValue([
        { date: '2024-01-01', revenue: '300.00', deliveredOrders: 2 },
        { date: '2024-01-03', revenue: '150.00', deliveredOrders: 1 },
      ]);

      const trends = await analyticsService.getSalesTrends({ period: 'daily', startDate: '2024-01-01', endDate: '2024-01-07' });

      expect(trends).toEqual([
        { date: '2024-01-01', orders: 2, revenue: '300.00', delivered: 2 },
        { date: '2024-01-02', orders: 1, revenue: '0.00', delivered: 0 },
        { date: '2024-01-03', orders: 0, revenue: '150.00', delivered: 1 },
      ]);
      expect(trends[0]).not.toHaveProperty('conversionRate');
    });

    it('groups by month', async () => {
      prismaMock.order.findMany.mockResolvedValue([
        { createdAt: new Date('2024-01-15T10:00:00Z') },
        { createdAt: new Date('2024-01-20T10:00:00Z') },
        { createdAt: new Date('2024-02-05T10:00:00Z') },
      ] as any);
      mocked(deliveredRevenueByDay).mockResolvedValue([
        { date: '2024-01-15', revenue: '100.00', deliveredOrders: 1 },
        { date: '2024-01-20', revenue: '200.00', deliveredOrders: 1 },
        { date: '2024-02-05', revenue: '150.00', deliveredOrders: 1 },
      ]);

      const trends = await analyticsService.getSalesTrends({ period: 'monthly', startDate: '2024-01-01', endDate: '2024-02-29' });

      const jan = trends.find((t) => t.date === '2024-01');
      const feb = trends.find((t) => t.date === '2024-02');
      expect(jan).toEqual({ date: '2024-01', orders: 2, revenue: '300.00', delivered: 2 });
      expect(feb).toEqual({ date: '2024-02', orders: 1, revenue: '150.00', delivered: 1 });
    });

    it('bins an order placed at 23:30 UTC on the store day (UTC+0) it belongs to', async () => {
      prismaMock.order.findMany.mockResolvedValue([{ createdAt: new Date('2024-01-01T23:30:00Z') }] as any);
      mocked(deliveredRevenueByDay).mockResolvedValue([]);

      const trends = await analyticsService.getSalesTrends({ startDate: '2024-01-01', endDate: '2024-01-02' });

      expect(trends).toEqual([{ date: '2024-01-01', orders: 1, revenue: '0.00', delivered: 0 }]);
    });
  });

  describe('getRepPerformance', () => {
    it('reads the two rep rates and delivered revenue from the KPI layer', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 7, firstName: 'John', lastName: 'Doe' }] as any);
      mocked(repRates).mockResolvedValue(repRatesResult({
        7: { placed: 871, confirmed: 640, confirmationRate: 73.5, deliveredFromConfirmedRate: 52.1 },
      }));
      mocked(deliveredRevenueByRep).mockResolvedValue(repRevenueResult({ 7: { revenue: '45000.00', deliveredOrders: 180 } }));
      prismaMock.order.groupBy
        .mockResolvedValueOnce([{ customerRepId: 7, _count: { _all: 4 } }] as any) // pending (all time)
        .mockResolvedValueOnce([{ customerRepId: 7, _count: { _all: 2 } }] as any); // unpaid delivered (all time)

      const performance = await analyticsService.getRepPerformance({ startDate: '2026-10-01', endDate: '2026-10-17' });

      expect(performance).toEqual([{
        userId: 7,
        userName: 'John Doe',
        totalAssigned: 871,
        completed: 180,
        pending: 4,
        unpaidDeliveredOrders: 2,
        confirmationRate: 73.5,
        revenue: '45000.00',
      }]);
      expect(performance[0]).not.toHaveProperty('deliveredFromConfirmedRate');
      expect(mocked(deliveredRevenueByRep).mock.calls[0].slice(1, 3)).toEqual([new Date('2026-10-01T00:00:00.000Z'), new Date('2026-10-18T00:00:00.000Z')]);
    });

    it('gives a rep with no orders null rates and zero counts', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 8, firstName: 'Jane', lastName: 'Doe' }] as any);
      mocked(repRates).mockResolvedValue(repRatesResult({}));
      mocked(deliveredRevenueByRep).mockResolvedValue(repRevenueResult({}));
      prismaMock.order.groupBy.mockResolvedValue([] as any);

      const [row] = await analyticsService.getRepPerformance();

      expect(row.totalAssigned).toBe(0);
      expect(row.completed).toBe(0);
      expect(row.revenue).toBe('0.00');
      expect(row.confirmationRate).toBeNull();
    });
  });

  describe('getAgentPerformance', () => {
    it('reads the partner delivery success rate from the KPI layer', async () => {
      prismaMock.user.findMany.mockResolvedValue([{
        id: 3,
        firstName: 'Agent',
        lastName: 'One',
        deliveries: [
          { scheduledTime: new Date('2024-01-01T10:00:00'), actualDeliveryTime: new Date('2024-01-01T09:50:00') },
          { scheduledTime: new Date('2024-01-01T11:00:00'), actualDeliveryTime: new Date('2024-01-01T11:30:00') },
        ],
      }] as any);
      mocked(partnerRates).mockResolvedValue([partnerRow(3, 10, 6, 2, 1, 66.7)]);
      prismaMock.order.groupBy.mockResolvedValue([
        { deliveryAgentId: 3, status: 'delivered', _count: { _all: 6 } },
        { deliveryAgentId: 3, status: 'out_for_delivery', _count: { _all: 1 } },
        { deliveryAgentId: 3, status: 'ready_for_pickup', _count: { _all: 1 } },
        { deliveryAgentId: 4, status: 'out_for_delivery', _count: { _all: 9 } },
      ] as any);

      const [row] = await analyticsService.getAgentPerformance();

      expect(row).toMatchObject({
        userId: 3,
        userName: 'Agent One',
        totalAssigned: 10,
        completed: 6,
        failed: 3,
        active: 2,
        pending: 2,
        deliverySuccessRate: 66.7,
        onTimeRate: 50,
        totalDeliveries: 2,
      });
      expect(row).not.toHaveProperty('successRate');
    });

    it('gives an agent with no orders in the range a null rate', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 5, firstName: 'New', lastName: 'Agent', deliveries: [] }] as any);
      mocked(partnerRates).mockResolvedValue([]);
      prismaMock.order.groupBy.mockResolvedValue([] as any);

      const [row] = await analyticsService.getAgentPerformance();

      expect(row.totalAssigned).toBe(0);
      expect(row.deliverySuccessRate).toBeNull();
    });

    it('shows a delivery agent only their own row', async () => {
      prismaMock.user.findMany.mockResolvedValue([] as any);
      mocked(partnerRates).mockResolvedValue([]);
      prismaMock.order.groupBy.mockResolvedValue([] as any);

      await analyticsService.getAgentPerformance(undefined, 3, 'delivery_agent');

      expect((prismaMock.user.findMany as any).mock.calls[0][0].where).toMatchObject({ role: 'delivery_agent', id: 3 });
      expect((prismaMock.order.groupBy as any).mock.calls[0][0].where.deliveryAgentId).toBe(3);
    });
  });

  describe('getCustomerInsights', () => {
    it('has no activeCustomers; average order value is KPI revenue over KPI delivered orders', async () => {
      prismaMock.customer.count.mockResolvedValue(100);
      prismaMock.customer.findMany.mockResolvedValue([
        { id: 'c1', firstName: 'Alice', lastName: 'Smith', phoneNumber: '+1111111111', totalOrders: 10, totalSpent: 1000 },
        { id: 'c2', firstName: 'Bob', lastName: 'Jones', phoneNumber: '+2222222222', totalOrders: 8, totalSpent: 800 },
      ] as any);
      prismaMock.customer.groupBy.mockResolvedValue([
        { area: 'New York', _count: { area: 50 } },
        { area: 'Los Angeles', _count: { area: 30 } }
      ] as any);
      mocked(deliveredRevenue).mockResolvedValue(revenueResult('3000.00', 20));

      const insights = await analyticsService.getCustomerInsights();

      expect(insights.totalCustomers).toBe(100);
      expect(insights).not.toHaveProperty('activeCustomers');
      expect(insights.topCustomers).toHaveLength(2);
      expect(insights.customersByArea).toHaveLength(2);
      expect(Money.toApi(insights.avgOrderValue)).toBe('150.00');
    });

    it('gives an average order value of 0.00 when nothing was delivered', async () => {
      prismaMock.customer.count.mockResolvedValue(0);
      prismaMock.customer.findMany.mockResolvedValue([] as any);
      prismaMock.customer.groupBy.mockResolvedValue([] as any);
      mocked(deliveredRevenue).mockResolvedValue(revenueResult('0.00', 0));

      const insights = await analyticsService.getCustomerInsights();

      expect(Money.toApi(insights.avgOrderValue)).toBe('0.00');
    });
  });

  describe('getProductPerformance', () => {
    it('reads units and line revenue from the KPI layer, sorted by revenue', async () => {
      mocked(productDeliveredUnits).mockResolvedValue({
        units: {} as any,
        lineRevenue: {} as any,
        byProduct: [
          { productId: 1, sku: 'SKU-001', name: 'Product A', units: 50, lineRevenue: '5000.00' },
          { productId: 2, sku: 'SKU-002', name: 'Product B', units: 90, lineRevenue: '9000.00' },
        ],
      });
      prismaMock.product.findMany.mockResolvedValue([
        { id: 1, category: 'Electronics' },
        { id: 2, category: 'Accessories' },
      ] as any);

      const performance = await analyticsService.getProductPerformance({ startDate: '2026-10-01', endDate: '2026-10-17' });

      expect(performance).toEqual([
        { productId: 2, productName: 'Product B', sku: 'SKU-002', category: 'Accessories', unitsSold: 90, revenue: '9000.00' },
        { productId: 1, productName: 'Product A', sku: 'SKU-001', category: 'Electronics', unitsSold: 50, revenue: '5000.00' },
      ]);
      expect(mocked(productDeliveredUnits).mock.calls[0].slice(0, 2)).toEqual([TEST_TENANT_ID, 'all']);
    });

    it('handles products with no sales', async () => {
      mocked(productDeliveredUnits).mockResolvedValue({ units: {} as any, lineRevenue: {} as any, byProduct: [] });
      prismaMock.product.findMany.mockResolvedValue([]);

      expect(await analyticsService.getProductPerformance()).toHaveLength(0);
    });
  });

  describe('getAreaDistribution', () => {
    it('reads delivered revenue by area from the KPI layer', async () => {
      mocked(deliveredRevenueByArea).mockResolvedValue([
        { area: 'Manhattan', revenue: '10000.00', deliveredOrders: 50 },
        { area: 'Brooklyn', revenue: '6000.00', deliveredOrders: 30 },
      ]);

      const distribution = await analyticsService.getAreaDistribution();

      expect(distribution).toEqual([
        { area: 'Manhattan', orderCount: 50, revenue: '10000.00' },
        { area: 'Brooklyn', orderCount: 30, revenue: '6000.00' },
      ]);
    });

    it('keeps the top 20 areas', async () => {
      mocked(deliveredRevenueByArea).mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({ area: `A${i}`, revenue: '1.00', deliveredOrders: 1 })),
      );

      expect(await analyticsService.getAreaDistribution()).toHaveLength(20);
    });
  });

  describe('getRealTimeStats', () => {
    it('should calculate real-time statistics', async () => {
      prismaMock.order.count
        .mockResolvedValueOnce(5) // ordersLastHour
        .mockResolvedValueOnce(3); // deliveriesInProgress

      prismaMock.order.aggregate.mockResolvedValue({
        _avg: { totalAmount: 175 }
      } as any);

      const stats = await analyticsService.getRealTimeStats();

      expect(stats.ordersLastHour).toBe(5);
      expect(stats.deliveriesInProgress).toBe(3);
      expect(Money.toApi(stats.avgOrderValue)).toBe('175.00');
      expect(stats.timestamp).toBeDefined();
    });
  });
});
