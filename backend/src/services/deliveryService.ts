import { Prisma, DeliveryProofType, OrderStatus } from '@prisma/client';
import { transitionOrder, actorOf } from './orderStateMachine';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import { getStoreTimeZone, parseInclusiveBound } from './kpi/dates';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Requester } from '../utils/authUtils';
import logger from '../utils/logger';
import { GLAutomationService } from './glAutomationService';
import agentReconciliationService from './agentReconciliationService';
import { getSocketInstance } from '../utils/socketInstance';
import { emitGLEntryCreated } from '../sockets/index';
import * as Money from '../utils/money';
import { customerPhoneSearch } from '../utils/phone';


interface CreateDeliveryData {
  orderId: number;
  agentId: number;
  scheduledTime?: Date;
  notes?: string;
}

interface DeliveryFilters {
  agentId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

interface CompleteDeliveryData {
  codAmount?: Decimal.Value;
  proofType: DeliveryProofType;
  proofData?: string;
  proofImageUrl?: string;
  recipientName: string;
  recipientPhone?: string;
}

interface UpdateProofData {
  proofType: DeliveryProofType;
  proofData?: string;
  proofImageUrl?: string;
  recipientName?: string;
  recipientPhone?: string;
}

/** A delivery agent may only touch their own deliveries (cross-tenant rows are already a 404). */
const assertAgentOwnsDelivery = (delivery: { agentId: number | null }, requester?: Requester) => {
  if (requester?.role === 'delivery_agent' && delivery.agentId !== requester.id) {
    throw new AppError('Forbidden: this delivery is assigned to another agent', 403);
  }
};

export class DeliveryService {
  /**
   * Get all deliveries with filters
   */
  async getAllDeliveries(filters: DeliveryFilters) {

    const { agentId, page = 1, limit = 20 } = filters;

    const where: Prisma.DeliveryWhereInput = {};

    if (agentId) where.agentId = parseInt(agentId, 10);

    const skip = (page - 1) * limit;

    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        skip,
        take: limit,
        include: {
          order: {
            include: {
              customer: {
                select: {
                  firstName: true,
                  lastName: true,
                  phoneNumber: true
                }
              }
            }
          },
          agent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneNumber: true
            }
          }
        },
        orderBy: { scheduledTime: 'asc' }
      }),
      prisma.delivery.count({ where })
    ]);

    return {
      deliveries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get single delivery by ID
   */
  async getDeliveryById(deliveryId: string, requester?: Requester) {

    const delivery = await prisma.delivery.findUnique({
      where: { id: parseInt(deliveryId, 10) },
      include: {
        order: {
          include: {
            customer: true,
            orderItems: {
              include: {
                product: true
              }
            }
          }
        },
        agent: true
      }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    assertAgentOwnsDelivery(delivery, requester);
    return delivery;
  }

  /**
   * Update delivery details
   */
  async updateDelivery(deliveryId: string, updateData: Partial<CreateDeliveryData>) {

    const deliveryIdNum = parseInt(deliveryId, 10);
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryIdNum }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    const updated = await prisma.delivery.update({
      where: { id: deliveryIdNum },
      data: updateData,
      include: {
        order: true,
        agent: true
      }
    });

    logger.info('Delivery updated', { deliveryId });
    return updated;
  }

  /**
   * Upload proof of delivery
   */
  async uploadProofOfDelivery(deliveryId: string, data: UpdateProofData, requester?: Requester) {

    const deliveryIdNum = parseInt(deliveryId, 10);
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryIdNum },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    assertAgentOwnsDelivery(delivery, requester);

    const updated = await prisma.delivery.update({
      where: { id: deliveryIdNum },
      data: {
        proofType: data.proofType,
        proofData: data.proofData,
        proofImageUrl: data.proofImageUrl,
        recipientName: data.recipientName,
        recipientPhone: data.recipientPhone
      }
    });

    logger.info('Proof of delivery uploaded', {
      deliveryId,
      proofType: data.proofType
    });

    return updated;
  }

  /**
   * Complete delivery
   */
  async completeDelivery(deliveryId: string, data: CompleteDeliveryData, userId?: string, requester?: Requester) {

    const delivery = await prisma.delivery.findUnique({
      where: { id: parseInt(deliveryId, 10) },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    assertAgentOwnsDelivery(delivery, requester);

    if (delivery.actualDeliveryTime) {
      throw new AppError('Delivery already completed', 400);
    }

    // Store order data before transaction
    const orderCodAmount = delivery.order.codAmount;
    const orderId = delivery.order.id;
    // A Decimal is always truthy: an empty or zero amount from the agent falls back to the order's COD amount
    const reportedAmount = Money.tryParse(data.codAmount);
    const collectedAmount = reportedAmount && !reportedAmount.isZero()
      ? reportedAmount
      : (orderCodAmount ?? Money.ZERO);

    // The agent (or an admin completing for them) is the actor of the move
    const actor = actorOf(requester, userId ? parseInt(userId, 10) : undefined);

    // Complete delivery and update order in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update delivery
      const updatedDelivery = await tx.delivery.update({
        where: { id: parseInt(deliveryId, 10) },
        data: {
          actualDeliveryTime: new Date(),
          proofType: data.proofType,
          proofData: data.proofData,
          proofImageUrl: data.proofImageUrl,
          recipientName: data.recipientName,
          recipientPhone: data.recipientPhone
        }
      });

      // an admin completing for the assigned agent leaves a trace
      if ((requester?.role === 'admin' || requester?.role === 'super_admin') && delivery.agentId !== requester.id) {
        await tx.auditLog.create({
          data: {
            tenantId: resolveTenantId(delivery.tenantId),
            userId: requester.id,
            action: 'complete_delivery_for_agent',
            resource: 'delivery',
            resourceId: deliveryId,
            metadata: { agentId: delivery.agentId }
          }
        });
      }

      // Move the order to delivered through the state machine. D8: this writer does no stock work.
      // D14: it posts revenue whatever the codAmount. The posting is the machine's shared one and
      // idempotent (active-entry guard), so a repeat or an earlier status-path post leaves one entry.
      const moved = await transitionOrder(delivery.orderId, 'delivered', actor, {
        note: 'Order delivered successfully',
        paymentStatus: 'collected',
        postRevenueAlways: true,
        skipLegacyStock: true,
        tx,
      });

      // Create transaction for COD collection
      await tx.transaction.create({
        data: {
          orderId: delivery.orderId,
          type: 'cod_collection',
          amount: collectedAmount,
          paymentMethod: 'cash',
          status: 'collected',
          description: 'COD payment collected on delivery',
          metadata: {
            deliveryId: parseInt(deliveryId, 10),
            collectedBy: delivery.agentId
          }
        }
      });

      // The machine posted the revenue entry (and set the flag and the order link) in the move's transaction.
      // A move that changed nothing (already delivered) posts nothing.
      const glEntry = moved.gl?.revenue ?? null;
      const orderWithItems = moved.gl?.revenueOrder;
      if (!glEntry || !orderWithItems) {
        logger.warn(`Order ${delivery.orderId} revenue already recognized. Skipping GL entry.`);
        return { delivery: updatedDelivery, glEntry: null, moved };
      }

      // Validate COGS and log warnings for missing values
      const cogsValidation = GLAutomationService.validateCOGS(orderWithItems.orderItems);
      if (!cogsValidation.valid) {
        GLAutomationService.logMissingCOGS(orderWithItems.id, cogsValidation.missingProducts);
      }

      logger.info(`GL entry created for order ${orderWithItems.id}: ${glEntry.entryNumber}`);

      // Create draft agent collection record with net amount (gross - agent commission)
      if (orderWithItems.deliveryAgentId && Money.isNonZero(orderWithItems.codAmount)) {
        const grossAmount = Money.orZero(orderWithItems.codAmount);
        // Uses profile flat rate — must match createRevenueRecognitionEntry in glAutomationService
        const agentCommission = Money.orZero(orderWithItems.deliveryAgent?.commissionAmount);
        const netAmount = Money.sub(grossAmount, agentCommission);

        await agentReconciliationService.createDraftCollection(
          tx,
          orderWithItems.id,
          orderWithItems.deliveryAgentId,
          netAmount,
          updatedDelivery.actualDeliveryTime || new Date()
        );
      }

      return { delivery: updatedDelivery, glEntry, moved };
    });
    result.moved.afterCommit?.();

    logger.info(`Delivery completed for order: ${orderId}`, {
      deliveryId,
      orderId: delivery.orderId,
      glEntryCreated: !!result.glEntry
    });

    // Emit Socket.io event for GL entry creation (non-blocking)
    if (result.glEntry) {
      setImmediate(() => {
        try {
          const ioInstance = getSocketInstance() as any;
          if (ioInstance) {
            emitGLEntryCreated(ioInstance, result.glEntry, {
              orderId: delivery.order.id,
              orderNumber: delivery.order.id.toString(),
              type: 'revenue_recognition'
            });
          }
        } catch (error) {
          logger.error('Failed to emit GL entry created event', { error, deliveryId });
        }
      });
    }

    return {
      message: 'Delivery completed successfully',
      glEntry: result.glEntry ? {
        id: result.glEntry.id,
        entryNumber: result.glEntry.entryNumber
      } : null
    };
  }

  /** Shared includes for order-based delivery queries */
  private static readonly deliverySelect = {
    id: true, scheduledTime: true, actualDeliveryTime: true,
    deliveryAttempts: true, proofType: true, proofData: true,
    proofImageUrl: true, recipientName: true, recipientPhone: true,
    notes: true, createdAt: true, updatedAt: true,
  } as const;

  private static readonly customerSelect = {
    firstName: true, lastName: true, phoneNumber: true,
  } as const;

  private static readonly agentSelect = {
    id: true, firstName: true, lastName: true, phoneNumber: true,
  } as const;

  /** Transform an Order (with delivery/customer/agent) to DeliveryListItem-compatible shape */
  private mapOrderToDeliveryItem(order: any, extraOrderFields?: Record<string, unknown>) {
    const d = order.delivery;
    return {
      id: d?.id ?? -order.id,
      orderId: order.id,
      agentId: order.deliveryAgentId,
      scheduledTime: d?.scheduledTime?.toISOString() ?? null,
      actualDeliveryTime: d?.actualDeliveryTime?.toISOString() ?? null,
      deliveryAttempts: d?.deliveryAttempts ?? 0,
      proofType: d?.proofType ?? null,
      proofData: d?.proofData ?? null,
      proofImageUrl: d?.proofImageUrl ?? null,
      recipientName: d?.recipientName ?? null,
      recipientPhone: d?.recipientPhone ?? null,
      notes: d?.notes ?? null,
      createdAt: (d?.createdAt ?? order.createdAt).toISOString(),
      updatedAt: (d?.updatedAt ?? order.updatedAt).toISOString(),
      order: {
        id: order.id,
        status: order.status,
        totalAmount: Money.orZero(order.totalAmount),
        paymentStatus: order.paymentStatus,
        deliveryAddress: order.deliveryAddress ?? '',
        deliveryState: order.deliveryState ?? '',
        deliveryArea: order.deliveryArea ?? '',
        notes: order.notes,
        customer: order.customer
          ? {
              firstName: order.customer.firstName,
              lastName: order.customer.lastName,
              phoneNumber: order.customer.phoneNumber,
            }
          : null,
        ...extraOrderFields,
      },
      agent: order.deliveryAgent
        ? {
            id: order.deliveryAgent.id,
            firstName: order.deliveryAgent.firstName,
            lastName: order.deliveryAgent.lastName,
            phoneNumber: order.deliveryAgent.phoneNumber,
          }
        : null,
    };
  }

  /**
   * Get all orders assigned to a delivery agent (queries Order table, not Delivery table)
   */
  async getAgentOrders(agentId: number, filters?: { status?: string; page?: number; limit?: number; search?: string; startDate?: string; endDate?: string }) {
    const { page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    // Active statuses are always shown (no date filter); terminal statuses are date-filtered
    const ACTIVE_STATUSES: OrderStatus[] = ['ready_for_pickup', 'out_for_delivery'];
    const TERMINAL_STATUSES: OrderStatus[] = ['delivered', 'failed_delivery'];

    const hasDateFilter = !!(filters?.startDate || filters?.endDate);
    const zone = getStoreTimeZone(getTenantId());
    const dateCondition: Prisma.OrderWhereInput = {};
    if (hasDateFilter) {
      dateCondition.createdAt = {};
      if (filters!.startDate) {
        try {
          dateCondition.createdAt.gte = parseInclusiveBound(filters!.startDate, 'from', zone);
        } catch {
          throw new AppError('Invalid startDate', 400);
        }
      }
      if (filters!.endDate) {
        try {
          dateCondition.createdAt.lte = parseInclusiveBound(filters!.endDate, 'to', zone);
        } catch {
          throw new AppError('Invalid endDate', 400);
        }
      }
    }

    // Build the base where clause
    // When date filter is present: active statuses (no date) OR terminal statuses (with date)
    const baseWhere: Prisma.OrderWhereInput = {
      deliveryAgentId: agentId,
      deletedAt: null,
    };

    if (hasDateFilter) {
      baseWhere.OR = [
        { status: { in: ACTIVE_STATUSES } },
        { status: { in: TERMINAL_STATUSES }, ...dateCondition },
      ];
    } else {
      baseWhere.status = { in: [...ACTIVE_STATUSES, ...TERMINAL_STATUSES] };
    }

    const where: Prisma.OrderWhereInput = { ...baseWhere };

    if (filters?.status) {
      const statuses = filters.status.split(',').map(s => s.trim());
      // Override status filter but preserve date logic for terminal statuses
      if (hasDateFilter) {
        const requestedActive = statuses.filter(s => ACTIVE_STATUSES.includes(s as OrderStatus)) as OrderStatus[];
        const requestedTerminal = statuses.filter(s => TERMINAL_STATUSES.includes(s as OrderStatus)) as OrderStatus[];
        const orConditions: Prisma.OrderWhereInput[] = [];
        if (requestedActive.length > 0) {
          orConditions.push({ status: { in: requestedActive } });
        }
        if (requestedTerminal.length > 0) {
          orConditions.push({ status: { in: requestedTerminal }, ...dateCondition });
        }
        if (orConditions.length > 0) {
          delete where.OR;
          delete where.status;
          where.OR = orConditions;
        }
      } else {
        where.status = statuses.length === 1 ? statuses[0] as any : { in: statuses } as any;
      }
    }

    if (filters?.search) {
      const term = filters.search.trim();
      const numericId = parseInt(term, 10);
      const phoneSearch = customerPhoneSearch(term);
      // When we already have OR (from date filtering), wrap in AND
      const searchOr: Prisma.OrderWhereInput[] = [
        { customer: { firstName: { contains: term, mode: 'insensitive' } } },
        { customer: { lastName: { contains: term, mode: 'insensitive' } } },
        ...(phoneSearch ? [phoneSearch] : []),
        { deliveryAddress: { contains: term, mode: 'insensitive' } },
        { deliveryArea: { contains: term, mode: 'insensitive' } },
        ...(Number.isFinite(numericId) && numericId <= 2147483647 ? [{ id: numericId }] : []),
      ];
      if (where.OR) {
        // Combine existing OR (date/status) with search OR via AND
        const existingOr = where.OR;
        delete where.OR;
        where.AND = [
          { OR: existingOr },
          { OR: searchOr },
        ];
      } else {
        where.OR = searchOr;
      }
    }

    // Count where: includes search + date filter but NOT tab status filter, so each tab gets its own count
    const countWhere: Prisma.OrderWhereInput = {
      deliveryAgentId: agentId,
      deletedAt: null,
    };
    if (hasDateFilter) {
      countWhere.OR = [
        { status: { in: ACTIVE_STATUSES } },
        { status: { in: TERMINAL_STATUSES }, ...dateCondition },
      ];
    } else {
      countWhere.status = { in: [...ACTIVE_STATUSES, ...TERMINAL_STATUSES] };
    }
    if (filters?.search) {
      const term = filters.search.trim();
      const numericId = parseInt(term, 10);
      const phoneSearch = customerPhoneSearch(term);
      const searchOr: Prisma.OrderWhereInput[] = [
        { customer: { firstName: { contains: term, mode: 'insensitive' } } },
        { customer: { lastName: { contains: term, mode: 'insensitive' } } },
        ...(phoneSearch ? [phoneSearch] : []),
        { deliveryAddress: { contains: term, mode: 'insensitive' } },
        { deliveryArea: { contains: term, mode: 'insensitive' } },
        ...(Number.isFinite(numericId) && numericId <= 2147483647 ? [{ id: numericId }] : []),
      ];
      if (countWhere.OR) {
        const existingOr = countWhere.OR;
        delete countWhere.OR;
        countWhere.AND = [
          { OR: existingOr },
          { OR: searchOr },
        ];
      } else {
        countWhere.OR = searchOr;
      }
    }

    const [orders, total, statusGroups] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          customer: { select: DeliveryService.customerSelect },
          delivery: { select: DeliveryService.deliverySelect },
          deliveryAgent: { select: DeliveryService.agentSelect },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ['status'],
        where: countWhere,
        _count: true,
      }),
    ]);

    const deliveries = orders.map((order) => this.mapOrderToDeliveryItem(order));

    const statusCounts: Record<string, number> = {};
    let allCount = 0;
    for (const g of statusGroups) {
      statusCounts[g.status] = g._count;
      allCount += g._count;
    }
    statusCounts.all = allCount;

    return {
      deliveries,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      statusCounts,
    };
  }

  /**
   * Get delivery info by order ID (for orders that may not have a Delivery record)
   */
  async getDeliveryByOrderId(orderId: number, agentUserId?: number) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, ...(agentUserId != null && { deliveryAgentId: agentUserId }) },
      include: {
        customer: { select: DeliveryService.customerSelect },
        orderItems: { include: { product: { select: { id: true, name: true } } } },
        delivery: { select: DeliveryService.deliverySelect },
        deliveryAgent: { select: DeliveryService.agentSelect },
      },
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    return this.mapOrderToDeliveryItem(order, {
      orderItems: order.orderItems.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        product: { id: item.product.id, name: item.product.name },
      })),
    });
  }
}

export default new DeliveryService();
