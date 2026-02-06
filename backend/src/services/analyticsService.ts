import prisma from '../utils/prisma';
import { Prisma } from '@prisma/client';

interface DateFilters {
  startDate?: Date;
  endDate?: Date;
}

/**
 * Helper function to build user-scoped filter for analytics queries
 * Sales reps only see orders assigned to them, admins/managers see all orders
 */
function buildUserScopeFilter(userId?: number, userRole?: string) {
  // Sales reps only see their assigned orders
  if (userRole === 'sales_rep' && userId) {
    return { customerRepId: userId };
  }
  // Delivery agents only see their assigned deliveries
  if (userRole === 'delivery_agent' && userId) {
    return { deliveryAgentId: userId };
  }
  // Admins, managers, and other roles see all data
  return {};
}

/**
 * Wrap Prisma query with timeout to prevent hanging requests
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 15000,
  errorMessage: string = 'Query timeout'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    clearTimeout(timeoutId!);
  }
}

export class AnalyticsService {
  /**
   * Get dashboard metrics
   * Supports optional date range filtering and user-scoped filtering
   */
  async getDashboardMetrics(
    filters?: {
      startDate?: string;
      endDate?: string;
    },
    userId?: number,
    userRole?: string
  ) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] analyticsService.getDashboardMetrics inputs:', { filters, userId, userRole });
    }

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // Calculate start of current month for month-to-date filtering
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Build date filter for queries
    // If custom date range provided, use it; otherwise default to month-to-date
    const dateFilter = filters?.startDate && filters?.endDate
      ? {
        createdAt: {
          gte: new Date(filters.startDate),
          lte: new Date(filters.endDate)
        }
      }
      : {
        createdAt: {
          gte: startOfMonth,
          lte: now
        }
      };

    // Build user scope filter (sales reps only see their assigned orders)
    const userFilter = buildUserScopeFilter(userId, userRole);

    const baseWhere: Prisma.OrderWhereInput = {
      ...dateFilter,
      ...userFilter,
      deletedAt: null
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('[analyticsService.getDashboardMetrics] Date filter:', dateFilter, 'User filter:', userFilter);
    }

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
      prisma.order.count({
        where: baseWhere
      }),
      prisma.order.count({
        where: {
          ...userFilter,
          deletedAt: null,
          createdAt: {
            gte: startOfDay,
            lte: endOfDay
          }
        }
      }),
      prisma.order.count({
        where: {
          ...userFilter,
          deletedAt: null,
          status: 'pending_confirmation'
        }
      }),
      prisma.order.count({
        where: {
          ...baseWhere,
          status: 'delivered'
        }
      }),
      prisma.order.aggregate({
        where: {
          ...baseWhere,
          status: 'delivered'
        },
        _sum: { totalAmount: true }
      }),
      prisma.order.aggregate({
        where: {
          ...userFilter,
          deletedAt: null,
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
      // Fetch recent deliveries for avg time calculation - reduced sample for speed
      prisma.delivery.findMany({
        where: {
          actualDeliveryTime: { not: null },
          scheduledTime: { not: null },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Only last 7 days
        },
        select: {
          scheduledTime: true,
          actualDeliveryTime: true
        },
        orderBy: { actualDeliveryTime: 'desc' },
        take: 100 // Reduced from 1000
      })
    ]);

    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] analyticsService.getDashboardMetrics raw results:', {
        totalOrders,
        todayOrders,
        pendingOrders,
        deliveredOrders,
        totalRevenue: totalRevenue._sum.totalAmount,
        todayRevenue: todayRevenue._sum.totalAmount,
        activeAgents,
        deliverySamples: deliveries.length
      });
    }

    // Calculate average delivery time from recent deliveries
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
   * Supports both relative (days) and absolute (startDate/endDate) date ranges
   * Supports user-scoped filtering for sales reps
   */
  async getSalesTrends(
    filters: {
      period?: string;
      days?: number;
      startDate?: string;
      endDate?: string;
    },
    userId?: number,
    userRole?: string
  ) {
    const { period = 'daily', days = 30, startDate: customStart, endDate: customEnd } = filters;

    // Use custom date range if provided, otherwise calculate from days
    let startDate: Date;
    let endDate: Date;

    if (customStart && customEnd) {
      startDate = new Date(customStart);
      endDate = new Date(customEnd);
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Build user scope filter (sales reps only see their assigned orders)
    const userFilter = buildUserScopeFilter(userId, userRole);

    const orders = await prisma.order.findMany({
      where: {
        ...userFilter,
        deletedAt: null,
        createdAt: {
          gte: startDate,
          lte: endDate
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

    const data = Object.entries(trends)
      .map(([date, stats]) => ({
        date,
        orders: stats.orders,
        revenue: stats.revenue,
        delivered: stats.delivered,
        conversionRate: stats.orders > 0 ? (stats.delivered / stats.orders) * 100 : 0
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return data;
  }

  /**
   * Get conversion funnel
   */
  async getConversionFunnel(
    filters: DateFilters,
    userId?: number,
    userRole?: string
  ) {
    const { startDate, endDate } = filters;

    const where: Prisma.OrderWhereInput = { deletedAt: null };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    // Build user scope filter
    const userFilter = buildUserScopeFilter(userId, userRole);
    Object.assign(where, userFilter);

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
   * Supports optional date range filtering
   */
  async getRepPerformance(
    filters?: { startDate?: string; endDate?: string },
    userId?: number,
    userRole?: string
  ) {
    // Build date filter for orders
    const dateFilter = filters?.startDate || filters?.endDate
      ? {
        createdAt: {
          ...(filters.startDate && { gte: new Date(filters.startDate) }),
          ...(filters.endDate && { lte: new Date(filters.endDate) })
        },
        deletedAt: null
      }
      : { deletedAt: null };

    const reps = await prisma.user.findMany({
      where: {
        role: 'sales_rep',
        isActive: true,
        ...(userRole === 'sales_rep' && userId ? { id: userId } : {})
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedOrdersAsRep: {
          where: dateFilter,
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true,
            updatedAt: true,
            commissionPaid: true
          }
        }
      }
    });

    const performance = reps.map((rep) => {
      const total = rep.assignedOrdersAsRep.length;
      // Only count delivered orders that haven't been paid yet for completed count
      const completed = rep.assignedOrdersAsRep.filter((o) => o.status === 'delivered' && !o.commissionPaid).length;
      // Only calculate revenue from delivered orders where commission hasn't been paid
      const revenue = rep.assignedOrdersAsRep
        .filter((o) => o.status === 'delivered' && !o.commissionPaid)
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
        pending: rep.assignedOrdersAsRep.filter((o) =>
          !['delivered', 'cancelled', 'returned', 'failed_delivery'].includes(o.status)
        ).length,
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
          where: { deletedAt: null },
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
    try {
      const [totalCustomers, activeCustomers, topCustomers, customersByArea, avgOrderValue] =
        await withTimeout(
          Promise.all([
            prisma.customer.count({
              where: { isActive: true }
            }),
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
            prisma.customer.groupBy({
              by: ['area'],
              where: { isActive: true },
              _count: { area: true },
              orderBy: { _count: { area: 'desc' } },
              take: 20
            }),
            prisma.order.aggregate({
              where: { status: 'delivered', deletedAt: null },
              _avg: { totalAmount: true }
            })
          ]),
          15000,
          'Customer insights query timeout'
        );

      const insights = {
        totalCustomers,
        activeCustomers,
        topCustomers,
        customersByArea: customersByArea.map(group => ({
          area: group.area,
          count: group._count.area
        })),
        avgOrderValue: avgOrderValue._avg.totalAmount || 0
      };

      return insights;
    } catch (error) {
      console.error('[getCustomerInsights] Error:', error);
      // Return empty data instead of crashing
      return {
        totalCustomers: 0,
        activeCustomers: 0,
        topCustomers: [],
        customersByArea: [],
        avgOrderValue: 0
      };
    }
  }

  /**
   * Get product performance analytics
   */
  async getProductPerformance(filters?: DateFilters) {
    const where: Prisma.OrderItemWhereInput = {};

    if (filters?.startDate || filters?.endDate) {
      where.order = {
        createdAt: {},
        deletedAt: null
      } as any;
      if (filters.startDate) (where.order as any).createdAt.gte = filters.startDate;
      if (filters.endDate) (where.order as any).createdAt.lte = filters.endDate;
    } else {
      where.order = { deletedAt: null } as any;
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
    const where: Prisma.OrderWhereInput = { deletedAt: null };

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
        },
        deletedAt: null
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

    return Object.entries(series)
      .map(([date, value]) => ({
        date,
        value
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
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
          deletedAt: null,
          createdAt: {
            gte: lastHour
          }
        }
      }),
      prisma.order.count({
        where: {
          deletedAt: null,
          status: 'out_for_delivery'
        }
      }),
      prisma.order.aggregate({
        where: {
          deletedAt: null,
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

  /**
   * Get pending orders awaiting action
   * Returns all orders with status pending_confirmation
   */
  async getPendingOrders(userId?: number, userRole?: string) {
    const userFilter = buildUserScopeFilter(userId, userRole);

    const orders = await prisma.order.findMany({
      where: {
        status: 'pending_confirmation',
        deletedAt: null,
        ...userFilter
      },
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            area: true
          }
        },
        customerRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    return orders.map((order) => ({
      id: order.id,
      orderNumber: `#${order.id.toString().padStart(6, '0')}`,
      customerName: `${order.customer.firstName} ${order.customer.lastName}`,
      customerPhone: order.customer.phoneNumber,
      customerArea: order.customer.area,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      repName: order.customerRep
        ? `${order.customerRep.firstName} ${order.customerRep.lastName}`
        : 'Unassigned'
    }));
  }

  /**
   * Get recent activity feed
   * Returns the 10 most recent notifications
   */
  async getRecentActivity(userId?: number, userRole?: string) {
    const where: Prisma.NotificationWhereInput = {};

    // If it's a sales rep, only show their own activity
    if (userRole === 'sales_rep' && userId) {
      where.userId = userId;
    }

    const notifications = await prisma.notification.findMany({
      where,
      take: 10,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            role: true
          }
        }
      }
    });

    return notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      userName: `${notification.user.firstName} ${notification.user.lastName}`,
      userRole: notification.user.role,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      data: notification.data
    }));
  }
}

export default new AnalyticsService();
