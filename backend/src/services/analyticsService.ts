import prisma from '../utils/prisma';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import { Prisma } from '@prisma/client';
import * as Money from '../utils/money';
import { roleScope } from '../utils/kpiRequest';
import { DAY_MS, endOfDay, getStoreTimeZone, kpiWindow, localDate, monthRange, parseBound, parseInclusiveBound, parseYmd, startOfDay } from './kpi/dates';
import { deliveredRevenue, deliveredRevenueByArea, deliveredRevenueByDay, deliveredRevenueByRep, revenueScope } from './kpi/revenue';
import { OPEN, rates } from './kpi/rates';
import { repRates } from './kpi/reps';
import { partnerRates } from './kpi/partners';
import { productDeliveredUnits } from './kpi/products';

interface DateFilters {
  startDate?: Date;
  endDate?: Date;
}

/**
 * Helper function to build user-scoped filter for analytics queries
 * Sales reps only see orders assigned to them, delivery agents only their deliveries, others see all orders.
 * The rule is roleScope (utils/kpiRequest), the same one the KPI routes use (D19).
 */
function buildUserScopeFilter(userId?: number, userRole?: string) {
  return orderFilterOf(roleScope({ id: userId, role: userRole }));
}

/** The Prisma order filter of a role scope. */
function orderFilterOf(scope: { repId?: number; partnerId?: number }) {
  if (scope.repId !== undefined) return { customerRepId: scope.repId };
  if (scope.partnerId !== undefined) return { deliveryAgentId: scope.partnerId };
  return {};
}

/**
 * Store-zone range [from, to) of a request. A date-only value is a store-zone day (`to` inclusive); an ISO instant
 * is used as given. With no value the range is the current month so far (month to date).
 */
