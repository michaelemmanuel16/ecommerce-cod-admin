import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { CallOutcome, Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { getSocketInstance } from '../utils/socketInstance';
import { emitCallLogged } from '../sockets/index';

interface CreateCallData {
  customerId: number;
  orderId?: number;
  outcome: CallOutcome;
  duration?: number;
  notes?: string;
  salesRepId: number;
}

interface CallFilters {
  salesRepId?: number;
  customerId?: number;
  orderId?: number;
  outcome?: CallOutcome;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

interface CallStatsFilters {
  salesRepId?: number;
  startDate?: Date;
  endDate?: Date;
}

export class CallService {
  /**
   * Create a new call log entry
   */
  async createCall(data: CreateCallData) {
    // Validate customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // Validate order exists if provided
    if (data.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: data.orderId }
      });

      if (!order) {
        throw new AppError('Order not found', 404);
      }

      // Ensure order belongs to customer
      if (order.customerId !== data.customerId) {
        throw new AppError('Order does not belong to this customer', 400);
      }
    }

    // Validate user exists and has permission to log calls
    const salesRep = await prisma.user.findUnique({
      where: { id: data.salesRepId }
    });

    if (!salesRep) {
      throw new AppError('Invalid user', 400);
    }

    // Allow super_admin, admin, manager, and sales_rep to log calls
    const allowedRoles = ['super_admin', 'admin', 'manager', 'sales_rep'];
    if (!allowedRoles.includes(salesRep.role)) {
      throw new AppError('User does not have permission to log calls', 403);
    }

    // Create call log
    const call = await prisma.call.create({
      data: {
        customerId: data.customerId,
        orderId: data.orderId,
        salesRepId: data.salesRepId,
        outcome: data.outcome,
        duration: data.duration,
        notes: data.notes
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true
          }
        },
        salesRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        order: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    logger.info('Call logged', {
      callId: call.id,
      salesRepId: data.salesRepId,
      customerId: data.customerId,
      outcome: data.outcome
    });

    // Emit real-time event (non-blocking)
    setImmediate(() => {
      try {
        emitCallLogged(getSocketInstance() as any, call);
      } catch (error) {
        logger.error('Failed to emit call logged event', { callId: call.id, error });
      }
    });

    return call;
  }

  /**
   * Get calls with filters and pagination
   */
  async getCalls(filters: CallFilters) {
    const {
      salesRepId,
      customerId,
      orderId,
      outcome,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = filters;

    const where: Prisma.CallWhereInput = {};

    if (salesRepId) where.salesRepId = salesRepId;
    if (customerId) where.customerId = customerId;
    if (orderId) where.orderId = orderId;
    if (outcome) where.outcome = outcome;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const skip = (page - 1) * limit;

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        skip,
        take: limit,
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneNumber: true
            }
          },
          salesRep: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          },
          order: {
            select: {
              id: true,
              status: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.call.count({ where })
    ]);

    return {
      calls,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get calls for a specific order
   */
  async getCallsByOrder(orderId: number) {
    const calls = await prisma.call.findMany({
      where: { orderId },
      include: {
        salesRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return calls;
  }

  /**
   * Get calls for a specific customer
   */
  async getCallsByCustomer(customerId: number) {
    const calls = await prisma.call.findMany({
      where: { customerId },
      include: {
        salesRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        order: {
          select: {
            id: true,
            status: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return calls;
  }

  /**
   * Get call statistics for manager dashboard
   */
  async getCallStats(filters: CallStatsFilters) {
    const { salesRepId, startDate, endDate } = filters;

    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date();
    monthStart.setDate(monthStart.getDate() - 30);

    const baseWhere: Prisma.CallWhereInput = {};
    if (salesRepId) baseWhere.salesRepId = salesRepId;
    if (startDate || endDate) {
      baseWhere.createdAt = {};
      if (startDate) baseWhere.createdAt.gte = startDate;
      if (endDate) baseWhere.createdAt.lte = endDate;
    }

    // Get all sales reps
    const salesReps = await prisma.user.findMany({
      where: {
        role: 'sales_rep',
        isActive: true,
        ...(salesRepId && { id: salesRepId })
      },
      select: {
        id: true,
        firstName: true,
        lastName: true
      }
    });

    // Get stats per rep
    const repStats = await Promise.all(
      salesReps.map(async (rep) => {
        const repWhere = { ...baseWhere, salesRepId: rep.id };

        const [
          totalCalls,
          todayCalls,
          weekCalls,
          monthCalls,
          outcomeBreakdown,
          callsWithDuration
        ] = await Promise.all([
          prisma.call.count({ where: repWhere }),
          prisma.call.count({
            where: { ...repWhere, createdAt: { gte: todayStart } }
          }),
          prisma.call.count({
            where: { ...repWhere, createdAt: { gte: weekStart } }
          }),
          prisma.call.count({
            where: { ...repWhere, createdAt: { gte: monthStart } }
          }),
          prisma.call.groupBy({
            by: ['outcome'],
            where: repWhere,
            _count: true
          }),
          prisma.call.findMany({
            where: {
              ...repWhere,
              duration: { not: null }
            },
            select: {
              duration: true,
              createdAt: true
            }
          })
        ]);

        // Calculate average calls per day
        const daysActive = filters.startDate
          ? Math.max(1, Math.ceil((new Date().getTime() - filters.startDate.getTime()) / (1000 * 60 * 60 * 24)))
          : 30;
        const avgCallsPerDay = totalCalls / daysActive;

        // Calculate average call duration
        const totalDuration = callsWithDuration.reduce((sum, c) => sum + (c.duration || 0), 0);
        const avgDuration = callsWithDuration.length > 0 ? totalDuration / callsWithDuration.length : 0;

        // Build outcome breakdown
        const outcomes = outcomeBreakdown.reduce((acc, item) => {
          acc[item.outcome] = item._count;
          return acc;
        }, {} as Record<string, number>);

        // Get timeline (calls per day for last 30 days)
        const timeline = await this.getCallTimeline(rep.id, 30);

        return {
          repId: rep.id,
          repName: `${rep.firstName} ${rep.lastName}`,
          totalCalls,
          todayCalls,
          weekCalls,
          monthCalls,
          avgCallsPerDay: Math.round(avgCallsPerDay * 10) / 10,
          avgDuration: Math.round(avgDuration),
          outcomeBreakdown: {
            confirmed: outcomes.confirmed || 0,
            rescheduled: outcomes.rescheduled || 0,
            no_answer: outcomes.no_answer || 0,
            cancelled: outcomes.cancelled || 0,
            other: outcomes.other || 0
          },
          timeline
        };
      })
    );

    return repStats;
  }

  /**
   * Get call timeline for a rep (calls per day)
   */
  private async getCallTimeline(salesRepId: number, days: number) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const calls = await prisma.call.findMany({
      where: {
        salesRepId,
        createdAt: { gte: startDate }
      },
      select: {
        createdAt: true
      }
    });

    // Group by date
    const timeline: Record<string, number> = {};
    calls.forEach((call) => {
      const dateKey = call.createdAt.toISOString().split('T')[0];
      timeline[dateKey] = (timeline[dateKey] || 0) + 1;
    });

    // Fill in missing dates with 0
    const result = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      result.unshift({
        date: dateKey,
        calls: timeline[dateKey] || 0
      });
    }

    return result;
  }
}

export default new CallService();
