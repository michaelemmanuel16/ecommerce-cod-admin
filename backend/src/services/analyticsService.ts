import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';

interface DateFilters {
  startDate?: Date;
  endDate?: Date;
}

export class AnalyticsService {
  /**
   * Get dashboard metrics
   */
  async getDashboardMetrics() {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const [
      totalOrders,
      todayOrders,
      pendingOrders,
      deliveredOrders,
      totalRevenue,
      todayRevenue,
      activeAgents,
      deliveries
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({
        where: {
          createdAt: {
            gte: startOfDay,
            lte: endOfDay
          }
        }
      }),
      prisma.order.count({
        where: {
          status: {
            notIn: ['delivered', 'cancelled', 'returned']
          }
        }
      }),
      prisma.order.count({
        where: { status: 'delivered' }
      }),
      prisma.order.aggregate({
        where: { status: 'delivered' },
        _sum: { totalAmount: true }
      }),
      prisma.order.aggregate({
        where: {
          status: 'delivered',
          createdAt: {
            gte: startOfDay,
            lte: endOfDay
          }
        },
        _sum: { totalAmount: true }
      }),
      prisma.user.count({
        where: {
          role: 'delivery_agent',
          isActive: true,
          isAvailable: true
        }
      }),
      prisma.delivery.findMany({
        where: {
          actualDeliveryTime: { not: null },
          scheduledTime: { not: null }
        },
        select: {
          scheduledTime: true,
          actualDeliveryTime: true
        }
      })
    ]);

    // Calculate average delivery time
    let totalDeliveryTime = 0;
    let deliveryCount = 0;

    deliveries.forEach((d) => {
      if (d.scheduledTime && d.actualDeliveryTime) {
        const diff = d.actualDeliveryTime.getTime() - d.scheduledTime.getTime();
        totalDeliveryTime += diff;
        deliveryCount++;
      }
    });

    const avgTime =
      deliveryCount > 0
        ? Math.round(totalDeliveryTime / deliveryCount / (1000 * 60 * 60)) // Convert to hours
        : 0;

    const metrics = {
      totalOrders,
      todayOrders,
      pendingOrders,
      deliveredOrders,
      totalRevenue: totalRevenue._sum.totalAmount || 0,
      todayRevenue: todayRevenue._sum.totalAmount || 0,
      activeAgents,
      avgDeliveryTime: avgTime,
      deliveryRate: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0
    };

