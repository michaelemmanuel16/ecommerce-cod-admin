import { Prisma, DeliveryProofType, OrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import { SYSTEM_USER_ID } from '../config/constants';
import { GLAutomationService } from './glAutomationService';
import agentReconciliationService from './agentReconciliationService';
import { getSocketInstance } from '../utils/socketInstance';
import { emitGLEntryCreated } from '../sockets/index';
import { getTenantId } from '../utils/tenantContext';

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
  codAmount?: number;
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

export class DeliveryService {
  /**
   * Get all deliveries with filters
   */
  async getAllDeliveries(filters: DeliveryFilters) {
    const tenantId = getTenantId();
    const { agentId, page = 1, limit = 20 } = filters;

    const where: Prisma.DeliveryWhereInput = {
      ...(tenantId ? { tenantId } : {})
    };
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
  async getDeliveryById(deliveryId: string) {
    const tenantId = getTenantId();
    const delivery = await prisma.delivery.findFirst({
      where: { id: parseInt(deliveryId, 10), ...(tenantId ? { tenantId } : {}) },
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

    return delivery;
  }

  /**
   * Create new delivery assignment
   */
  async createDelivery(data: CreateDeliveryData) {
    const tenantId = getTenantId();
    // Validate order exists and is ready for delivery
    const order = await prisma.order.findFirst({
      where: { id: data.orderId, ...(tenantId ? { tenantId } : {}) }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (!['ready_for_pickup', 'confirmed', 'preparing'].includes(order.status)) {
      throw new AppError(
        'Order must be confirmed, preparing, or ready for pickup before delivery assignment',
        400
      );
    }

    // Check if delivery already exists
    const existingDelivery = await prisma.delivery.findFirst({
      where: { orderId: data.orderId, ...(tenantId ? { tenantId } : {}) }
    });

    if (existingDelivery) {
      throw new AppError('Delivery already exists for this order', 400);
    }

    // Validate agent exists and is available
    const agent = await prisma.user.findUnique({
      where: { id: data.agentId }
    });

    if (!agent || agent.role !== 'delivery_agent') {
      throw new AppError('Invalid delivery agent', 400);
    }

    if (!agent.isAvailable) {
      throw new AppError('Delivery agent is not available', 400);
    }

    const delivery = await prisma.delivery.create({
      data: {
        orderId: data.orderId,
        agentId: data.agentId,
        scheduledTime: data.scheduledTime || new Date(),
        notes: data.notes,
        ...(tenantId ? { tenantId } : {})
      },
      include: {
        order: {
          include: {
            customer: true
          }
        },
        agent: true
      }
    });

    // Update order with delivery agent
    await prisma.order.update({
      where: { id: data.orderId, ...(tenantId ? { tenantId } : {}) },
      data: {
        deliveryAgentId: data.agentId,
        status: order.status === 'ready_for_pickup' ? 'out_for_delivery' : order.status,
        orderHistory: {
          create: {
            status: order.status === 'ready_for_pickup' ? 'out_for_delivery' : order.status,
            notes: 'Delivery assigned',
            metadata: { deliveryId: delivery.id, agentId: data.agentId }
          }
        }
      }
    });

    logger.info(`Delivery created for order: ${order.id}`, {
      deliveryId: delivery.id,
      orderId: data.orderId,
      agentId: data.agentId
    });

    return delivery;
  }

  /**
   * Update delivery details
   */
  async updateDelivery(deliveryId: string, updateData: Partial<CreateDeliveryData>) {
    const tenantId = getTenantId();
    const deliveryIdNum = parseInt(deliveryId, 10);
    const delivery = await prisma.delivery.findFirst({
      where: { id: deliveryIdNum, ...(tenantId ? { tenantId } : {}) }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    const updated = await prisma.delivery.update({
      where: { id: deliveryIdNum, ...(tenantId ? { tenantId } : {}) },
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
  async uploadProofOfDelivery(deliveryId: string, data: UpdateProofData) {
    const tenantId = getTenantId();
    const deliveryIdNum = parseInt(deliveryId, 10);
    const delivery = await prisma.delivery.findFirst({
      where: { id: deliveryIdNum, ...(tenantId ? { tenantId } : {}) },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    const updated = await prisma.delivery.update({
      where: { id: deliveryIdNum, ...(tenantId ? { tenantId } : {}) },
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
  async completeDelivery(deliveryId: string, data: CompleteDeliveryData, userId?: string) {
    const tenantId = getTenantId();
    const delivery = await prisma.delivery.findFirst({
      where: { id: parseInt(deliveryId, 10), ...(tenantId ? { tenantId } : {}) },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    if (delivery.actualDeliveryTime) {
      throw new AppError('Delivery already completed', 400);
    }

    // Store order data before transaction
    const orderCodAmount = delivery.order.codAmount;
    const orderId = delivery.order.id;

    // Complete delivery and update order in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update delivery
      const updatedDelivery = await tx.delivery.update({
        where: { id: parseInt(deliveryId, 10), ...(tenantId ? { tenantId } : {}) },
        data: {
          actualDeliveryTime: new Date(),
          proofType: data.proofType,
          proofData: data.proofData,
          proofImageUrl: data.proofImageUrl,
          recipientName: data.recipientName,
          recipientPhone: data.recipientPhone
        }
      });

      // Update order status
      await tx.order.update({
        where: { id: delivery.orderId, ...(tenantId ? { tenantId } : {}) },
        data: {
          status: 'delivered',
          deliveryDate: new Date(),
          paymentStatus: 'collected',
          orderHistory: {
            create: {
              status: 'delivered',
              notes: 'Order delivered successfully',
              changedBy: userId ? parseInt(userId, 10) : null
            }
          }
        }
      });

      // Create transaction for COD collection
      await tx.transaction.create({
        data: {
          orderId: delivery.orderId,
          type: 'cod_collection',
          amount: data.codAmount || orderCodAmount || 0,
          paymentMethod: 'cash',
          status: 'collected',
          description: 'COD payment collected on delivery',
          metadata: {
            deliveryId: parseInt(deliveryId, 10),
            collectedBy: delivery.agentId
          }
        }
      });

      // Fetch order with items and products for GL entry creation
      const orderWithItems = await tx.order.findFirst({
        where: { id: delivery.orderId, ...(tenantId ? { tenantId } : {}) },
        include: {
          customer: true,
          deliveryAgent: true,
          customerRep: true,
          orderItems: {
            include: {
              product: true
            }
          }
        }
      });

      if (!orderWithItems) {
        throw new AppError('Order not found for GL entry creation', 404);
      }

      // Check if revenue already recognized (prevent duplicate GL entries)
      if (GLAutomationService.isRevenueAlreadyRecognized(orderWithItems)) {
        logger.warn(`Order ${orderWithItems.id} revenue already recognized. Skipping GL entry.`);
        return { delivery: updatedDelivery, glEntry: null };
      }

      // Calculate total COGS
      const totalCOGS = GLAutomationService.calculateTotalCOGS(orderWithItems.orderItems);

      // Validate COGS and log warnings for missing values
      const cogsValidation = GLAutomationService.validateCOGS(orderWithItems.orderItems);
      if (!cogsValidation.valid) {
        GLAutomationService.logMissingCOGS(orderWithItems.id, cogsValidation.missingProducts);
      }

      const glEntry = await GLAutomationService.createRevenueRecognitionEntry(
        tx as any,
        orderWithItems as any,
        totalCOGS,
        userId ? parseInt(userId, 10) : SYSTEM_USER_ID
      );

      // Update order with revenue recognized flag and GL entry link
      await tx.order.update({
        where: { id: delivery.orderId, ...(tenantId ? { tenantId } : {}) },
        data: {
          revenueRecognized: true,
          glJournalEntryId: glEntry.id
        }
      });

      logger.info(`GL entry created for order ${orderWithItems.id}: ${glEntry.entryNumber}`);

      // Create draft agent collection record with net amount (gross - agent commission)
      if (orderWithItems.deliveryAgentId && orderWithItems.codAmount) {
        const grossAmount = new Decimal(orderWithItems.codAmount.toString());
        // Uses profile flat rate — must match createRevenueRecognitionEntry in glAutomationService
        const agentCommission = orderWithItems.deliveryAgent?.commissionAmount
          ? new Decimal(orderWithItems.deliveryAgent.commissionAmount.toString())
          : new Decimal(0);
        const netAmount = grossAmount.minus(agentCommission);

        await agentReconciliationService.createDraftCollection(
          tx,
          orderWithItems.id,
          orderWithItems.deliveryAgentId,
          netAmount.toNumber(),
          updatedDelivery.actualDeliveryTime || new Date()
        );
      }

      return { delivery: updatedDelivery, glEntry };
    });

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

  /**
   * Mark delivery as failed
   */
  async markDeliveryFailed(
    deliveryId: string,
    reason: string,
    userId?: string,
    reschedule?: boolean
  ) {
    const tenantId = getTenantId();
    const delivery = await prisma.delivery.findFirst({
      where: { id: parseInt(deliveryId, 10), ...(tenantId ? { tenantId } : {}) },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    // Store order ID before transaction
    const orderId = delivery.order.id;

    const result = await prisma.$transaction(async (tx) => {
      // Increment delivery attempts
      const updatedDelivery = await tx.delivery.update({
        where: { id: parseInt(deliveryId, 10) },
        data: {
          deliveryAttempts: { increment: 1 },
          notes: `Failed delivery attempt: ${reason}`
        }
      });

      // Update order status
      const newStatus = reschedule ? 'ready_for_pickup' : 'failed_delivery';
      await tx.order.update({
        where: { id: delivery.orderId },
        data: {
          status: newStatus,
          orderHistory: {
            create: {
              status: newStatus,
              notes: `Delivery failed: ${reason}`,
              changedBy: userId ? parseInt(userId, 10) : null,
              metadata: { deliveryId: parseInt(deliveryId, 10), reason, reschedule }
            }
          }
        }
      });

      // Create GL entry for failed delivery expense (only if not rescheduling)
      let glEntry = null;
      if (!reschedule) {
        glEntry = await GLAutomationService.createFailedDeliveryEntry(
          tx as any,
          updatedDelivery,
          delivery.order as any, // Cast as any because of potential include mismatches
          userId ? parseInt(userId, 10) : SYSTEM_USER_ID
        );
        logger.info(`GL entry created for failed delivery ${deliveryId}: ${glEntry.entryNumber}`);
      }

      return { glEntry };
    });

    logger.warn(`Delivery failed for order: ${orderId}`, {
      deliveryId,
      reason,
      reschedule,
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
              type: 'failed_delivery'
            });
          }
        } catch (error) {
          logger.error('Failed to emit GL entry created event', { error, deliveryId });
        }
      });
    }

    return {
      message: 'Delivery marked as failed',
      glEntry: result.glEntry ? {
        id: result.glEntry.id,
        entryNumber: result.glEntry.entryNumber
      } : null
    };
  }

  /**
   * Get agent's delivery route for a specific date
   */
  async getAgentRoute(agentId: string, date?: Date) {
    const targetDate = date || new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const deliveries = await prisma.delivery.findMany({
      where: {
        agentId: parseInt(agentId, 10),
        scheduledTime: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
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
        }
      },
      orderBy: { scheduledTime: 'asc' }
    });

    const route = deliveries.map((d) => ({
      deliveryId: d.id,
      orderId: d.orderId,
      customer: d.order.customer,
      address: d.order.deliveryAddress,
      area: d.order.deliveryArea,
      scheduledTime: d.scheduledTime,
      status: d.order.status,
      codAmount: d.order.codAmount,
      notes: d.notes,
      deliveryAttempts: d.deliveryAttempts
    }));

    return route;
  }

  /**
   * Auto-assign delivery agent based on area and availability
   */
  async autoAssignAgent(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId, 10) }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Find available agents in the same area
    const availableAgents = await prisma.user.findMany({
      where: {
        role: 'delivery_agent',
        isActive: true,
        isAvailable: true
      },
      include: {
        assignedOrdersAsAgent: {
          where: {
            deliveryArea: order.deliveryArea,
            status: {
              in: ['out_for_delivery', 'ready_for_pickup']
            }
          }
        }
      }
    });

    if (availableAgents.length === 0) {
      throw new AppError('No available delivery agents found', 404);
    }

    // Sort by least assigned orders (load balancing)
    availableAgents.sort(
      (a, b) => a.assignedOrdersAsAgent.length - b.assignedOrdersAsAgent.length
    );

    const selectedAgent = availableAgents[0];

    // Create delivery assignment
    const delivery = await this.createDelivery({
      orderId: parseInt(orderId, 10),
      agentId: selectedAgent.id,
      scheduledTime: new Date()
    });

    logger.info(`Auto-assigned delivery agent: ${selectedAgent.firstName} ${selectedAgent.lastName}`, {
      orderId,
      agentId: selectedAgent.id
    });

    return delivery;
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
        totalAmount: order.totalAmount ? Number(order.totalAmount) : 0,
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
    const dateCondition: Prisma.OrderWhereInput = {};
    if (hasDateFilter) {
      dateCondition.createdAt = {};
      if (filters!.startDate) {
        const parsed = new Date(filters!.startDate);
        if (isNaN(parsed.getTime())) throw new AppError('Invalid startDate', 400);
        dateCondition.createdAt.gte = parsed;
      }
      if (filters!.endDate) {
        const parsed = new Date(filters!.endDate);
        if (isNaN(parsed.getTime())) throw new AppError('Invalid endDate', 400);
        dateCondition.createdAt.lte = parsed;
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
      // When we already have OR (from date filtering), wrap in AND
      const searchOr: Prisma.OrderWhereInput[] = [
        { customer: { firstName: { contains: term, mode: 'insensitive' } } },
        { customer: { lastName: { contains: term, mode: 'insensitive' } } },
        { customer: { phoneNumber: { contains: term } } },
        { deliveryAddress: { contains: term, mode: 'insensitive' } },
        { deliveryArea: { contains: term, mode: 'insensitive' } },
        ...(Number.isFinite(numericId) ? [{ id: numericId }] : []),
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
      const searchOr: Prisma.OrderWhereInput[] = [
        { customer: { firstName: { contains: term, mode: 'insensitive' } } },
        { customer: { lastName: { contains: term, mode: 'insensitive' } } },
        { customer: { phoneNumber: { contains: term } } },
        { deliveryAddress: { contains: term, mode: 'insensitive' } },
        { deliveryArea: { contains: term, mode: 'insensitive' } },
        ...(Number.isFinite(numericId) ? [{ id: numericId }] : []),
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
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        product: { id: item.product.id, name: item.product.name },
      })),
    });
  }

  /**
   * Get delivery statistics for an agent
   */
  async getAgentStats(agentId: string, filters?: { startDate?: Date; endDate?: Date }) {
    const where: Prisma.DeliveryWhereInput = { agentId: parseInt(agentId, 10) };

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [totalDeliveries, completedDeliveries, failedDeliveries, deliveries] = await Promise.all([
      prisma.delivery.count({
        where: {
          ...where,
          order: { deletedAt: null }
        }
      }),
      prisma.delivery.count({
        where: {
          ...where,
          actualDeliveryTime: { not: null },
          order: { deletedAt: null }
        }
      }),
      prisma.delivery.count({
        where: {
          ...where,
          deliveryAttempts: { gt: 1 },
          order: { deletedAt: null }
        }
      }),
      prisma.delivery.findMany({
        where: {
          ...where,
          actualDeliveryTime: { not: null },
          scheduledTime: { not: null },
          order: { deletedAt: null }
        },
        select: {
          scheduledTime: true,
          actualDeliveryTime: true
        }
      })
    ]);

    // Calculate on-time delivery rate
    let onTimeDeliveries = 0;
    let totalDeliveryTime = 0;

    deliveries.forEach((d) => {
      if (d.scheduledTime && d.actualDeliveryTime) {
        const diff = d.actualDeliveryTime.getTime() - d.scheduledTime.getTime();
        totalDeliveryTime += diff;

        if (d.actualDeliveryTime <= d.scheduledTime) {
          onTimeDeliveries++;
        }
      }
    });

    const avgDeliveryTime =
      deliveries.length > 0
        ? Math.round(totalDeliveryTime / deliveries.length / (1000 * 60)) // Convert to minutes
        : 0;

    const onTimeRate = deliveries.length > 0 ? (onTimeDeliveries / deliveries.length) * 100 : 0;

    return {
      totalDeliveries,
      completedDeliveries,
      failedDeliveries,
      pendingDeliveries: totalDeliveries - completedDeliveries,
      successRate: totalDeliveries > 0 ? (completedDeliveries / totalDeliveries) * 100 : 0,
      onTimeRate,
      avgDeliveryTime
    };
  }
}

export default new DeliveryService();
