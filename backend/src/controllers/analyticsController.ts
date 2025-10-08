import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';

export const getDashboardMetrics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
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
      avgDeliveryTime
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
          actualDeliveryTime: { not: null }
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

    avgDeliveryTime.forEach(d => {
      if (d.scheduledTime && d.actualDeliveryTime) {
        const diff = d.actualDeliveryTime.getTime() - d.scheduledTime.getTime();
        totalDeliveryTime += diff;
        deliveryCount++;
      }
    });

    const avgTime = deliveryCount > 0
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

    res.json({ metrics });
  } catch (error) {
    throw error;
  }
};

export const getSalesTrends = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period = 'daily', days = 30 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

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

    const trends: any = {};

    orders.forEach(order => {
      const key = period === 'daily'
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

    const data = Object.entries(trends).map(([date, stats]: [string, any]) => ({
      date,
      orders: stats.orders,
      revenue: stats.revenue,
      delivered: stats.delivered,
      conversionRate: stats.orders > 0 ? (stats.delivered / stats.orders) * 100 : 0
    }));

    res.json({ trends: data });
  } catch (error) {
    throw error;
  }
};

export const getConversionFunnel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const statusCounts = await prisma.order.groupBy({
      by: ['status'],
      where,
      _count: true
    });

    const funnel = statusCounts.map(s => ({
      status: s.status,
      count: s._count
    }));

    res.json({ funnel });
  } catch (error) {
    throw error;
  }
};

export const getRepPerformance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
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

    const performance = reps.map(rep => {
      const total = rep.assignedOrdersAsRep.length;
      const completed = rep.assignedOrdersAsRep.filter(o => o.status === 'delivered').length;
      const revenue = rep.assignedOrdersAsRep
        .filter(o => o.status === 'delivered')
        .reduce((sum, o) => sum + o.totalAmount, 0);

      // Calculate average response time
      let totalResponseTime = 0;
      rep.assignedOrdersAsRep.forEach(o => {
        const diff = o.updatedAt.getTime() - o.createdAt.getTime();
        totalResponseTime += diff;
      });

      const avgResponseTime = total > 0
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

    res.json({ performance });
  } catch (error) {
    throw error;
  }
};

export const getAgentPerformance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
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

    const performance = agents.map(agent => {
      const total = agent.assignedOrdersAsAgent.length;
      const delivered = agent.assignedOrdersAsAgent.filter(o => o.status === 'delivered').length;
      const failed = agent.assignedOrdersAsAgent.filter(o =>
        ['cancelled', 'returned', 'failed_delivery'].includes(o.status)
      ).length;

      // Calculate on-time delivery rate
      let onTimeDeliveries = 0;
      agent.deliveries.forEach(d => {
        if (d.scheduledTime && d.actualDeliveryTime && d.actualDeliveryTime <= d.scheduledTime) {
          onTimeDeliveries++;
        }
      });

      const onTimeRate = agent.deliveries.length > 0
        ? (onTimeDeliveries / agent.deliveries.length) * 100
        : 0;

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

    res.json({ performance });
  } catch (error) {
    throw error;
  }
};

export const getCustomerInsights = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      totalCustomers,
      activeCustomers,
      topCustomers,
      customersByCity,
      avgOrderValue
    ] = await Promise.all([
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
      prisma.customer.groupBy({
        by: ['city'],
        _count: true,
        orderBy: {
          _count: {
            city: 'desc'
          }
        },
        take: 10
      }),
      prisma.order.aggregate({
        _avg: { totalAmount: true }
      })
    ]);

    const insights = {
      totalCustomers,
      activeCustomers,
      topCustomers,
      customersByCity: customersByCity.map(c => ({
        city: c.city,
        count: c._count
      })),
      avgOrderValue: avgOrderValue._avg.totalAmount || 0
    };

    res.json({ insights });
  } catch (error) {
    throw error;
  }
};
