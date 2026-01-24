import { Prisma, DeliveryProofType } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import { SYSTEM_USER_ID } from '../config/constants';
import { GLAutomationService } from './glAutomationService';
import agentReconciliationService from './agentReconciliationService';
import { getSocketInstance } from '../utils/socketInstance';
import { emitGLEntryCreated } from '../sockets/index';

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
  async getDeliveryById(deliveryId: string) {
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

    return delivery;
  }

  /**
   * Create new delivery assignment
   */
  async createDelivery(data: CreateDeliveryData) {
    // Validate order exists and is ready for delivery
    const order = await prisma.order.findUnique({
      where: { id: data.orderId }
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
    const existingDelivery = await prisma.delivery.findUnique({
      where: { orderId: data.orderId }
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
        notes: data.notes
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
      where: { id: data.orderId },
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
  async uploadProofOfDelivery(deliveryId: string, data: UpdateProofData) {
    const deliveryIdNum = parseInt(deliveryId, 10);
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryIdNum },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

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
  async completeDelivery(deliveryId: string, data: CompleteDeliveryData, userId?: string) {
    const delivery = await prisma.delivery.findUnique({
      where: { id: parseInt(deliveryId, 10) },
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

      // Update order status
      await tx.order.update({
        where: { id: delivery.orderId },
        data: {
          status: 'delivered',
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
      const orderWithItems = await tx.order.findUnique({
        where: { id: delivery.orderId },
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
        where: { id: delivery.orderId },
        data: {
          revenueRecognized: true,
          glJournalEntryId: glEntry.id
        }
      });

      logger.info(`GL entry created for order ${orderWithItems.id}: ${glEntry.entryNumber}`);

      // Create draft agent collection record
      if (orderWithItems.deliveryAgentId && orderWithItems.codAmount) {
        await agentReconciliationService.createDraftCollection(
          tx,
          orderWithItems.id,
          orderWithItems.deliveryAgentId,
          orderWithItems.codAmount,
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
    const delivery = await prisma.delivery.findUnique({
      where: { id: parseInt(deliveryId, 10) },
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
