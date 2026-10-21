import { Prisma, OrderStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { phoneSearchConditions } from '../utils/phone';
import orderService from './orderService';
import financialService from './financialService';
import { deliveredRevenue } from './kpi/revenue';
import { rates } from './kpi/rates';

/**
 * The queries behind the registry tools. Tool files may not import the Prisma client, so the
 * reads that have no home in an existing service live here. Every method runs in the caller's tenant context
 * (the tenant-isolation extension scopes each query). Orders: see orderService.search and statusCounts.
 */

/** Statuses of a delivery that is under way: the `deliveries_active` filter and its default. */
export const ACTIVE_DELIVERY_STATUSES = ['out_for_delivery', 'ready_for_pickup', 'confirmed', 'preparing'] as const satisfies readonly OrderStatus[];

const AGENT_PENDING_STATUSES: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup'];
const REP_PENDING_STATUSES: OrderStatus[] = ['pending_confirmation', 'confirmed'];
/** A rep's order is no longer active once it is in one of these. */
const REP_DONE_STATUSES: OrderStatus[] = ['delivered', 'cancelled', 'returned', 'failed_delivery', 'payment_failed'];

/** Sum order counts per owner (agent or rep id) over the grouped rows. */
function countBy<T extends { _count: { id: number } }>(rows: T[], owner: (row: T) => number | null): Map<number | null, number> {
  const counts = new Map<number | null, number>();
  for (const row of rows) counts.set(owner(row), (counts.get(owner(row)) ?? 0) + row._count.id);
  return counts;
}

export const toolQueryService = {
  /** customers_lookup: phone (any stored format) and name must both match when both are given. Newest first. */
  async lookupCustomers(f: { phone?: string; name?: string; limit: number; cursorId?: number }) {
    const and: Prisma.CustomerWhereInput[] = [];
    if (f.phone) {
      // No digit in the term gives no phone conditions; fall back to a plain contains so it still filters.
      const phoneConditions = phoneSearchConditions(f.phone);
      and.push({ OR: phoneConditions.length ? phoneConditions : [{ phoneNumber: { contains: f.phone } }] });
    }
    if (f.name) {
      and.push({
        OR: [
          { firstName: { contains: f.name, mode: 'insensitive' } },
          { lastName: { contains: f.name, mode: 'insensitive' } },
        ],
      });
    }
    const customers = await prisma.customer.findMany({
      where: { isActive: true, AND: and },
      ...(f.cursorId !== undefined ? { cursor: { id: f.cursorId }, skip: 1 } : {}),
      take: f.limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        alternatePhone: true,
        address: true,
        state: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
    });
    const hasMore = customers.length > f.limit;
    return { customers: hasMore ? customers.slice(0, f.limit) : customers, hasMore };
  },

  /** products_inventory: active products, at most 200 (most tenants have fewer), by name. */
  async activeProducts(productId?: number) {
    return prisma.product.findMany({
      where: { isActive: true, ...(productId ? { id: productId } : {}) },
      take: 200,
      select: {
        id: true,
        name: true,
        sku: true,
        price: true,
        stockQuantity: true,
        lowStockThreshold: true,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });
  },

  /** deliveries_active: orders in a delivery-stage status, newest first. */
  async activeDeliveries(f: { status?: OrderStatus; agentId?: number; city?: string; limit: number; cursorId?: number }) {
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      status: f.status ?? { in: [...ACTIVE_DELIVERY_STATUSES] },
    };
    if (f.agentId) where.deliveryAgentId = f.agentId;
    if (f.city) where.deliveryArea = { contains: f.city, mode: 'insensitive' };

    const orders = await prisma.order.findMany({
      where,
      ...(f.cursorId !== undefined ? { cursor: { id: f.cursorId }, skip: 1 } : {}),
      take: f.limit + 1,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        deliveryAgent: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const hasMore = orders.length > f.limit;
    return { orders: hasMore ? orders.slice(0, f.limit) : orders, hasMore };
  },

  /**
   * Numbers for one store-zone range [from, to): orders placed, delivered revenue and count, and the three rates
   * (KPI layer). `statusCounts` is the placed-order status groupBy the total is summed from.
   */
  async periodStats(tenantId: string, from: Date, to: Date) {
    const [statusCounts, revenue, rangeRates] = await Promise.all([
      orderService.statusCounts(from, to),
      deliveredRevenue(tenantId, from, to),
      rates(tenantId, from, to),
    ]);
    return {
      statusCounts,
      stats: {
        totalOrders: statusCounts.reduce((sum, s) => sum + s._count.id, 0),
        delivered: revenue.deliveredOrders.value,
        revenue: revenue.total.value,
        confirmationRate: rangeRates.confirmationRate.value,
        deliverySuccessRate: rangeRates.deliverySuccessRate.value,
        orderToCashYield: rangeRates.orderToCashYield.value,
      },
    };
  },

  /** analytics_daily: the five best-selling products of a range, by units, with their names. */
  async topProducts(tenantId: string, from: Date, to: Date) {
    const top = await prisma.orderItem.groupBy({
      by: ['productId'],
      // OrderItem has no tenantId: scope it through the parent order.
      where: { order: { createdAt: { gte: from, lt: to }, deletedAt: null, tenantId } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });
    const productIds = top.map((p) => p.productId);
    const products = productIds.length > 0
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(products.map((p) => [p.id, p.name]));
    return top.map((p) => ({
      name: names.get(p.productId) ?? `Product #${p.productId}`,
      unitsSold: p._sum.quantity ?? 0,
    }));
  },

  /** analytics_monthly: customers created in [from, to). */
  async newCustomers(from: Date, to: Date) {
    return prisma.customer.count({ where: { createdAt: { gte: from, lt: to } } });
  },

  /** financial_summary: expenses created in [from, to), and the balance of each active delivery agent. */
  async expensesAndAgentBalances(from: Date, to: Date) {
    const [expenses, agentBalances] = await Promise.all([
      prisma.expense.aggregate({
        where: { createdAt: { gte: from, lt: to } },
        _sum: { amount: true },
        _count: { id: true },
      }),
      // AgentBalance has tenantId and is in TENANT_SCOPED_MODELS via the extension; the agent filter keeps active delivery agents only.
      prisma.agentBalance.findMany({
        where: { agent: { role: 'delivery_agent', isActive: true } },
        select: {
          agentId: true,
          currentBalance: true,
          totalCollected: true,
          totalDeposited: true,
          agent: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    return { expenses, agentBalances };
  },

  /** financial_summary: digital product revenue (GL 4020) and Paystack fees (GL 5060) booked in [from, to). */
  async digitalRevenueAndFees(from: Date, to: Date) {
    const { digitalRevenue, paystackFees } = await financialService.getFinancialSummary({
      startDate: from,
      endDate: new Date(to.getTime() - 1), // the summary's end bound is inclusive
    });
    return { digitalRevenue, paystackFees };
  },

  /** agents_status: active delivery agents with their order counts (one grouped query by agent and status, one for today's deliveries). */
  async agentWorkload(todayFrom: Date, todayTo: Date) {
    const [agents, byStatus, completedToday] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'delivery_agent', isActive: true },
        select: { id: true, firstName: true, lastName: true, phoneNumber: true },
      }),
      prisma.order.groupBy({
        by: ['deliveryAgentId', 'status'],
        where: { status: { in: [...AGENT_PENDING_STATUSES, 'out_for_delivery'] }, deletedAt: null },
        _count: { id: true },
      }),
      prisma.order.groupBy({
        by: ['deliveryAgentId'],
        where: { status: 'delivered', deletedAt: null, deliveryDate: { gte: todayFrom, lt: todayTo } },
        _count: { id: true },
      }),
    ]);
    return {
      agents,
      pending: countBy(byStatus.filter((c) => AGENT_PENDING_STATUSES.includes(c.status)), (c) => c.deliveryAgentId),
      active: countBy(byStatus.filter((c) => c.status === 'out_for_delivery'), (c) => c.deliveryAgentId),
      completedToday: countBy(completedToday, (c) => c.deliveryAgentId),
    };
  },

  /** agents_performance: active delivery agents, or one by id. */
  async deliveryAgents(agentId?: number) {
    return prisma.user.findMany({
      where: { role: 'delivery_agent', isActive: true, ...(agentId ? { id: agentId } : {}) },
      select: { id: true, firstName: true, lastName: true },
    });
  },

  /** reps_status: active sales reps with their order counts (one grouped query by rep and status, one for today's orders). */
  async repWorkload(todayStart: Date) {
    const [reps, byStatus, createdToday] = await Promise.all([
      prisma.user.findMany({
        where: { role: 'sales_rep', isActive: true },
        select: { id: true, firstName: true, lastName: true, phoneNumber: true },
      }),
      prisma.order.groupBy({ by: ['customerRepId', 'status'], where: { deletedAt: null }, _count: { id: true } }),
      prisma.order.groupBy({
        by: ['customerRepId'],
        where: { deletedAt: null, createdAt: { gte: todayStart } },
        _count: { id: true },
      }),
    ]);
    return {
      reps,
      createdToday: countBy(createdToday, (c) => c.customerRepId),
      pending: countBy(byStatus.filter((c) => REP_PENDING_STATUSES.includes(c.status)), (c) => c.customerRepId),
      active: countBy(byStatus.filter((c) => !REP_DONE_STATUSES.includes(c.status)), (c) => c.customerRepId),
    };
  },

  /** reps_performance: active sales reps, or one by id. */
  async salesReps(repId?: number) {
    return prisma.user.findMany({
      where: { role: 'sales_rep', isActive: true, ...(repId ? { id: repId } : {}) },
      select: { id: true, firstName: true, lastName: true },
    });
  },
};
