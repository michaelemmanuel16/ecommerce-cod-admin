import prisma from '../utils/prisma';
import { OrderStatus } from '@prisma/client';
import * as Money from '../utils/money';
import { repRates } from './kpi/reps';
import { addDays, getStoreTimeZone, localDate, parseBound, startOfDay } from './kpi/dates';
import type { KpiResult } from './kpi/types';

export interface RepPerformanceDetails {
  repId: number;
  repName: string;
  email: string;
  phoneNumber: string | null;
  commissionAmount: Money.Money;
  isActive: boolean;
  isAvailable: boolean;
  country: string | null;
  metrics: {
    totalAssigned: number;
    /** Confirmed / assigned, orders placed in the range (F-767). Detail has the counts. */
    confirmationRate: KpiResult<number | null>;
    /** Delivered / closed among the orders this rep confirmed (F-252). Pay state is never read. */
    deliveredFromConfirmedRate: KpiResult<number | null>;
    mtdConfirmationRate: KpiResult<number | null>;
    mtdDeliveredFromConfirmedRate: KpiResult<number | null>;
    /** Unpaid delivered orders x commission. Money, not a rate. Moves to CommissionEntry in F-769. */
    totalEarnings: Money.Money;
    monthlyEarnings: Money.Money;
  };
  ordersByStatus: {
    pending_confirmation: number;
    confirmed: number;
    preparing: number;
    ready_for_pickup: number;
    out_for_delivery: number;
    delivered: number;
    cancelled: number;
    returned: number;
    failed_delivery: number;
  };
}

/**
 * Get detailed performance metrics for customer representatives
 * Rates come from the KPI layer (services/kpi/reps.ts); earnings and order statistics are computed here.
 *
 * @param tenantId - Store the numbers belong to (KPI functions take it explicitly)
 * @param repId - Optional specific rep ID to filter by
 * @param startDate - Optional start date for metric calculation
 * @param endDate - Optional end date for metric calculation
 * @returns Array of rep performance details with commission calculations
 */