function resolveRange(filters: { startDate?: string; endDate?: string } | undefined, tenantId: string, now: Date) {
  const zone = getStoreTimeZone(tenantId);
  const { year, month } = parseYmd(localDate(now, zone));
  return {
    from: filters?.startDate ? parseBound(filters.startDate, 'from', zone) : monthRange(year, month, zone).from,
    to: filters?.endDate ? parseBound(filters.endDate, 'to', zone) : now,
  };
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
   * Revenue and delivered orders come from the KPI layer (delivery-date basis, returns leave in their return month).
   * Rates are the three named rates. Supports optional date range filtering (default month to date) and role scope.
   */
  async getDashboardMetrics(
    filters?: {
      startDate?: string;
      endDate?: string;
    },
    userId?: number,
    userRole?: string
  ) {
    const tenantId = resolveTenantId();
    const zone = getStoreTimeZone(tenantId);
    const now = new Date();
    const { from, to } = resolveRange(filters, tenantId, now);
    const today = localDate(now, zone);
    const todayFrom = startOfDay(today, zone);
    const todayTo = endOfDay(today, zone);

    // Build user scope filter (sales reps only see their assigned orders)
    const scope = roleScope({ id: userId, role: userRole });
    const userFilter = orderFilterOf(scope);
    const scopeForRevenue = revenueScope(scope);

    const [
      totalOrders,
      todayOrders,
      pendingOrders,
      revenue,
      todayRevenue,
      orderRates,
      activeAgents,
      deliveries
    ] = await Promise.all([
      prisma.order.count({
        where: { ...userFilter, deletedAt: null, createdAt: { gte: from, lt: to } }
      }),
      prisma.order.count({
        where: { ...userFilter, deletedAt: null, createdAt: { gte: todayFrom, lt: todayTo } }
      }),
      prisma.order.count({
        where: { ...userFilter, deletedAt: null, status: 'pending_confirmation' }
      }),
      deliveredRevenue(tenantId, from, to, scopeForRevenue),
      deliveredRevenue(tenantId, todayFrom, todayTo, scopeForRevenue),
      rates(tenantId, from, to, scope),
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
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Only last 7 days
            },
        select: {
          scheduledTime: true,
          actualDeliveryTime: true
        },
        orderBy: { actualDeliveryTime: 'desc' },
        take: 100 // Reduced from 1000
      })
    ]);

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

    return {
      totalOrders,
      todayOrders,
      pendingOrders,
      deliveredOrders: revenue.deliveredOrders.value,
      totalRevenue: revenue.total.value,
      todayRevenue: todayRevenue.total.value,
      activeAgents,
      avgDeliveryTime: avgTime,
      confirmationRate: orderRates.confirmationRate.value,
      deliverySuccessRate: orderRates.deliverySuccessRate.value,
      orderToCashYield: orderRates.orderToCashYield.value,
    };
  }

  /**
   * Get sales trends over time
   * Orders are counted by placement day; revenue and delivered orders by delivery day (KPI layer, store-zone days).
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
    const tenantId = resolveTenantId();
    const zone = getStoreTimeZone(tenantId);
    const now = new Date();

    // Use custom date range if provided, otherwise calculate from days
    const { from, to } = customStart && customEnd
      ? resolveRange({ startDate: customStart, endDate: customEnd }, tenantId, now)
      : { from: startOfDay(localDate(new Date(now.getTime() - days * DAY_MS), zone), zone), to: now };

    // Build user scope filter (sales reps only see their assigned orders)
    const userFilter = buildUserScopeFilter(userId, userRole);

    const [placed, delivered] = await Promise.all([
      prisma.order.findMany({
        where: { ...userFilter, deletedAt: null, createdAt: { gte: from, lt: to } },
        select: { createdAt: true }
      }),
      deliveredRevenueByDay(tenantId, from, to, revenueScope(roleScope({ id: userId, role: userRole }))),
    ]);

    const keyOf = (day: string) => (period === 'daily' ? day : day.slice(0, 7));
    const trends = new Map<string, { orders: number; revenue: Money.Money; delivered: number }>();
    const bucket = (key: string) => {
      let b = trends.get(key);
      if (!b) {
        b = { orders: 0, revenue: Money.ZERO, delivered: 0 };
        trends.set(key, b);
      }
      return b;
    };
    placed.forEach((order) => {
      bucket(keyOf(localDate(order.createdAt, zone))).orders += 1;
    });
    delivered.forEach((day) => {
      const b = bucket(keyOf(day.date));
      b.revenue = Money.add(b.revenue, day.revenue);
      b.delivered += day.deliveredOrders;
    });

    return [...trends.entries()]
      .map(([date, stats]) => ({
        date,
        orders: stats.orders,
        revenue: Money.toApi(stats.revenue),
        delivered: stats.delivered,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
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
   * Rates are the two rep rates (kpi/reps.ts); revenue and delivered orders are the KPI delivered revenue of the
   * rep's orders. Supports optional date range filtering (default month to date).
   */
  async getRepPerformance(
    filters?: { startDate?: string; endDate?: string },
    userId?: number,
    userRole?: string
  ) {
    const tenantId = resolveTenantId();
    const { from, to } = resolveRange(filters, tenantId, new Date());
    const { repId } = roleScope({ id: userId, role: userRole });

    const reps = await prisma.user.findMany({
      where: {
        role: 'sales_rep',
        isActive: true,
        ...(repId !== undefined ? { id: repId } : {})
      },
      select: {
        id: true,
        firstName: true,
        lastName: true
      }
    });

    const repIds = reps.map((rep) => rep.id);
    const [repKpis, revenueByRep, pendingGroups, unpaidGroups] = await Promise.all([
      repRates(tenantId, from, to),
      deliveredRevenueByRep(tenantId, from, to),
      // All-time pending orders per rep
      prisma.order.groupBy({
        by: ['customerRepId'],
        where: {
          customerRepId: { in: repIds },
          status: {
            notIn: ['delivered', 'cancelled', 'returned', 'failed_delivery']
          },
          deletedAt: null
        },
        _count: { _all: true }
      }),
      // All-time unpaid delivered orders per rep (for Earnings, bypassing the range)
      prisma.order.groupBy({
        by: ['customerRepId'],
        where: {
          customerRepId: { in: repIds },
          status: 'delivered',
          commissionPaid: false,
          deletedAt: null
        },
        _count: { _all: true }
      })
    ]);
    const pendingByRep = new Map(pendingGroups.map((g) => [g.customerRepId, g._count._all]));
    const unpaidByRep = new Map(unpaidGroups.map((g) => [g.customerRepId, g._count._all]));

    return reps.map((rep) => {
      const kpi = repKpis.rep(rep.id);
      const revenue = revenueByRep.get(rep.id);

      return {
        userId: rep.id,
        userName: `${rep.firstName} ${rep.lastName}`,
        totalAssigned: kpi.confirmationRate.detail.placed,
        completed: revenue?.deliveredOrders ?? 0,
        pending: pendingByRep.get(rep.id) ?? 0,
        unpaidDeliveredOrders: unpaidByRep.get(rep.id) ?? 0,
        confirmationRate: kpi.confirmationRate.value,
        revenue: revenue?.revenue ?? Money.toApi(Money.ZERO)
      };
    });
  }

  /**
   * Get delivery agent performance
   * The success rate is the partner delivery success rate (kpi/partners.ts, cohort basis).
   * A delivery agent sees only their own row.
   */
  async getAgentPerformance(filters?: { startDate?: string; endDate?: string }, userId?: number, userRole?: string) {
    const tenantId = resolveTenantId();
    const { from, to } = resolveRange(filters, tenantId, new Date());
    const { partnerId } = roleScope({ id: userId, role: userRole });

    const [agents, partners, statusGroups] = await Promise.all([
      prisma.user.findMany({
        where: {
          role: 'delivery_agent',
          isActive: true,
          ...(partnerId !== undefined ? { id: partnerId } : {})
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          deliveries: {
            select: {
              scheduledTime: true,
              actualDeliveryTime: true
            }
          }
        }
      }),
      partnerRates(tenantId, from, to),
      prisma.order.groupBy({
        by: ['deliveryAgentId', 'status'],
        where: { deletedAt: null, deliveryAgentId: partnerId ?? { not: null }, createdAt: { gte: from, lt: to } },
        _count: { _all: true }
      })
    ]);

    const partnerById = new Map(partners.map((p) => [p.partnerId, p]));
    const countsByAgent = new Map<number, Map<string, number>>();
    for (const g of statusGroups) {
      if (g.deliveryAgentId === null) continue;
      const counts = countsByAgent.get(g.deliveryAgentId) ?? new Map<string, number>();
      counts.set(g.status, g._count._all);
      countsByAgent.set(g.deliveryAgentId, counts);
    }

    return agents.map((agent) => {
      const partner = partnerById.get(agent.id);
      const detail = partner?.deliverySuccessRate.detail ?? { delivered: 0, failed: 0, returned: 0, closed: 0 };
      const mine = countsByAgent.get(agent.id);
      const inStatus = (statuses: string[]) =>
        statuses.reduce((sum, status) => sum + (mine?.get(status) ?? 0), 0);
      const total = partner?.assigned ?? 0;
      const failed = detail.failed + detail.returned;

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
        completed: detail.delivered,
        pending: inStatus(OPEN),
        active: inStatus(['ready_for_pickup', 'out_for_delivery']),
        failed,
        deliverySuccessRate: partner?.deliverySuccessRate.value ?? null,
        onTimeRate,
        totalDeliveries: agent.deliveries.length
      };
    });
  }

  /**
   * Get customer insights
   */
  async getCustomerInsights() {
    const allTime = kpiWindow();
    try {
      const [totalCustomers, topCustomers, customersByArea, delivered] =
        await withTimeout(
          Promise.all([
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
            // All-time delivered revenue and orders from the KPI layer: average order value = revenue / orders
            deliveredRevenue(resolveTenantId(), allTime.from, allTime.to)
          ]),
          15000,
          'Customer insights query timeout'
        );

      const insights = {
        totalCustomers,
        topCustomers,
        customersByArea: customersByArea.map(group => ({
          area: group.area,
          count: group._count.area
        })),
        avgOrderValue: delivered.deliveredOrders.value > 0
          ? Money.div(delivered.total.value, delivered.deliveredOrders.value)
          : Money.ZERO
      };

      return insights;
    } catch (error) {
      console.error('[getCustomerInsights] Error:', error);
      // Return empty data instead of crashing
      return {
        totalCustomers: 0,
        topCustomers: [],
        customersByArea: [],
        avgOrderValue: Money.ZERO
      };
    }
  }

  /**
   * Get product performance analytics
   * Units and revenue are the KPI delivered units and line revenue (delivery-date basis, default month to date).
   */
  async getProductPerformance(filters?: { startDate?: string; endDate?: string }) {
    const tenantId = resolveTenantId();
    const { from, to } = resolveRange(filters, tenantId, new Date());

    const { byProduct = [] } = await productDeliveredUnits(tenantId, 'all', from, to);

    const products = await prisma.product.findMany({
      where: { id: { in: byProduct.map((p) => p.productId) } },
      select: { id: true, category: true }
    });
    const categoryById = new Map(products.map((p) => [p.id, p.category]));

    return byProduct
      .map((p) => ({
        productId: p.productId,
        productName: p.name || 'Unknown',
        sku: p.sku,
        category: categoryById.get(p.productId) || '',
        unitsSold: p.units,
        revenue: p.lineRevenue
      }))
      .sort((a, b) => Money.compare(b.revenue, a.revenue));
  }

  /**
   * Get area-wise delivered revenue (KPI layer: delivered orders by delivery area, default month to date)
   */
  async getAreaDistribution(filters?: { startDate?: string; endDate?: string }) {
    const tenantId = resolveTenantId();
    const { from, to } = resolveRange(filters, tenantId, new Date());

    const areas = await deliveredRevenueByArea(tenantId, from, to);

    return areas.slice(0, 20).map((a) => ({
      area: a.area,
      orderCount: a.deliveredOrders,
      revenue: a.revenue
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
      avgOrderValue: Money.orZero(avgOrderValue._avg.totalAmount),
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

  /**
   * Get order status distribution
   * Supports MTD and custom date filtering
   */
  async getOrderStatusDistribution(
    filters?: {
      startDate?: string;
      endDate?: string;
    },
    userId?: number,
    userRole?: string
  ) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const zone = getStoreTimeZone(getTenantId());

    // Build date filter (MTD default). Date-only bounds are store-zone days, the end inclusive.
    const dateFilter = filters?.startDate && filters?.endDate
      ? {
        createdAt: {
          gte: parseInclusiveBound(filters.startDate, 'from', zone),
          lte: parseInclusiveBound(filters.endDate, 'to', zone)
        }
      }
      : {
        createdAt: {
          gte: startOfMonth,
          lte: now
        }
      };

    const userFilter = buildUserScopeFilter(userId, userRole);

    const statusCounts = await prisma.order.groupBy({
      by: ['status'],
      where: {
        ...dateFilter,
        ...userFilter,
        deletedAt: null
      },
      _count: {
        status: true
      }
    });

    return statusCounts.map(item => ({
      status: item.status,
      count: item._count.status
    })).sort((a, b) => b.count - a.count);
  }
}

export default new AnalyticsService();
