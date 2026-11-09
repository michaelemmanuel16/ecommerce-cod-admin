import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { CallOutcome, CallSource, DeclineReason, OrderStatus, Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { getSocketInstance } from '../utils/socketInstance';
import { emitCallLogged } from '../sockets/index';
import { transitionOrder, TransitionActor } from './orderStateMachine';

interface CreateCallData {
  customerId: number;
  orderId?: number;
  outcome: CallOutcome;
  duration?: number;
  notes?: string;
  salesRepId: number;
  startedAt?: Date;
  source?: CallSource;
  declineReason?: DeclineReason;
  callbackAt?: Date;
  orderChanges?: {
    packageId?: number;
    addOnIds?: number[];
    openedAt?: Date | string;
    expectedStatusVersion?: number;
    value?: any;
    extraValue?: any;
  };
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
    let order: { id: number; createdAt: Date; customerId: number; status: OrderStatus; customerRepId: number | null; tenantId: string | null } | null = null;
    if (data.orderId) {
      order = await prisma.order.findUnique({
        where: { id: data.orderId }
      }) as any;

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

    // M7-T03: Rep logging a call on another rep's order -> 403
    if (order && salesRep.role === 'sales_rep') {
      if (order.customerRepId != null && order.customerRepId !== data.salesRepId) {
        throw new AppError("You cannot log a call on another rep's order", 403, 'FORBIDDEN');
      }
    }

    // Normalize outcome alias (call_back -> call_back_later)
    let outcome = data.outcome;
    if ((outcome as string) === 'call_back') {
      outcome = CallOutcome.call_back_later;
    }

    // M7-T03 Outcome validations:
    // 1. Confirm on already-confirmed order -> 409
    if (outcome === CallOutcome.confirmed && order) {
      if (order.status === 'confirmed') {
        throw new AppError('Order is already confirmed', 409, 'ALREADY_CONFIRMED');
      }
    }

    // 2. Declined needs a reason
    if (outcome === CallOutcome.declined) {
      if (!data.declineReason) {
        throw new AppError('Decline reason is required', 400, 'DECLINE_REASON_REQUIRED');
      }
    }

    // 3. Call back in the past -> 400
    if (outcome === CallOutcome.call_back_later) {
      if (!data.callbackAt) {
        throw new AppError('Call back time is required', 400, 'CALLBACK_TIME_REQUIRED');
      }
      const cbTime = new Date(data.callbackAt).getTime();
      if (isNaN(cbTime) || cbTime < Date.now() - 60_000) {
        throw new AppError('Call back time cannot be in the past', 400, 'INVALID_CALLBACK_TIME');
      }
    }

    // A client-sent start time may not be in the future or before the order existed:
    // it feeds firstContactAt and so the time-to-first-call KPI.
    const now = new Date();
    let startedAt = data.startedAt && data.startedAt <= now ? data.startedAt : now;
    if (order && startedAt < order.createdAt) startedAt = order.createdAt;

    // Create call log
    const declineReason = outcome === CallOutcome.wrong_number ? ('wrong_number' as DeclineReason) : data.declineReason;
    const call = await prisma.call.create({
      data: {
        tenantId: resolveTenantId(customer.tenantId),
        customerId: data.customerId,
        orderId: data.orderId,
        salesRepId: data.salesRepId,
        outcome,
        duration: data.duration,
        notes: data.notes,
        startedAt,
        source: data.source ?? CallSource.manual,
        declineReason,
        callbackAt: data.callbackAt ? new Date(data.callbackAt) : null,
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

    // M7-T03: Set firstContactAt on the first rep call attempt only; auto_confirm calls never set it.
    const isAutoConfirm = data.source === CallSource.auto_confirm || (data.source as string) === 'auto_confirm';
    if (!isAutoConfirm && data.orderId) {
      await prisma.order.updateMany({
        where: { id: data.orderId, firstContactAt: null },
        data: { firstContactAt: startedAt }
      });
    }

    // M7-T04: Upsell changes via call card (server computes extra value, client sends only IDs)
    let upsellResult: any = null;
    if (data.orderChanges && data.orderId) {
      const { upsellService } = await import('./upsellService');
      upsellResult = await upsellService.applyUpsell({
        orderId: data.orderId,
        repId: data.salesRepId,
        packageId: data.orderChanges.packageId,
        addOnIds: data.orderChanges.addOnIds,
        openedAt: data.orderChanges.openedAt,
        expectedStatusVersion: data.orderChanges.expectedStatusVersion,
        tenantId: resolveTenantId(salesRep.tenantId),
      });
    }

    // M7-T03: Order status transitions and side effects
    if (order && data.orderId) {
      const actor: TransitionActor = { kind: 'user', userId: data.salesRepId, role: salesRep.role as any };
      if (outcome === CallOutcome.confirmed) {
        await transitionOrder(data.orderId, 'confirmed', actor);
      } else if (outcome === CallOutcome.declined) {
        await transitionOrder(data.orderId, 'cancelled', actor, { declineReason: data.declineReason });
      } else if (outcome === CallOutcome.wrong_number) {
        await transitionOrder(data.orderId, 'cancelled', actor, { declineReason: 'wrong_number' as any });
        await prisma.customer.update({
          where: { id: data.customerId },
          data: { wrongNumber: true },
        });
      }
    }

    // M7-T03: Next queue order id in the rep's queue
    let nextOrderId: number | null = null;
    if (data.orderId) {
      const nextOrder = await prisma.order.findFirst({
        where: {
          customerRepId: data.salesRepId,
          status: 'pending_confirmation',
          id: { not: data.orderId },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      nextOrderId = nextOrder?.id ?? null;
    }

    Object.defineProperty(call, 'nextOrderId', {
      value: nextOrderId,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(call, 'upsell', {
      value: upsellResult,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(call, 'warningFlag', {
      value: upsellResult?.warningFlag ?? false,
      enumerable: false,
      writable: true,
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
