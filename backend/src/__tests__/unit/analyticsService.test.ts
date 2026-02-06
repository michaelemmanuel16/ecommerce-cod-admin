import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { AnalyticsService } from '../../services/analyticsService';

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    analyticsService = new AnalyticsService();
  });

  describe('getDashboardMetrics', () => {
    it('should calculate dashboard metrics correctly', async () => {
      prismaMock.order.count
        .mockResolvedValueOnce(100) // totalOrders
        .mockResolvedValueOnce(10) // todayOrders
        .mockResolvedValueOnce(30) // pendingOrders
        .mockResolvedValueOnce(60); // deliveredOrders

      prismaMock.order.aggregate
        .mockResolvedValueOnce({ _sum: { totalAmount: 10000 } } as any) // totalRevenue
        .mockResolvedValueOnce({ _sum: { totalAmount: 500 } } as any); // todayRevenue

      prismaMock.user.count.mockResolvedValue(5); // activeAgents

      // Mock delivery findMany for average delivery time calculation
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      prismaMock.delivery.findMany.mockResolvedValue([
        { scheduledTime: twoHoursAgo, actualDeliveryTime: now }
      ] as any);

      const metrics = await analyticsService.getDashboardMetrics();

      expect(metrics.totalOrders).toBe(100);
      expect(metrics.todayOrders).toBe(10);
      expect(metrics.pendingOrders).toBe(30);
      expect(metrics.deliveredOrders).toBe(60);
      expect(metrics.totalRevenue).toBe(10000);
      expect(metrics.todayRevenue).toBe(500);
      expect(metrics.activeAgents).toBe(5);
      expect(metrics.deliveryRate).toBe(60); // 60/100 * 100
      expect(metrics.avgDeliveryTime).toBeGreaterThan(0);
    });

    it('should handle zero orders gracefully', async () => {
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.aggregate.mockResolvedValue({ _sum: { totalAmount: null } } as any);
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.delivery.findMany.mockResolvedValue([] as any);

      const metrics = await analyticsService.getDashboardMetrics();

      expect(metrics.totalOrders).toBe(0);
      expect(metrics.totalRevenue).toBe(0);
      expect(metrics.deliveryRate).toBe(0);
      expect(metrics.avgDeliveryTime).toBe(0);
    });
  });

  describe('getSalesTrends', () => {
    it('should group sales data by day', async () => {
      const mockOrders = [
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 100,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 200,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-01-02'),
          totalAmount: 150,
          status: 'pending_confirmation'
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

      const trends = await analyticsService.getSalesTrends({ period: 'daily', days: 7 });

      expect(trends).toBeDefined();
      expect(trends.length).toBeGreaterThan(0);

      const jan1Data = trends.find((t) => t.date === '2024-01-01');
      expect(jan1Data?.orders).toBe(2);
      expect(jan1Data?.revenue).toBe(300);
      expect(jan1Data?.delivered).toBe(2);
    });

    it('should group sales data by month', async () => {
      const mockOrders = [
        {
          createdAt: new Date('2024-01-15'),
          totalAmount: 100,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-01-20'),
          totalAmount: 200,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-02-05'),
          totalAmount: 150,
          status: 'delivered'
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

      const trends = await analyticsService.getSalesTrends({ period: 'monthly', days: 60 });

      expect(trends).toBeDefined();
      const jan2024 = trends.find((t) => t.date === '2024-01');
      const feb2024 = trends.find((t) => t.date === '2024-02');

      expect(jan2024?.orders).toBe(2);
      expect(jan2024?.revenue).toBe(300);
      expect(feb2024?.orders).toBe(1);
      expect(feb2024?.revenue).toBe(150);
    });

    it('should calculate conversion rate correctly', async () => {
      const mockOrders = [
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 100,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 200,
          status: 'pending_confirmation'
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

      const trends = await analyticsService.getSalesTrends({ period: 'daily', days: 7 });

      const jan1Data = trends.find((t) => t.date === '2024-01-01');
      expect(jan1Data?.conversionRate).toBe(50); // 1 delivered out of 2 total
    });
  });

  describe('getRepPerformance', () => {
    it('should calculate rep performance metrics correctly', async () => {
      const mockReps = [
        {
          id: 'rep-1',
          firstName: 'John',
          lastName: 'Doe',
          assignedOrdersAsRep: [
            {
              id: 'order-1',
              status: 'delivered',
              totalAmount: 100,
              createdAt: new Date('2024-01-01T10:00:00'),
              updatedAt: new Date('2024-01-01T10:30:00')
            },
            {
              id: 'order-2',
              status: 'delivered',
              totalAmount: 200,
              createdAt: new Date('2024-01-01T11:00:00'),
              updatedAt: new Date('2024-01-01T11:15:00')
            },
            {
              id: 'order-3',
              status: 'pending_confirmation',
              totalAmount: 150,
              createdAt: new Date('2024-01-01T12:00:00'),
              updatedAt: new Date('2024-01-01T12:00:00')
            }
          ]
        }
      ];

      prismaMock.user.findMany.mockResolvedValue(mockReps as any);
      // Mock the separate pending orders count query
      prismaMock.order.count.mockResolvedValue(1);
      prismaMock.order.aggregate.mockResolvedValue({
        _count: { id: 1 },
        _sum: { totalAmount: 100 }
      } as any);

      const performance = await analyticsService.getRepPerformance();

      expect(performance).toHaveLength(1);
      expect(performance[0].userId).toBe('rep-1');
      expect(performance[0].userName).toBe('John Doe');
      expect(performance[0].totalAssigned).toBe(3);
      expect(performance[0].completed).toBe(2);
      expect(performance[0].pending).toBe(1);
      expect(performance[0].successRate).toBe(66.66666666666666); // 2/3 * 100
      expect(performance[0].revenue).toBe(300);
      expect(performance[0].avgResponseTime).toBeGreaterThan(0);
    });

    it('should handle reps with no orders', async () => {
      const mockReps = [
        {
          id: 'rep-1',
          firstName: 'Jane',
          lastName: 'Doe',
          assignedOrdersAsRep: []
        }
      ];

      prismaMock.user.findMany.mockResolvedValue(mockReps as any);
      // Mock pending and unpaid orders
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: { totalAmount: null }
      } as any);

      const performance = await analyticsService.getRepPerformance();

      expect(performance).toHaveLength(1);
      expect(performance[0].totalAssigned).toBe(0);
      expect(performance[0].completed).toBe(0);
      expect(performance[0].revenue).toBe(0);
      expect(performance[0].successRate).toBe(0);
      expect(performance[0].avgResponseTime).toBe(0);
    });
  });

  describe('getAgentPerformance', () => {
    it('should calculate agent performance metrics correctly', async () => {
      const mockAgents = [
        {
          id: 'agent-1',
          firstName: 'Agent',
          lastName: 'One',
          assignedOrdersAsAgent: [
            { id: 'order-1', status: 'delivered', totalAmount: 100 },
            { id: 'order-2', status: 'delivered', totalAmount: 200 },
            { id: 'order-3', status: 'cancelled', totalAmount: 150 }
          ],
          deliveries: [
            {
              scheduledTime: new Date('2024-01-01T10:00:00'),
              actualDeliveryTime: new Date('2024-01-01T09:50:00')
            },
            {
              scheduledTime: new Date('2024-01-01T11:00:00'),
              actualDeliveryTime: new Date('2024-01-01T11:30:00')
            }
          ]
        }
      ];

      prismaMock.user.findMany.mockResolvedValue(mockAgents as any);

      const performance = await analyticsService.getAgentPerformance();

      expect(performance).toHaveLength(1);
      expect(performance[0].userId).toBe('agent-1');
      expect(performance[0].userName).toBe('Agent One');
      expect(performance[0].totalAssigned).toBe(3);
      expect(performance[0].completed).toBe(2);
      expect(performance[0].failed).toBe(1);
      expect(performance[0].successRate).toBe(66.66666666666666); // 2/3 * 100
      expect(performance[0].onTimeRate).toBe(50); // 1 on-time out of 2
      expect(performance[0].totalDeliveries).toBe(2);
    });
  });

  describe('getCustomerInsights', () => {
    it('should calculate customer insights correctly', async () => {
      prismaMock.customer.count
        .mockResolvedValueOnce(100) // totalCustomers
        .mockResolvedValueOnce(90); // activeCustomers

      prismaMock.customer.findMany.mockResolvedValue([
        {
          id: 'c1',
          firstName: 'Alice',
          lastName: 'Smith',
          phoneNumber: '+1111111111',
          totalOrders: 10,
          totalSpent: 1000
        },
        {
          id: 'c2',
          firstName: 'Bob',
          lastName: 'Jones',
          phoneNumber: '+2222222222',
          totalOrders: 8,
          totalSpent: 800
        }
      ] as any);

      prismaMock.customer.groupBy.mockResolvedValue([
        { area: 'New York', _count: { area: 50 } },
        { area: 'Los Angeles', _count: { area: 30 } }
      ] as any);

      prismaMock.order.aggregate.mockResolvedValue({
        _avg: { totalAmount: 150 }
      } as any);

      const insights = await analyticsService.getCustomerInsights();

      expect(insights.totalCustomers).toBe(100);
      expect(insights.activeCustomers).toBe(90);
      expect(insights.topCustomers).toHaveLength(2);
      expect(insights.topCustomers[0].totalSpent).toBe(1000);
      expect(insights.customersByArea).toHaveLength(2);
      expect(insights.avgOrderValue).toBe(150);
    });
  });

  describe('getProductPerformance', () => {
    it('should calculate product sales performance', async () => {
      const mockProductSales = [
        {
          productId: 'product-1',
          _sum: { quantity: 50, totalPrice: 5000 },
          _count: 25
        },
        {
          productId: 'product-2',
          _sum: { quantity: 30, totalPrice: 3000 },
          _count: 15
        }
      ];

      const mockProducts = [
        {
          id: 'product-1',
          name: 'Product A',
          sku: 'SKU-001',
          price: 100,
          category: 'Electronics'
        },
        {
          id: 'product-2',
          name: 'Product B',
          sku: 'SKU-002',
          price: 100,
          category: 'Accessories'
        }
      ];

      prismaMock.orderItem.groupBy.mockResolvedValue(mockProductSales as any);
      prismaMock.product.findMany.mockResolvedValue(mockProducts as any);

      const performance = await analyticsService.getProductPerformance();

      expect(performance).toHaveLength(2);
      expect(performance[0].productId).toBe('product-1');
      expect(performance[0].productName).toBe('Product A');
      expect(performance[0].unitsSold).toBe(50);
      expect(performance[0].revenue).toBe(5000);
      expect(performance[0].orderCount).toBe(25);

      // Should be sorted by revenue (descending)
      expect(performance[0].revenue).toBeGreaterThan(performance[1].revenue);
    });

    it('should handle products with no sales', async () => {
      prismaMock.orderItem.groupBy.mockResolvedValue([]);
      prismaMock.product.findMany.mockResolvedValue([]);

      const performance = await analyticsService.getProductPerformance();

      expect(performance).toHaveLength(0);
    });
  });

  describe('getAreaDistribution', () => {
    it('should calculate area-wise order distribution', async () => {
      const mockAreaStats = [
        {
          deliveryArea: 'Manhattan',
          _count: 50,
          _sum: { totalAmount: 10000 }
        },
        {
          deliveryArea: 'Brooklyn',
          _count: 30,
          _sum: { totalAmount: 6000 }
        }
      ];

      prismaMock.order.groupBy.mockResolvedValue(mockAreaStats as any);

      const distribution = await analyticsService.getAreaDistribution();

      expect(distribution).toHaveLength(2);
      expect(distribution[0].area).toBe('Manhattan');
      expect(distribution[0].orderCount).toBe(50);
      expect(distribution[0].revenue).toBe(10000);
      expect(distribution[1].area).toBe('Brooklyn');
      expect(distribution[1].orderCount).toBe(30);
      expect(distribution[1].revenue).toBe(6000);
    });
  });

  describe('getTimeSeriesData', () => {
    it('should generate time series for orders metric', async () => {
      const mockOrders = [
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 100,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 200,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-01-02'),
          totalAmount: 150,
          status: 'delivered'
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

      const series = await analyticsService.getTimeSeriesData('orders', 7);

      expect(series).toBeDefined();
      const jan1 = series.find((s) => s.date === '2024-01-01');
      const jan2 = series.find((s) => s.date === '2024-01-02');

      expect(jan1?.value).toBe(2);
      expect(jan2?.value).toBe(1);
    });

    it('should generate time series for revenue metric', async () => {
      const mockOrders = [
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 100,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 200,
          status: 'delivered'
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

      const series = await analyticsService.getTimeSeriesData('revenue', 7);

      const jan1 = series.find((s) => s.date === '2024-01-01');
      expect(jan1?.value).toBe(300);
    });

    it('should only count delivered orders for revenue', async () => {
      const mockOrders = [
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 100,
          status: 'delivered'
        },
        {
          createdAt: new Date('2024-01-01'),
          totalAmount: 200,
          status: 'pending_confirmation'
        }
      ];

      prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

      const series = await analyticsService.getTimeSeriesData('revenue', 7);

      const jan1 = series.find((s) => s.date === '2024-01-01');
      expect(jan1?.value).toBe(100); // Only delivered order counts
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
      expect(stats.avgOrderValue).toBe(175);
      expect(stats.timestamp).toBeDefined();
    });
  });
});