    return metrics;
  }

  /**
   * Get sales trends over time
   */
  async getSalesTrends(filters: { period?: string; days?: number }) {
    const { period = 'daily', days = 30 } = filters;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate
        }
      },
      select: {
        createdAt: true,
        totalAmount: true,
        status: true
      }
    });

    const trends: Record<string, { orders: number; revenue: number; delivered: number }> = {};

    orders.forEach((order) => {
      const key =
        period === 'daily'
          ? order.createdAt.toISOString().split('T')[0]
          : `${order.createdAt.getFullYear()}-${String(order.createdAt.getMonth() + 1).padStart(2, '0')}`;

      if (!trends[key]) {
        trends[key] = { orders: 0, revenue: 0, delivered: 0 };
      }

      trends[key].orders += 1;
      trends[key].revenue += order.totalAmount;
      if (order.status === 'delivered') {
        trends[key].delivered += 1;
      }
    });

    const data = Object.entries(trends).map(([date, stats]) => ({
      date,
      orders: stats.orders,
      revenue: stats.revenue,
      delivered: stats.delivered,
      conversionRate: stats.orders > 0 ? (stats.delivered / stats.orders) * 100 : 0
    }));

    return data;
  }

  /**
   * Get conversion funnel
   */
  async getConversionFunnel(filters: DateFilters) {
    const { startDate, endDate } = filters;

    const where: Prisma.OrderWhereInput = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const statusCounts = await prisma.order.groupBy({
      by: ['status'],
      where,
      _count: true
    });

    const funnel = statusCounts.map((s) => ({
      status: s.status,
      count: s._count
    }));

    return funnel;
  }

  /**
   * Get customer representative performance
   */
  async getRepPerformance() {
    const reps = await prisma.user.findMany({
      where: {
        role: 'sales_rep',
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedOrdersAsRep: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });

    const performance = reps.map((rep) => {
      const total = rep.assignedOrdersAsRep.length;
      const completed = rep.assignedOrdersAsRep.filter((o) => o.status === 'delivered').length;
      const revenue = rep.assignedOrdersAsRep
        .filter((o) => o.status === 'delivered')
        .reduce((sum, o) => sum + o.totalAmount, 0);

      // Calculate average response time
      let totalResponseTime = 0;
      rep.assignedOrdersAsRep.forEach((o) => {
        const diff = o.updatedAt.getTime() - o.createdAt.getTime();
        totalResponseTime += diff;
      });

      const avgResponseTime =
        total > 0
          ? Math.round(totalResponseTime / total / (1000 * 60)) // Convert to minutes
          : 0;

      return {
        userId: rep.id,
        userName: `${rep.firstName} ${rep.lastName}`,
        totalAssigned: total,
        completed,
        pending: total - completed,
        successRate: total > 0 ? (completed / total) * 100 : 0,
        revenue,
        avgResponseTime
      };
    });

    return performance;
  }

  /**
   * Get delivery agent performance
   */
  async getAgentPerformance() {
    const agents = await prisma.user.findMany({
      where: {
        role: 'delivery_agent',
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedOrdersAsAgent: {
          select: {
            id: true,
            status: true,
            totalAmount: true
          }
        },
        deliveries: {
          select: {
            scheduledTime: true,
            actualDeliveryTime: true
          }
        }
      }
    });

    const performance = agents.map((agent) => {
      const total = agent.assignedOrdersAsAgent.length;
      const delivered = agent.assignedOrdersAsAgent.filter((o) => o.status === 'delivered').length;
      const failed = agent.assignedOrdersAsAgent.filter((o) =>
        ['cancelled', 'returned', 'failed_delivery'].includes(o.status)
      ).length;

      // Calculate on-time delivery rate
      let onTimeDeliveries = 0;
      agent.deliveries.forEach((d) => {
        if (d.scheduledTime && d.actualDeliveryTime && d.actualDeliveryTime <= d.scheduledTime) {
          onTimeDeliveries++;
        }
      });

      const onTimeRate =
        agent.deliveries.length > 0 ? (onTimeDeliveries / agent.deliveries.length) * 100 : 0;

      return {
        userId: agent.id,
        userName: `${agent.firstName} ${agent.lastName}`,
        totalAssigned: total,
        completed: delivered,
        pending: total - delivered - failed,
        failed,
        successRate: total > 0 ? (delivered / total) * 100 : 0,
        onTimeRate,
        totalDeliveries: agent.deliveries.length
      };
    });

    return performance;
  }

  /**
   * Get customer insights
   */
  async getCustomerInsights() {
    const [totalCustomers, activeCustomers, topCustomers, avgOrderValue] =
      await Promise.all([
        prisma.customer.count(),
        prisma.customer.count({
          where: { isActive: true }
        }),
        prisma.customer.findMany({
          where: { isActive: true },
          orderBy: { totalSpent: 'desc' },
          take: 10,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            totalOrders: true,
            totalSpent: true
          }
        }),
        prisma.order.aggregate({
          _avg: { totalAmount: true }
        })
      ]);

    const insights = {
      totalCustomers,
      activeCustomers,
      topCustomers,
      avgOrderValue: avgOrderValue._avg.totalAmount || 0
    };

    return insights;
  }

  /**
   * Get product performance analytics
   */
  async getProductPerformance(filters?: DateFilters) {
    const where: Prisma.OrderItemWhereInput = {};

    if (filters?.startDate || filters?.endDate) {
      where.order = {
        createdAt: {}
      } as any;
      if (filters.startDate) (where.order as any).createdAt.gte = filters.startDate;
      if (filters.endDate) (where.order as any).createdAt.lte = filters.endDate;
    }

    const productSales = await prisma.orderItem.groupBy({
      by: ['productId'],
      where,
      _sum: {
        quantity: true,
        totalPrice: true
      },
      _count: true
    });

    // Get product details
    const productIds = productSales.map((ps) => ps.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        category: true
      }
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    const performance = productSales
      .map((ps) => {
        const product = productMap.get(ps.productId);
        return {
          productId: ps.productId,
          productName: product?.name || 'Unknown',
          sku: product?.sku || '',
          category: product?.category || '',
          unitsSold: ps._sum.quantity || 0,
          revenue: ps._sum.totalPrice || 0,
          orderCount: ps._count
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return performance;
  }

  /**
   * Get area-wise order distribution
   */
  async getAreaDistribution(filters?: DateFilters) {
    const where: Prisma.OrderWhereInput = {};

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const areaStats = await prisma.order.groupBy({
      by: ['deliveryArea'],
      where,
      _count: true,
      _sum: {
        totalAmount: true
      },
      orderBy: {
        _count: {
          deliveryArea: 'desc'
        }
      },
      take: 20
    });

    return areaStats.map((stat) => ({
      area: stat.deliveryArea,
      orderCount: stat._count,
      revenue: stat._sum.totalAmount || 0
    }));
  }

  /**
   * Get time-series data for charts
   */
  async getTimeSeriesData(metric: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate
        }
      },
      select: {
        createdAt: true,
        totalAmount: true,
        status: true
      }
    });

    const series: Record<string, number> = {};

    orders.forEach((order) => {
      const dateKey = order.createdAt.toISOString().split('T')[0];

      if (!series[dateKey]) {
        series[dateKey] = 0;
      }

      switch (metric) {
        case 'orders':
          series[dateKey] += 1;
          break;
        case 'revenue':
          if (order.status === 'delivered') {
            series[dateKey] += order.totalAmount;
          }
          break;
        case 'delivered':
          if (order.status === 'delivered') {
            series[dateKey] += 1;
          }
          break;
      }
    });

    return Object.entries(series).map(([date, value]) => ({
      date,
      value
    }));
  }

  /**
   * Get real-time statistics
   */
  async getRealTimeStats() {
    const now = new Date();
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const [ordersLastHour, deliveriesInProgress, avgOrderValue] = await Promise.all([
      prisma.order.count({
        where: {
          createdAt: {
            gte: lastHour
          }
        }
      }),
      prisma.order.count({
        where: {
          status: 'out_for_delivery'
        }
      }),
      prisma.order.aggregate({
        where: {
          createdAt: {
            gte: lastHour
          }
        },
        _avg: {
          totalAmount: true
        }
      })
    ]);

    return {
      ordersLastHour,
      deliveriesInProgress,
      avgOrderValue: avgOrderValue._avg.totalAmount || 0,
      timestamp: now
    };
  }
}

export default new AnalyticsService();
