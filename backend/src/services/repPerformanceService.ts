import prisma from '../utils/prisma';
import { OrderStatus } from '@prisma/client';

export interface RepPerformanceDetails {
  repId: number;
  repName: string;
  email: string;
  phoneNumber: string | null;
  commissionAmount: number;
  isActive: boolean;
  isAvailable: boolean;
  country: string | null;
  metrics: {
    totalAssigned: number;
    deliveredCount: number;
    successRate: number;
    totalEarnings: number;
    monthlyEarnings: number;
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
 * Calculates success rates, earnings, and order statistics
 *
 * @param repId - Optional specific rep ID to filter by
 * @param startDate - Optional start date for metric calculation
 * @param endDate - Optional end date for metric calculation
 * @returns Array of rep performance details with commission calculations
 */
export const getRepPerformanceDetails = async (
  repId?: string,
  startDate?: string,
  endDate?: string
): Promise<RepPerformanceDetails[]> => {
  try {
    // Build where clause for filtering users
    const userWhere: any = {
      role: 'sales_rep',
      isActive: true
    };

    if (repId) {
      userWhere.id = parseInt(repId, 10);
    }

    // Build order filter for the include/select
    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.createdAt = {};
      if (startDate) {
        orderWhere.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        orderWhere.createdAt.lte = new Date(endDate);
      }
    }

    // Get all sales reps with their assigned orders
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
        assignedOrdersAsRep: {
          where: orderWhere,
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Calculate performance metrics for each rep

    // Calculate performance metrics for each rep
    const performanceData: RepPerformanceDetails[] = reps.map(rep => {
      const totalAssigned = rep.assignedOrdersAsRep.length;
      const deliveredOrders = rep.assignedOrdersAsRep.filter(
        order => order.status === OrderStatus.delivered
      );
      const deliveredCount = deliveredOrders.length;

      // Calculate success rate
      const successRate = totalAssigned > 0
        ? parseFloat(((deliveredCount / totalAssigned) * 100).toFixed(2))
        : 0;

      // Calculate total earnings: number of delivered orders × commission amount
      const commissionAmountValue = rep.commissionAmount || 0; // Fixed amount per order
      const totalEarnings = deliveredCount * commissionAmountValue;

      // Calculate monthly earnings (current month)
      const currentMonth = new Date();
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);

      const monthlyDeliveredOrders = deliveredOrders.filter(
        order => new Date(order.createdAt) >= startOfMonth
      );

      const monthlyEarnings = monthlyDeliveredOrders.length * commissionAmountValue;

      // Count orders by status
      const ordersByStatus = rep.assignedOrdersAsRep.reduce((acc, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      }, {
        pending_confirmation: 0,
        confirmed: 0,
        preparing: 0,
        ready_for_pickup: 0,
        out_for_delivery: 0,
        delivered: 0,
        cancelled: 0,
        returned: 0,
        failed_delivery: 0
      } as Record<OrderStatus, number>);

      return {
        repId: rep.id,
        repName: `${rep.firstName} ${rep.lastName}`,
        email: rep.email,
        phoneNumber: rep.phoneNumber,
        commissionAmount: rep.commissionAmount || 0,
        isActive: rep.isActive,
        isAvailable: rep.isAvailable,
        country: rep.country,
        metrics: {
          totalAssigned,
          deliveredCount,
          successRate,
          totalEarnings: parseFloat(totalEarnings.toFixed(2)),
          monthlyEarnings: parseFloat(monthlyEarnings.toFixed(2))
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
): Promise<{ earnings: number; orderCount: number }> => {
  try {
    const rep = await prisma.user.findUnique({
      where: { id: parseInt(repId, 10) },
      select: {
        commissionAmount: true,
        assignedOrdersAsRep: {
          where: {
            status: OrderStatus.delivered,
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
    const commissionAmountValue = rep.commissionAmount || 0;
    const earnings = rep.assignedOrdersAsRep.length * commissionAmountValue;

    return {
      earnings: parseFloat(earnings.toFixed(2)),
      orderCount: rep.assignedOrdersAsRep.length
    };
  } catch (error) {
    throw error;
  }
};
