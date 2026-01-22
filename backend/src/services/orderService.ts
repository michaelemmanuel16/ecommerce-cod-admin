import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma, OrderStatus, JournalSourceType } from '@prisma/client';
import logger from '../utils/logger';
import workflowService from './workflowService';
import { getSocketInstance } from '../utils/socketInstance';
import {
  emitOrderAssigned,
  emitOrderCreated,
  emitOrderUpdated,
  emitOrderStatusChanged,
  emitOrdersDeleted,
  emitGLEntryCreated,
} from '../sockets';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';
import { checkResourceOwnership, Requester } from '../utils/authUtils';
import { SYSTEM_USER_ID } from '../config/constants';
import { GLAutomationService, JournalEntryWithTransactions } from './glAutomationService';

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

export interface BulkImportOrderData {
  customerPhone: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerAlternatePhone?: string;
  subtotal: number;
  totalAmount: number;
  deliveryAddress: string;
  deliveryState: string;
  deliveryArea: string;
  notes?: string;
  productName?: string;
  quantity?: number;
  unitPrice?: number;
  status?: OrderStatus;
  // User assignments from CSV
  assignedRepName?: string;
  assignedAgentName?: string;
  // Order date from CSV
  orderDate?: Date;
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
   * Get all orders with filters and pagination
   */
  async getAllOrders(filters: OrderFilters, requester?: Requester) {
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

    const where: Prisma.OrderWhereInput = {
      deletedAt: null // Filter out soft-deleted orders
    };

    if (status && status.length > 0) where.status = { in: status };
    if (customerId) where.customerId = customerId;
    if (customerRepId) where.customerRepId = customerRepId;
    if (deliveryAgentId) where.deliveryAgentId = deliveryAgentId;
    if (area) where.deliveryArea = area;

    // Role-based filtering
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      if (requester.role === 'sales_rep') {
        where.customerRepId = requester.id;
      } else if (requester.role === 'delivery_agent') {
        where.deliveryAgentId = requester.id;
      }
    }

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