export const getRepPerformanceDetails = async (
  tenantId: string,
  repId?: string,
  startDate?: string,
  endDate?: string
): Promise<RepPerformanceDetails[]> => {
  try {
    // Parse the range first: a bad date throws RangeError before any query runs.
    const zone = getStoreTimeZone(tenantId);
    const now = new Date();
    const rangeFrom = startDate ? parseBound(startDate, 'from', zone) : new Date(0);
    const rangeTo = endDate ? parseBound(endDate, 'to', zone) : addDays(now, 1);
    const mtdFrom = startOfDay(`${localDate(now, zone).slice(0, 8)}01`, zone);

    // Build where clause for filtering users
    const userWhere: any = {
      role: 'sales_rep',
      isActive: true
    };

    if (repId) {
      userWhere.id = parseInt(repId, 10);
    }

    // Build order filter for the include/select
    const orderWhere: any = { deletedAt: null };
    if (startDate || endDate) {
      orderWhere.createdAt = {};
      if (startDate) {
        orderWhere.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        orderWhere.createdAt.lte = new Date(endDate);
      }
    }

    const reps = await prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        commissionAmount: true,
        isActive: true,
        isAvailable: true,
        country: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Order counts per rep, status and pay state in one query; the month-to-date unpaid delivered orders in another.
    const repIds = reps.map(rep => rep.id);
    const mtdCreatedAt = { ...orderWhere.createdAt, gte: orderWhere.createdAt?.gte && orderWhere.createdAt.gte > mtdFrom ? orderWhere.createdAt.gte : mtdFrom };
    const [orderGroups, mtdUnpaidGroups] = await Promise.all([
      prisma.order.groupBy({
        by: ['customerRepId', 'status', 'commissionPaid'],
        where: { ...orderWhere, customerRepId: { in: repIds } },
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ['customerRepId'],
        where: {
          ...orderWhere,
          createdAt: mtdCreatedAt,
          customerRepId: { in: repIds },
          status: OrderStatus.delivered,
          commissionPaid: false,
        },
        _count: { _all: true },
      }),
    ]);
    const mtdUnpaid = new Map(mtdUnpaidGroups.map(g => [g.customerRepId, g._count._all]));

    // Rates: all-time unless a range is given; month to date in the store zone.
    const [rangeRates, mtdRates] = await Promise.all([
      repRates(tenantId, rangeFrom, rangeTo),
      repRates(tenantId, mtdFrom, addDays(now, 1)),
    ]);

    const performanceData: RepPerformanceDetails[] = reps.map(rep => {
      const ordersByStatus = {
        pending_confirmation: 0,
        confirmed: 0,
        preparing: 0,
        ready_for_pickup: 0,
        out_for_delivery: 0,
        delivered: 0,
        cancelled: 0,
        returned: 0,
        failed_delivery: 0
      } as Record<OrderStatus, number>;
      let totalAssigned = 0;
      let unpaidDelivered = 0;
      for (const g of orderGroups) {
        if (g.customerRepId !== rep.id) continue;
        const count = g._count._all;
        totalAssigned += count;
        ordersByStatus[g.status] = (ordersByStatus[g.status] || 0) + count;
        // Earnings only: delivered orders whose commission is not paid yet. Rates never read this.
        if (g.status === OrderStatus.delivered && !g.commissionPaid) unpaidDelivered += count;
      }

      const commissionAmountValue = Money.orZero(rep.commissionAmount);
      const repRange = rangeRates.rep(rep.id);
      const repMtd = mtdRates.rep(rep.id);

      return {
        repId: rep.id,
        repName: `${rep.firstName} ${rep.lastName}`,
        email: rep.email,
        phoneNumber: rep.phoneNumber,
        commissionAmount: commissionAmountValue,
        isActive: rep.isActive,
        isAvailable: rep.isAvailable,
        country: rep.country,
        metrics: {
          totalAssigned,
          confirmationRate: repRange.confirmationRate,
          deliveredFromConfirmedRate: repRange.deliveredFromConfirmedRate,
          mtdConfirmationRate: repMtd.confirmationRate,
          mtdDeliveredFromConfirmedRate: repMtd.deliveredFromConfirmedRate,
          totalEarnings: Money.roundHalfUp(Money.mul(unpaidDelivered, commissionAmountValue)),
          monthlyEarnings: Money.roundHalfUp(Money.mul(mtdUnpaid.get(rep.id) ?? 0, commissionAmountValue))
        },
        ordersByStatus
      };
    });

    return performanceData;
  } catch (error) {
    throw error;
  }
};

/**
 * Get commission earnings summary for a specific time period
 *
 * @param repId - Sales rep user ID
 * @param startDate - Start date for calculation
 * @param endDate - End date for calculation
 * @returns Commission earnings for the period
 */
export const getRepEarningsByPeriod = async (
  repId: string,
  startDate: Date,
  endDate: Date
): Promise<{ earnings: Money.Money; orderCount: number }> => {
  try {
    const rep = await prisma.user.findUnique({
      where: { id: parseInt(repId, 10) },
      select: {
        commissionAmount: true,
        assignedOrdersAsRep: {
          where: {
            status: OrderStatus.delivered,
            deletedAt: null,
            createdAt: {
              gte: startDate,
              lte: endDate
            }
          },
          select: {
            totalAmount: true
          }
        }
      }
    });

    if (!rep) {
      throw new Error('Sales representative not found');
    }

    // Calculate earnings: number of orders × commission amount
    const commissionAmountValue = Money.orZero(rep.commissionAmount);
    const earnings = Money.mul(rep.assignedOrdersAsRep.length, commissionAmountValue);

    return {
      earnings: Money.roundHalfUp(earnings),
      orderCount: rep.assignedOrdersAsRep.length
    };
  } catch (error) {
    throw error;
  }
};
