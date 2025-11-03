import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { DeliveryProofType, Prisma } from '@prisma/client';
import logger from '../utils/logger';

interface CreateDeliveryData {
  orderId: string;
  agentId: string;
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
    if (agentId) where.agentId = agentId;

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
      where: { id: deliveryId },
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
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    const updated = await prisma.delivery.update({
      where: { id: deliveryId },
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
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    const updated = await prisma.delivery.update({
      where: { id: deliveryId },
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
      where: { id: deliveryId },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    if (delivery.actualDeliveryTime) {
      throw new AppError('Delivery already completed', 400);
    }

    // Complete delivery and update order in transaction
    await prisma.$transaction(async (tx) => {
      // Update delivery
      await tx.delivery.update({
        where: { id: deliveryId },
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
              changedBy: userId
            }
          }
        }
      });

      // Create transaction for COD collection
      await tx.transaction.create({
        data: {
          orderId: delivery.orderId,
          type: 'cod_collection',
          amount: data.codAmount || delivery.order.codAmount || 0,
          paymentMethod: 'cash',
          status: 'collected',
          description: 'COD payment collected on delivery',
          metadata: {
            deliveryId: delivery.id,
            collectedBy: delivery.agentId
          }
        }
      });
    });

    logger.info(`Delivery completed for order: ${delivery.order.id}`, {
      deliveryId,
      orderId: delivery.orderId
    });

    return { message: 'Delivery completed successfully' };
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
      where: { id: deliveryId },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    await prisma.$transaction(async (tx) => {
      // Increment delivery attempts
      await tx.delivery.update({
        where: { id: deliveryId },
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
              changedBy: userId,
              metadata: { deliveryId, reason, reschedule }
            }
          }
        }
      });
    });

    logger.warn(`Delivery failed for order: ${delivery.order.id}`, {
      deliveryId,
      reason,
      reschedule
    });

    return { message: 'Delivery marked as failed' };
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
        agentId,
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
      orderNumber: d.order.id,
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
      where: { id: orderId }
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
      orderId,
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
    const where: Prisma.DeliveryWhereInput = { agentId };

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [totalDeliveries, completedDeliveries, failedDeliveries, deliveries] = await Promise.all([
      prisma.delivery.count({ where }),
      prisma.delivery.count({
        where: {
          ...where,
          actualDeliveryTime: { not: null }
        }
      }),
      prisma.delivery.count({
        where: {
          ...where,
          deliveryAttempts: { gt: 1 }
        }
      }),
      prisma.delivery.findMany({
        where: {
          ...where,
          actualDeliveryTime: { not: null },
          scheduledTime: { not: null }
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