    // Validate products and check stock
    const productMap = new Map<number, any>();
    for (const item of data.orderItems) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId }
      });
      if (!product) {
        throw new AppError(`Product ID ${item.productId} not found`, 404);
      }
      productMap.set(item.productId, product);
    }

    // Create order in transaction
    const order = await prisma.$transaction(async (tx) => {
      // Update product stock and validate availability atomically
      for (const item of data.orderItems) {
        const result = await tx.product.updateMany({
          where: {
            id: item.productId,
            stockQuantity: { gte: item.quantity }
          },
          data: {
            stockQuantity: {
              decrement: item.quantity
            }
          }
        });

        if (result.count === 0) {
          throw new AppError(
            `Insufficient stock for product ID ${item.productId}. It may have been sold out while you were processing.`,
            400
          );
        }
      }


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

    // Emit socket event for real-time update
    emitOrderCreated(getSocketInstance() as any, order);

    // Trigger workflows with order_created trigger (async, don't block order creation)
    workflowService.triggerOrderCreatedWorkflows(order).catch(error => {
      logger.error('Failed to trigger order_created workflows', {
        orderId: order.id,
        error: error.message
      });
    });

    return order;
  }


  /**
 * Bulk import orders from external source
 * Orders are processed in batches for better performance
 * Each batch is processed in its own transaction to allow partial success
 */
  async bulkImportOrders(
    orders: BulkImportOrderData[],
    createdById?: number,
    repMap?: Map<string, number>,
    agentMap?: Map<string, number>
  ) {
    const results = {
      success: 0,
      failed: 0,
      duplicates: 0,
      errors: [] as Array<{ order: BulkImportOrderData; error: string }>
    };

    // Process orders in batches for better performance
    for (let i = 0; i < orders.length; i += BULK_ORDER_CONFIG.IMPORT_BATCH_SIZE) {
      const batch = orders.slice(i, i + BULK_ORDER_CONFIG.IMPORT_BATCH_SIZE);

      // Process orders in the current batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (orderData) => {
          return prisma.$transaction(async (tx) => {
            // Find or create customer
            let customer = await tx.customer.findUnique({
              where: { phoneNumber: orderData.customerPhone }
            });

            // Enhanced duplicate detection - check multiple criteria
            if (customer) {
              const duplicateWindow = new Date(Date.now() - BULK_ORDER_CONFIG.DUPLICATE_DETECTION_WINDOW);
              const duplicates = await tx.order.findMany({
                where: {
                  customerId: customer.id,
                  totalAmount: orderData.totalAmount,
                  deliveryAddress: orderData.deliveryAddress,
                  deliveryArea: orderData.deliveryArea,
                  createdAt: { gte: duplicateWindow },
                  deletedAt: null
                },
                include: {
                  orderItems: {
                    include: { product: true }
                  }
                }
              });

              for (const duplicate of duplicates) {
                // If no product name in imported order, and we found an order with same amount/address/area, it's a duplicate
                if (!orderData.productName) {
                  throw new Error('DUPLICATE_ORDER');
                }

                // If product name is provided, check if any existing order item matches it
                const duplicateProductName = duplicate.orderItems?.[0]?.product?.name;
                if (duplicateProductName &&
                  (duplicateProductName.toLowerCase().includes(orderData.productName.toLowerCase()) ||
                    orderData.productName.toLowerCase().includes(duplicateProductName.toLowerCase()))) {
                  throw new Error('DUPLICATE_ORDER');
                }
              }
            }

            if (!customer) {
              customer = await tx.customer.create({
                data: {
                  firstName: orderData.customerFirstName || 'Unknown',
                  lastName: orderData.customerLastName || '',
                  phoneNumber: orderData.customerPhone,
                  alternatePhone: orderData.customerAlternatePhone,
                  address: orderData.deliveryAddress,
                  state: orderData.deliveryState,
                  area: orderData.deliveryArea
                }
              });
            } else if (orderData.customerAlternatePhone && !customer.alternatePhone) {
              await tx.customer.update({
                where: { id: customer.id },
                data: { alternatePhone: orderData.customerAlternatePhone }
              });
            }

            // Handle product lookup
            let orderItemsData: any[] = [];
            if (orderData.productName) {
              const product = await tx.product.findFirst({
                where: {
                  OR: [
                    { name: { contains: orderData.productName, mode: 'insensitive' } },
                    { sku: { contains: orderData.productName, mode: 'insensitive' } }
                  ]
                }
              });

              if (product) {
                orderItemsData = [{
                  productId: product.id,
                  quantity: orderData.quantity || 1,
                  unitPrice: orderData.unitPrice || product.price,
                  totalPrice: (orderData.quantity || 1) * (orderData.unitPrice || product.price)
                }];
              }
            }

            // Get user assignments from maps
            const customerRepId = orderData.assignedRepName && repMap ? repMap.get(orderData.assignedRepName) : undefined;
            const deliveryAgentId = orderData.assignedAgentName && agentMap ? agentMap.get(orderData.assignedAgentName) : undefined;

            const createdOrder = await tx.order.create({
              data: {
                customerId: customer.id,
                subtotal: orderData.subtotal,
                totalAmount: orderData.totalAmount,
                codAmount: orderData.totalAmount,
                deliveryAddress: orderData.deliveryAddress,
                deliveryState: orderData.deliveryState,
                deliveryArea: orderData.deliveryArea,
                notes: orderData.notes,
                status: orderData.status || 'pending_confirmation',
                source: 'bulk_import',
                createdById,
                customerRepId,
                deliveryAgentId,
                createdAt: orderData.orderDate, // Use date from CSV if provided
                orderItems: orderItemsData.length > 0 ? { create: orderItemsData } : undefined,
                orderHistory: {
                  create: {
                    status: orderData.status || 'pending_confirmation',
                    notes: 'Order imported via bulk CSV',
                    changedBy: createdById
                  }
                }
              }
            });

            // Update stock for imported items
            for (const item of orderItemsData) {
              const result = await tx.product.updateMany({
                where: {
                  id: item.productId,
                  stockQuantity: { gte: item.quantity }
                },
                data: {
                  stockQuantity: { decrement: item.quantity }
                }
              });

              if (result.count === 0) {
                throw new Error(`INSUFFICIENT_STOCK_PRODUCT_${item.productId} `);
              }
            }

            return createdOrder;
          });
        })
      );

      // Handle batch results
      for (let idx = 0; idx < batchResults.length; idx++) {
        const result = batchResults[idx];
        const orderData = batch[idx];

        if (result.status === 'fulfilled') {
          results.success++;
          const createdOrder = result.value;
          emitOrderCreated(getSocketInstance() as any, createdOrder);
          workflowService.triggerOrderCreatedWorkflows(createdOrder).catch(err => {
            logger.error('Failed to trigger workflow for bulk imported order', {
              orderId: createdOrder.id,
              error: err.message
            });
          });
        } else {
          const error = result.reason;
          if (error.message === 'DUPLICATE_ORDER') {
            results.duplicates++;
          } else {
            results.failed++;
            results.errors.push({
              order: orderData,
              error: error.message
            });
            logger.error('Failed to import order', {
              error: error.message,
              orderData
            });
          }
        }
      }

      // Emit progress update after each batch
      const processed = Math.min(i + BULK_ORDER_CONFIG.IMPORT_BATCH_SIZE, orders.length);
      const progress = Math.round((processed / orders.length) * 100);

      getSocketInstance()?.emit('bulk_import_progress', {
        progress,
        processed,
        total: orders.length,
        success: results.success,
        failed: results.failed,
        duplicates: results.duplicates
      });

      // Log progress after each batch
      logger.info('Batch processed', {
        progress,
        processed,
        total: orders.length,
        batchNumber: Math.floor(i / BULK_ORDER_CONFIG.IMPORT_BATCH_SIZE) + 1,
        totalBatches: Math.ceil(orders.length / BULK_ORDER_CONFIG.IMPORT_BATCH_SIZE),
        successSoFar: results.success,
        failedSoFar: results.failed
      });
    }

    // Log audit trail
    logger.info('Bulk import completed', {
      success: results.success,
      failed: results.failed,
      duplicates: results.duplicates,
      userId: createdById
    });

    return results;
  }

  /**
   * Get single order by ID
   */
  async getOrderById(orderId: number, requester?: Requester) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
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

    if (order.deletedAt) {
      throw new AppError('Order has been deleted', 404);
    }

    // Enforce ownership if requester is provided
    if (requester) {
      const isOwner = checkResourceOwnership(requester, {
        assignedRepId: order.customerRepId,
        deliveryAgentId: order.deliveryAgentId,
        customerId: order.customerId
      }, 'order');

      if (!isOwner) {
        throw new AppError('You do not have permission to view this order', 403);
      }
    }

    return order;
  }

  /**
   * Update order details
   */
  async updateOrder(orderId: number, updateData: any, requester?: Requester) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      include: { customer: true, orderItems: true }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Enforce ownership
    if (requester) {
      const isOwner = checkResourceOwnership(requester, {
        assignedRepId: order.customerRepId,
        deliveryAgentId: order.deliveryAgentId,
        customerId: order.customerId
      }, 'order');

      if (!isOwner) {
        throw new AppError('You do not have permission to update this order', 403);
      }
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

      // If orderItems are provided, update them and adjust stock
      if (orderItems && Array.isArray(orderItems)) {
        // Calculate stock changes
        const oldItems = order.orderItems;
        const newItems = orderItems;

        // Restore old stock
        for (const oldItem of oldItems) {
          await tx.product.update({
            where: { id: oldItem.productId },
            data: { stockQuantity: { increment: oldItem.quantity } }
          });
        }

        // Deduct new stock and validate atomically
        for (const newItem of newItems) {
          const result = await tx.product.updateMany({
            where: {
              id: newItem.productId,
              stockQuantity: { gte: newItem.quantity }
            },
            data: {
              stockQuantity: { decrement: newItem.quantity }
            }
          });

          if (result.count === 0) {
            throw new AppError(`Insufficient stock for product ID ${newItem.productId} `, 400);
          }
        }

        // Delete existing order items
        await tx.orderItem.deleteMany({
          where: { orderId: orderId }
        });

        // Create new order items
        await tx.orderItem.createMany({
          data: orderItems.map((item: any) => ({
            orderId: orderId,
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
        where: { id: orderId },
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

    logger.info(`Order updated: ${orderId} `, { orderId: orderId });
    return updated;
  }

  /**
   * Update order status with history tracking
   */
  async updateOrderStatus(orderId: number, data: UpdateOrderStatusData, requester?: Requester) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Enforce ownership
    if (requester) {
      const isOwner = checkResourceOwnership(requester, {
        assignedRepId: order.customerRepId,
        deliveryAgentId: order.deliveryAgentId,
        customerId: order.customerId
      }, 'order');

      if (!isOwner) {
        throw new AppError('You do not have permission to update the status of this order', 403);
      }
    }

    // Status validation removed - allow any status transition for admin flexibility
    // this.validateStatusTransition(order.status, data.status);

    // Handle return status with GL reversal and inventory restoration
    const isReturnStatus = data.status === 'returned';
    let glEntry: any = null;

    const updated = await prisma.$transaction(async (tx) => {
      // Handle return reversal if status changed to 'returned' and revenue was recognized
      if ((order as any).revenueRecognized) {
        // Find the latest non-reversed order_delivery GL entry for this order
        const latestEntry = await tx.journalEntry.findFirst({
          where: {
            sourceId: (orderId as any),
            sourceType: JournalSourceType.order_delivery,
            reversedBy: null,
            voidedBy: null
          },
          include: {
            transactions: {
              include: {
                account: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (!latestEntry) {
          logger.warn(`Order ${orderId} marked as revenue recognized but no active GL entry found.`);
        }

        // Fetch order with items and products for inventory restoration
        const orderWithItems = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            customer: true,
            deliveryAgent: true,
            customerRep: true,
            orderItems: {
              include: { product: true }
            }
          }
        });

        if (orderWithItems && latestEntry) {
          glEntry = await GLAutomationService.createReturnReversalEntry(
            tx as any,
            orderWithItems as any,
            latestEntry as JournalEntryWithTransactions,
            data.changedBy || SYSTEM_USER_ID
          );

          // Restore inventory
          await GLAutomationService.restoreInventory((tx as any), (orderWithItems as any).orderItems);

          logger.info(`GL reversal entry created for returned order ${orderId}: ${glEntry.entryNumber} `);
        }
      }

      // Update order status
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: data.status,
          ...(isReturnStatus && order.revenueRecognized ? { revenueRecognized: false } : {}),
          orderHistory: {
            create: {
              status: data.status,
              notes: data.notes || `Status changed to ${data.status} `,
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

      return updatedOrder;
    });

    logger.info(`Order status updated: ${order.id} `, {
      orderId,
      oldStatus: order.status,
      newStatus: data.status,
      glReversalCreated: !!glEntry
    });

    // Emit socket events for real-time updates (non-blocking)
    setImmediate(() => {
      try {
        const ioInstance = getSocketInstance() as any;
        emitOrderUpdated(ioInstance, updated);
        emitOrderStatusChanged(ioInstance, updated, order.status, data.status);

        // Emit GL entry created event for return reversal
        if (glEntry) {
          emitGLEntryCreated(ioInstance, glEntry, {
            orderId: order.id,
            orderNumber: order.id.toString(),
            type: 'return_reversal'
          });
        }
      } catch (error) {
        logger.error('Failed to emit socket events', { orderId, error });
      }
    });

    // Trigger status change workflows (non-blocking)
    workflowService.triggerStatusChangeWorkflows(orderId, order.status, data.status).catch(error => {
      logger.error('Failed to trigger status change workflows', { orderId, error: error.message });
    });

    return updated;
  }

  /**
   * Cancel order
   */
  async cancelOrder(orderId: number, changedBy?: number, notes?: string, requester?: Requester) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      include: { orderItems: true }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Enforce ownership
    if (requester) {
      const isOwner = checkResourceOwnership(requester, {
        assignedRepId: order.customerRepId,
        deliveryAgentId: order.deliveryAgentId,
        customerId: order.customerId
      }, 'order');

      if (!isOwner) {
        throw new AppError('You do not have permission to cancel this order', 403);
      }
    }

    if (['delivered', 'cancelled'].includes(order.status)) {
      throw new AppError('Cannot cancel order in current status', 400);
    }

    if (order.deletedAt) {
      throw new AppError('Cannot cancel a deleted order', 400);
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
        where: { id: orderId },
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

    logger.info(`Order cancelled: ${order.id} `, { orderId });
    return { message: 'Order cancelled successfully' };
  }

  /**
   * Soft delete order (set deletedAt timestamp)
   */
  async deleteOrder(orderId: number, userId?: number, requester?: Requester) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      include: { orderItems: true, customer: true }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Enforce ownership
    if (requester) {
      const isOwner = checkResourceOwnership(requester, {
        assignedRepId: order.customerRepId,
        deliveryAgentId: order.deliveryAgentId,
        customerId: order.customerId
      }, 'order');

      if (!isOwner) {
        throw new AppError('You do not have permission to delete this order', 403);
      }
    }

    if (order.deletedAt) {
      throw new AppError('Order already deleted', 400);
    }

    if (order.status === 'delivered') {
      throw new AppError('Cannot delete delivered orders', 400);
    }

    // Soft delete with transaction (restock products, update customer stats)
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

      // Update customer stats
      await tx.customer.update({
        where: { id: order.customerId },
        data: {
          totalOrders: { decrement: 1 },
          totalSpent: { decrement: order.totalAmount }
        }
      });

      // Create audit trail
      await tx.orderHistory.create({
        data: {
          orderId: order.id,
          status: order.status,
          notes: `Order deleted by user ${userId || 'system'} `,
          changedBy: userId
        }
      });

      // Soft delete the order
      await tx.order.update({
        where: { id: orderId },
        data: { deletedAt: new Date() }
      });
    });

    logger.info(`Order soft deleted: ${order.id} `, { orderId, userId });
    return { message: 'Order deleted successfully' };
  }
  /**
   * Bulk soft delete orders
   */
  async bulkDeleteOrders(orderIds: number[], userId?: number, requester?: Requester) {
    if (!orderIds || orderIds.length === 0) {
      throw new AppError('No order IDs provided', 400);
    }

    // Fetch orders with items to check permissions and status
    const orders = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        deletedAt: null
      },
      include: {
        orderItems: true
      }
    });

    if (orders.length === 0) {
      throw new AppError('No valid orders found to delete', 404);
    }

    // Validate each order
    for (const order of orders) {
      // Enforce ownership
      if (requester) {
        const isOwner = checkResourceOwnership(requester, {
          assignedRepId: order.customerRepId,
          deliveryAgentId: order.deliveryAgentId,
          customerId: order.customerId
        }, 'order');

        if (!isOwner) {
          throw new AppError(`You do not have permission to delete order #${order.id} `, 403);
        }
      }

      if (order.status === 'delivered') {
        throw new AppError(`Cannot delete delivered order #${order.id} `, 400);
      }
    }

    // Aggregate updates for performance
    const productRestocks = new Map<number, number>();
    const customerUpdates = new Map<number, { count: number, total: number }>();
    const historyData: Prisma.OrderHistoryCreateManyInput[] = [];
    const actualOrderIds = orders.map(o => o.id);

    for (const order of orders) {
      // Aggregate product restocks
      for (const item of order.orderItems) {
        const current = productRestocks.get(item.productId) || 0;
        productRestocks.set(item.productId, current + item.quantity);
      }

      // Aggregate customer stats
      const currentCust = customerUpdates.get(order.customerId) || { count: 0, total: 0 };
      customerUpdates.set(order.customerId, {
        count: currentCust.count + 1,
        total: currentCust.total + order.totalAmount
      });

      // Prepare history data
      historyData.push({
        orderId: order.id,
        status: order.status,
        notes: `Order deleted in bulk by user ${userId || 'system'} `,
        changedBy: userId
      });
    }

    // Perform bulk deletion in a single transaction
    await prisma.$transaction(async (tx) => {
      // 1. Batch restock products & customer stats in parallel
      const updatePromises: Promise<any>[] = [];

      if (productRestocks.size > 0) {
        for (const [productId, quantity] of productRestocks.entries()) {
          updatePromises.push(
            tx.product.update({
              where: { id: productId },
              data: { stockQuantity: { increment: quantity } }
            })
          );
        }
      }

      if (customerUpdates.size > 0) {
        for (const [customerId, stats] of customerUpdates.entries()) {
          updatePromises.push(
            tx.customer.update({
              where: { id: customerId },
              data: {
                totalOrders: { decrement: stats.count },
                totalSpent: { decrement: stats.total }
              }
            })
          );
        }
      }

      // Execute all updates in parallel
      await Promise.all(updatePromises);

      // 3. Batch create audit trail
      await tx.orderHistory.createMany({
        data: historyData
      });

      // 4. Bulk soft delete orders
      await tx.order.updateMany({
        where: { id: { in: actualOrderIds } },
        data: { deletedAt: new Date() }
      });
    });

    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitOrdersDeleted(ioInstance as any, actualOrderIds);
    }

    logger.info(`Bulk orders soft deleted: ${actualOrderIds.join(', ')} `, {
      orderIds: actualOrderIds,
      userId
    });

    return {
      message: `Successfully deleted ${orders.length} order(s)`,
      deletedCount: orders.length
    };
  }


  /**
   * Assign customer rep to order
   */
  async assignCustomerRep(orderId: number, customerRepId: number, requester: Requester) {
    // Only admin/manager can assign reps
    if (requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      throw new AppError('Only administrators or managers can assign customer representatives', 403);
    }
    const [order, rep] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId, deletedAt: null } }),
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
        customerRepId: customerRepId,
        orderHistory: {
          create: {
            status: order.status,
            notes: `Customer rep assigned: ${rep.firstName} ${rep.lastName} `,
            changedBy: requester.id,
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

    logger.info(`Customer rep assigned to order: ${order.id} `, {
      orderId,
      repId: customerRepId,
      changedBy: requester.id
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: requester.id,
        action: 'assign_rep',
        resource: 'order',
        resourceId: orderId.toString(),
        metadata: { assignedRepId: customerRepId }
      }
    });

    // Emit socket events for real-time updates
    const ioInstance = getSocketInstance() as any;
    emitOrderAssigned(ioInstance, updated, customerRepId.toString(), 'sales_rep');
    emitOrderUpdated(ioInstance, updated);

    return updated;
  }

  /**
   * Assign delivery agent to order
   */
  async assignDeliveryAgent(orderId: number, deliveryAgentId: number, requester: Requester) {
    // Only admin/manager/sales_rep can assign delivery agent (sometimes sales reps do it after confirmation)
    // Actually, usually managers assign agents. Let's stick to manager+ for now, or check ownership.
    if (requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      // Check if sales rep is assigned to this order
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.customerRepId !== requester.id) {
        throw new AppError('Only managers or the assigned sales representative can assign delivery agents', 403);
      }
    }
    const [order, agent] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId, deletedAt: null } }),
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
        deliveryAgentId: deliveryAgentId,
        orderHistory: {
          create: {
            status: order.status,
            notes: `Delivery agent assigned: ${agent.firstName} ${agent.lastName} `,
            changedBy: requester.id,
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

    logger.info(`Delivery agent assigned to order: ${order.id} `, {
      orderId,
      agentId: deliveryAgentId,
      changedBy: requester.id
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: requester.id,
        action: 'assign_agent',
        resource: 'order',
        resourceId: orderId.toString(),
        metadata: { assignedAgentId: deliveryAgentId }
      }
    });

    // Emit socket events for real-time updates
    const ioInstance = getSocketInstance() as any;
    emitOrderAssigned(ioInstance, updated, deliveryAgentId.toString(), 'delivery_agent');
    emitOrderUpdated(ioInstance, updated);

    return updated;
  }

  /**
   * Get Kanban board view
   */
  async getKanbanView(filters: { area?: string; agentId?: string }, requester?: Requester) {
    const where: Prisma.OrderWhereInput = { deletedAt: null };
    if (filters.area) where.deliveryArea = filters.area;

    // Role-based filtering for Kanban
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      if (requester.role === 'sales_rep') {
        where.customerRepId = requester.id;
      } else if (requester.role === 'delivery_agent') {
        where.deliveryAgentId = requester.id;
      }
    }

    if (filters.agentId) where.deliveryAgentId = parseInt(filters.agentId, 10);

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
  async getOrderStats(filters: { startDate?: Date; endDate?: Date }, requester?: Requester) {
    const where: Prisma.OrderWhereInput = { deletedAt: null };

    // Role-based filtering for stats
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      if (requester.role === 'sales_rep') {
        where.customerRepId = requester.id;
      } else if (requester.role === 'delivery_agent') {
        where.deliveryAgentId = requester.id;
      }
    }

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
}

export default new OrderService();
