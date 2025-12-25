import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { OrderStatus, Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { workflowQueue } from '../queues/workflowQueue';
import { io } from '../server';
import { emitOrderAssigned, emitOrderUpdated } from '../sockets/index';

interface CreateOrderData {
  customerId?: number;
  customerPhone?: string;
  customerEmail?: string;
  customerName?: string;
  alternatePhone?: string;
  orderItems: Array<{
    productId: number;
    quantity: number;
    unitPrice: number;
    itemType?: 'package' | 'upsell';
    metadata?: any;
  }>;
  subtotal: number;
  shippingCost?: number;
  discount?: number;
  totalAmount: number;
  deliveryAddress: string;
  deliveryState: string;
  deliveryArea: string;
  notes?: string;
  estimatedDelivery?: Date;
  createdById?: number;
}

interface BulkImportOrderData {
  customerPhone: string;
  customerFirstName?: string;
  customerLastName?: string;
  subtotal: number;
  totalAmount: number;
  deliveryAddress: string;
  deliveryState: string;
  deliveryArea: string;
  notes?: string;
}

interface OrderFilters {
  status?: OrderStatus[];
  customerId?: number;
  customerRepId?: number;
  deliveryAgentId?: number;
  area?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

interface UpdateOrderStatusData {
  status: OrderStatus;
  notes?: string;
  changedBy?: number;
}

export class OrderService {
  /**
   * Generate unique order number
   */
  private async generateOrderNumber(): Promise<string> {
    const count = await prisma.order.count();
    return String(1000 + count + 1);
  }

  /**
   * Get all orders with filters and pagination
   */
  async getAllOrders(filters: OrderFilters) {
    const {
      status,
      customerId,
      customerRepId,
      deliveryAgentId,
      area,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 20
    } = filters;

    const where: Prisma.OrderWhereInput = {};

    if (status && status.length > 0) where.status = { in: status };
    if (customerId) where.customerId = customerId;
    if (customerRepId) where.customerRepId = customerRepId;
    if (deliveryAgentId) where.deliveryAgentId = deliveryAgentId;
    if (area) where.deliveryArea = area;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    if (search) {
      // Try to parse as number for ID search
      const searchNum = parseInt(search);
      where.OR = [
        ...(isNaN(searchNum) ? [] : [{ id: searchNum }]),
        { customer: { phoneNumber: { contains: search, mode: 'insensitive' } } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
              alternatePhone: true
            }
          },
          customerRep: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          },
          deliveryAgent: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          },
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.order.count({ where })
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Create a new order
   */
  async createOrder(data: CreateOrderData) {
    // Find or create customer
    let customer;

    if (data.customerId) {
      // Use existing customer ID
      customer = await prisma.customer.findUnique({
        where: { id: data.customerId }
      });

      if (!customer) {
        throw new AppError('Customer not found', 404);
      }
    } else if (data.customerPhone) {
      // Find customer by phone or create new one
      customer = await prisma.customer.findUnique({
        where: { phoneNumber: data.customerPhone }
      });

      if (!customer) {
        // Parse customer name
        const nameParts = (data.customerName || '').trim().split(' ');
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || '';

        // Create new customer
        customer = await prisma.customer.create({
          data: {
            firstName,
            lastName,
            phoneNumber: data.customerPhone,
            email: data.customerEmail || null,
            alternatePhone: data.alternatePhone || null,
            address: data.deliveryAddress,
            state: data.deliveryState,
            area: data.deliveryArea
          }
        });
      } else if (data.alternatePhone && customer.alternatePhone !== data.alternatePhone) {
        // Update alternate phone if provided and different
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: { alternatePhone: data.alternatePhone }
        });
      }
    } else {
      throw new AppError('Either customerId or customerPhone must be provided', 400);
    }

    // Validate products exist and have sufficient stock
    for (const item of data.orderItems) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId }
      });

      if (!product) {
        throw new AppError(`Product ${item.productId} not found`, 404);
      }

      if (product.stockQuantity < item.quantity) {
        throw new AppError(
          `Insufficient stock for product ${product.name}. Available: ${product.stockQuantity}`,
          400
        );
      }
    }

    // Create order in transaction
    const order = await prisma.$transaction(async (tx) => {
      // Create order
      const newOrder = await tx.order.create({
        data: {
          customerId: customer.id,
          subtotal: data.subtotal,
          shippingCost: data.shippingCost || 0,
          discount: data.discount || 0,
          totalAmount: data.totalAmount,
          codAmount: data.totalAmount,
          deliveryAddress: data.deliveryAddress,
          deliveryState: data.deliveryState,
          deliveryArea: data.deliveryArea,
          notes: data.notes,
          estimatedDelivery: data.estimatedDelivery || null,
          createdById: data.createdById,
          orderItems: {
            create: data.orderItems.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
              itemType: item.itemType || 'package',
              metadata: item.metadata || null
            }))
          },
          orderHistory: {
            create: {
              status: 'pending_confirmation',
              notes: 'Order created',
              changedBy: data.createdById
            }
          }
        },
        include: {
          customer: true,
          orderItems: {
            include: {
              product: true
            }
          }
        }
      });

      // Update product stock
      for (const item of data.orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: {
              decrement: item.quantity
            }
          }
        });
      }

      // Update customer stats
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          totalOrders: { increment: 1 },
          totalSpent: { increment: data.totalAmount }
        }
      });

      return newOrder;
    });

    logger.info(`Order created`, { orderId: order.id });

    // Trigger workflows with order_created trigger (async, don't block order creation)
    this.triggerOrderCreatedWorkflows(order).catch(error => {
      logger.error('Failed to trigger order_created workflows', {
        orderId: order.id,
        error: error.message
      });
    });

    return order;
  }

  /**
   * Bulk import orders from external source
   */
  async bulkImportOrders(orders: BulkImportOrderData[], createdById?: number) {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ order: BulkImportOrderData; error: string }>
    };

    for (const orderData of orders) {
      try {
        // Find or create customer
        let customer = await prisma.customer.findUnique({
          where: { phoneNumber: orderData.customerPhone }
        });

        if (!customer) {
          customer = await prisma.customer.create({
            data: {
              firstName: orderData.customerFirstName || 'Unknown',
              lastName: orderData.customerLastName || '',
              phoneNumber: orderData.customerPhone,
              address: orderData.deliveryAddress,
              state: orderData.deliveryState,
              area: orderData.deliveryArea
            }
          });
        }

        const orderNumber = await this.generateOrderNumber();

        await prisma.order.create({
          data: {
            orderNumber,
            customerId: customer.id,
            subtotal: orderData.subtotal,
            totalAmount: orderData.totalAmount,
            codAmount: orderData.totalAmount,
            deliveryAddress: orderData.deliveryAddress,
            deliveryState: orderData.deliveryState,
            deliveryArea: orderData.deliveryArea,
            notes: orderData.notes,
            source: 'bulk_import',
            createdById,
            orderHistory: {
              create: {
                status: 'pending_confirmation',
                notes: 'Order imported via bulk CSV',
                changedBy: createdById
              }
            }
          }
        });

        results.success++;
        logger.info(`Bulk import order created: ${orderNumber}`);
      } catch (err: any) {
        results.failed++;
        results.errors.push({
          order: orderData,
          error: err.message
        });
        logger.error('Failed to import order', { error: err.message, orderData });
      }
    }

    return results;
  }

  /**
   * Get single order by ID
   */
  async getOrderById(orderId: string) {
    const id = parseInt(orderId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid order ID', 400);
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        customerRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        },
        deliveryAgent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            role: true
          }
        },
        orderItems: {
          include: {
            product: true
          }
        },
        orderHistory: {
          orderBy: { createdAt: 'desc' }
        },
        delivery: true,
        transaction: true
      }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    return order;
  }

  /**
   * Update order details
   */
  async updateOrder(orderId: string, updateData: any) {
    const id = parseInt(orderId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid order ID', 400);
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { customer: true, orderItems: true }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Extract fields that need special handling
    const {
      alternatePhone,
      orderItems,
      customerName,
      customerEmail,
      customerPhone,
      ...orderUpdateData
    } = updateData;

    // Update order and customer in a transaction
    const updated = await prisma.$transaction(async (tx) => {
      // Update customer information if provided
      if (order.customer) {
        const customerUpdateData: any = {};

        // Handle customer name
        if (customerName !== undefined) {
          const nameParts = customerName.trim().split(' ');
          customerUpdateData.firstName = nameParts[0] || 'Unknown';
          customerUpdateData.lastName = nameParts.slice(1).join(' ') || '';
        }

        // Handle customer email
        if (customerEmail !== undefined) {
          customerUpdateData.email = customerEmail;
        }

        // Handle customer phone number
        if (customerPhone !== undefined) {
          customerUpdateData.phoneNumber = customerPhone;
        }

        // Handle alternate phone
        if (alternatePhone !== undefined) {
          customerUpdateData.alternatePhone = alternatePhone;
        }

        // Only update if there are fields to update
        if (Object.keys(customerUpdateData).length > 0) {
          await tx.customer.update({
            where: { id: order.customerId },
            data: customerUpdateData
          });
        }
      }

      // If orderItems are provided, update them
      if (orderItems && Array.isArray(orderItems)) {
        // Delete existing order items
        await tx.orderItem.deleteMany({
          where: { orderId: id }
        });

        // Create new order items
        await tx.orderItem.createMany({
          data: orderItems.map((item: any) => ({
            orderId: id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice * item.quantity,
            itemType: item.itemType || 'package',
            metadata: item.metadata || null
          }))
        });
      }

      // Update order
      return await tx.order.update({
        where: { id },
        data: orderUpdateData,
        include: {
          customer: true,
          orderItems: {
            include: {
              product: true
            }
          }
        }
      });
    });

    logger.info(`Order updated: ${order.orderNumber}`, { orderId });
    return updated;
  }

  /**
   * Update order status with history tracking
   */
  async updateOrderStatus(orderId: string, data: UpdateOrderStatusData) {
    const id = parseInt(orderId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid order ID', 400);
    }

    const order = await prisma.order.findUnique({
      where: { id }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Status validation removed - allow any status transition for admin flexibility
    // this.validateStatusTransition(order.status, data.status);

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: data.status,
        orderHistory: {
          create: {
            status: data.status,
            notes: data.notes || `Status changed to ${data.status}`,
            changedBy: data.changedBy
          }
        }
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            alternatePhone: true,
            email: true
          }
        },
        customerRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        },
        deliveryAgent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            role: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true
              }
            }
          }
        }
      }
    });

    logger.info(`Order status updated: ${order.orderNumber}`, {
      orderId,
      oldStatus: order.status,
      newStatus: data.status
    });

    // Emit socket event for real-time updates (non-blocking)
    setImmediate(() => {
      try {
        emitOrderUpdated(io, updated);
      } catch (error) {
        logger.error('Failed to emit order updated event', { orderId, error });
      }
    });

    // Note: triggerStatusChangeWorkflows removed - method doesn't exist
    // Add workflow triggering here if needed in the future

    return updated;
  }

  /**
   * Validate status transition
   * Allows both forward and backward transitions for admin flexibility
   */
  private validateStatusTransition(currentStatus: OrderStatus, newStatus: OrderStatus): void {
    // Allow same status (no-op)
    if (currentStatus === newStatus) {
      return;
    }

    // Extended transitions allowing backward movement for admin corrections
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      pending_confirmation: ['confirmed', 'cancelled'],
      confirmed: ['pending_confirmation', 'preparing', 'cancelled'],
      preparing: ['pending_confirmation', 'confirmed', 'ready_for_pickup', 'cancelled'],
      ready_for_pickup: ['confirmed', 'preparing', 'out_for_delivery', 'cancelled'],
      out_for_delivery: ['ready_for_pickup', 'preparing', 'delivered', 'failed_delivery', 'cancelled'],
      delivered: ['out_for_delivery', 'returned'],
      cancelled: ['pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup'],
      returned: ['delivered', 'out_for_delivery'],
      failed_delivery: ['out_for_delivery', 'cancelled']
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new AppError(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
        400
      );
    }
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: string, changedBy?: number, notes?: string) {
    const id = parseInt(orderId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid order ID', 400);
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { orderItems: true }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (['delivered', 'cancelled'].includes(order.status)) {
      throw new AppError('Cannot cancel order in current status', 400);
    }

    // Restock products and update order
    await prisma.$transaction(async (tx) => {
      // Restock products
      for (const item of order.orderItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: {
              increment: item.quantity
            }
          }
        });
      }

      // Update order status
      await tx.order.update({
        where: { id },
        data: {
          status: 'cancelled',
          orderHistory: {
            create: {
              status: 'cancelled',
              notes: notes || 'Order cancelled',
              changedBy
            }
          }
        }
      });

      // Update customer stats
      await tx.customer.update({
        where: { id: order.customerId },
        data: {
          totalOrders: { decrement: 1 },
          totalSpent: { decrement: order.totalAmount }
        }
      });
    });

    logger.info(`Order cancelled: ${order.orderNumber}`, { orderId });
    return { message: 'Order cancelled successfully' };
  }

  /**
   * Assign customer rep to order
   */
  async assignCustomerRep(orderId: string, customerRepId: string, changedBy?: number) {
    const [order, rep] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId } }),
      prisma.user.findUnique({ where: { id: customerRepId } })
    ]);

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (!rep || rep.role !== 'sales_rep') {
      throw new AppError('Invalid customer representative', 400);
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        customerRepId,
        orderHistory: {
          create: {
            status: order.status,
            notes: `Customer rep assigned: ${rep.firstName} ${rep.lastName}`,
            changedBy,
            metadata: { assignedRepId: customerRepId }
          }
        }
      },
      include: {
        customerRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    logger.info(`Customer rep assigned to order: ${order.orderNumber}`, {
      orderId,
      repId: customerRepId
    });

    // Emit socket events for real-time updates
    emitOrderAssigned(io, updated, customerRepId, 'sales_rep');
    emitOrderUpdated(io, updated);

    return updated;
  }

  /**
   * Assign delivery agent to order
   */
  async assignDeliveryAgent(orderId: string, deliveryAgentId: string, changedBy?: number) {
    const [order, agent] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId } }),
      prisma.user.findUnique({ where: { id: deliveryAgentId } })
    ]);

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (!agent || agent.role !== 'delivery_agent') {
      throw new AppError('Invalid delivery agent', 400);
    }

    if (!agent.isAvailable) {
      throw new AppError('Delivery agent is not available', 400);
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        deliveryAgentId,
        orderHistory: {
          create: {
            status: order.status,
            notes: `Delivery agent assigned: ${agent.firstName} ${agent.lastName}`,
            changedBy,
            metadata: { assignedAgentId: deliveryAgentId }
          }
        }
      },
      include: {
        deliveryAgent: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    logger.info(`Delivery agent assigned to order: ${order.orderNumber}`, {
      orderId,
      agentId: deliveryAgentId
    });

    // Emit socket events for real-time updates
    emitOrderAssigned(io, updated, deliveryAgentId, 'delivery_agent');
    emitOrderUpdated(io, updated);

    return updated;
  }

  /**
   * Get Kanban board view
   */
  async getKanbanView(filters: { area?: string; agentId?: string }) {
    const where: Prisma.OrderWhereInput = {};
    if (filters.area) where.deliveryArea = filters.area;
    if (filters.agentId) where.deliveryAgentId = filters.agentId;

    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: { priority: 'desc' }
    });

    const kanban = {
      pending_confirmation: orders.filter((o) => o.status === 'pending_confirmation'),
      confirmed: orders.filter((o) => o.status === 'confirmed'),
      preparing: orders.filter((o) => o.status === 'preparing'),
      ready_for_pickup: orders.filter((o) => o.status === 'ready_for_pickup'),
      out_for_delivery: orders.filter((o) => o.status === 'out_for_delivery'),
      delivered: orders.filter((o) => o.status === 'delivered'),
      cancelled: orders.filter((o) => o.status === 'cancelled'),
      returned: orders.filter((o) => o.status === 'returned'),
      failed_delivery: orders.filter((o) => o.status === 'failed_delivery')
    };

    return kanban;
  }

  /**
   * Get order statistics
   */
  async getOrderStats(filters: { startDate?: Date; endDate?: Date }) {
    const where: Prisma.OrderWhereInput = {};
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [totalOrders, ordersByStatus, totalRevenue, avgOrderValue] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ['status'],
        where,
        _count: true
      }),
      prisma.order.aggregate({
        where: { ...where, status: 'delivered' },
        _sum: { totalAmount: true }
      }),
      prisma.order.aggregate({
        where,
        _avg: { totalAmount: true }
      })
    ]);

    const stats = {
      totalOrders,
      ordersByStatus: ordersByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<string, number>),
      totalRevenue: totalRevenue._sum.totalAmount || 0,
      avgOrderValue: avgOrderValue._avg.totalAmount || 0
    };

    return stats;
  }

  /**
   * Trigger workflows with order_created trigger type
   */
  private async triggerOrderCreatedWorkflows(order: any) {
    try {
      // Find active workflows with order_created trigger
      const workflows = await prisma.workflow.findMany({
        where: {
          triggerType: 'order_created',
          isActive: true
        }
      });

      if (workflows.length === 0) {
        logger.debug('No active order_created workflows found');
        return;
      }

      logger.info(`Found ${workflows.length} active order_created workflows`, {
        orderId: order.id,
        workflows: workflows.map(w => w.id)
      });

      // Fetch full order data with products for workflow evaluation
      const fullOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: {
          orderItems: {
            include: {
              product: true
            }
          },
          customer: true
        }
      });

      if (!fullOrder) {
        logger.error('Order not found for workflow triggering', { orderId: order.id });
        return;
      }

      // Prepare context for workflow evaluation
      const orderContext = {
        ...fullOrder,
        productName: fullOrder.orderItems.map((item: any) => item.product.name).join(', ')
      };

      // Trigger each workflow
      for (const workflow of workflows) {
        try {
          // Create execution record
          const execution = await prisma.workflowExecution.create({
            data: {
              workflowId: workflow.id,
              status: 'pending',
              input: orderContext
            }
          });

          // Add to queue for async processing
          await workflowQueue.add('execute-workflow', {
            executionId: execution.id,
            workflowId: workflow.id,
            actions: workflow.actions,
            conditions: workflow.conditions,
            input: orderContext
          });

          logger.info('Workflow triggered for new order', {
            workflowId: workflow.id,
            executionId: execution.id,
            orderId: order.id
          });
        } catch (error: any) {
          logger.error('Failed to trigger workflow', {
            workflowId: workflow.id,
            orderId: order.id,
            error: error.message
          });
        }
      }
    } catch (error: any) {
      logger.error('Error in triggerOrderCreatedWorkflows', {
        orderId: order.id,
        error: error.message
      });
      throw error;
    }
  }
}

export default new OrderService();
