import prisma, { prismaBase } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { Prisma, OrderStatus, DeclineReason, FailureReason } from '@prisma/client';
import logger from '../utils/logger';
import appEvents, { AppEvent } from '../utils/appEvents';
import workflowService from './workflowService';
import { getSocketInstance } from '../utils/socketInstance';
import {
  emitOrderAssigned,
  emitOrderCreated,
  emitOrderUpdated,
  emitOrdersDeleted,
  emitToTenant,
} from '../sockets';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';
import { checkResourceOwnership, Requester } from '../utils/authUtils';
import { customerPhoneSearch, normalizePhone, normalizePhoneForStorage, phoneLookupVariants } from '../utils/phone';
import FinancialSyncService from './financialSyncService';
import agentInventoryService from './agentInventoryService';
import { ORDER_EVENT_INCLUDE } from './orderSideEffects';
import { transitionOrder, allowedTransitions, actorOf, ownsOrder, TransitionActor, TransitionOptions } from './orderStateMachine';
import { hasPermission } from '../middleware/auth';
import { findAndReactivateCustomerByPhone } from '../utils/customerLookup';
import * as Money from '../utils/money';
import { roleScope } from '../utils/kpiRequest';
import { kpiWindow } from './kpi/dates';
import { deliveredRevenue, revenueScope } from './kpi/revenue';



interface CreateOrderData {
  customerId?: number;
  customerPhone?: string;
  customerEmail?: string;
  customerName?: string;
  alternatePhone?: string;
  orderItems: Array<{
    productId: number;
    quantity: number;
    unitPrice: Money.MoneyInput;
    itemType?: 'package' | 'upsell';
    metadata?: any;
  }>;
  subtotal: Money.MoneyInput;
  shippingCost?: Money.MoneyInput;
  discount?: Money.MoneyInput;
  totalAmount: Money.MoneyInput;
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
  subtotal: Money.MoneyInput;
  totalAmount: Money.MoneyInput;
  deliveryAddress: string;
  deliveryState: string;
  deliveryArea: string;
  notes?: string;
  productName?: string;
  quantity?: number;
  unitPrice?: Money.MoneyInput;
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
  // Explicit delivery date, for backfills from a 3PL where the real delivery
  // happened days ago. Omitted => now. financialSyncService uses this as the
  // GL collection date, so a wrong value posts revenue into the wrong period.
  deliveryDate?: Date;
  // State machine inputs (M1-T11/T12). No actor: the requester decides; no requester: system.
  actor?: TransitionActor;
  force?: boolean;
  reason?: string;
  declineReason?: DeclineReason;
  failureReason?: FailureReason;
  nextAttemptDate?: Date | null;
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
      deletedAt: null, // Filter out soft-deleted orders
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
      const phoneSearch = customerPhoneSearch(search);
      where.OR = [
        // A phone typed as +233... parses to a number beyond Int4; it is not an order id.
        ...(isNaN(searchNum) || searchNum > 2147483647 ? [] : [{ id: searchNum }]),
        ...(phoneSearch ? [phoneSearch] : []),
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
      // Find customer by phone or create new one. Unparseable input is stored as typed (orders never fail on it).
      const customerPhone = normalizePhoneForStorage(data.customerPhone);
      const alternatePhone = normalizePhoneForStorage(data.alternatePhone) || undefined;
      customer = await findAndReactivateCustomerByPhone(prisma, customerPhone, 'manual order');

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
            phoneNumber: customerPhone,
            email: data.customerEmail || null,
            alternatePhone: alternatePhone || null,
            address: data.deliveryAddress,
            state: data.deliveryState,
            area: data.deliveryArea,
          }
        });
      } else {
        // Repeat customer: link any new email / alt phone they gave on this order —
        // including records first created without one — mirroring the public checkout
        // path so manual orders also grow the owned email list (MAN-82).
        const customerUpdateData: Prisma.CustomerUpdateInput = {};
        if (data.customerEmail && data.customerEmail !== customer.email) {
          customerUpdateData.email = data.customerEmail;
        }
        if (alternatePhone && alternatePhone !== customer.alternatePhone) {
          customerUpdateData.alternatePhone = alternatePhone;
        }
        if (Object.keys(customerUpdateData).length > 0) {
          customer = await prisma.customer.update({
            where: { id: customer.id },
            data: customerUpdateData,
          });
        }
      }
    } else {
      throw new AppError('Either customerId or customerPhone must be provided', 400);
    }

    // Validate products and check stock (batch query to avoid N+1)
    const productIds = [...new Set(data.orderItems.map(item => item.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } }
    });
    const productMap = new Map<number, any>(products.map(p => [p.id, p]));
    for (const item of data.orderItems) {
      if (!productMap.has(item.productId)) {
        throw new AppError(`Product ID ${item.productId} not found`, 404);
      }
    }

    // Create order in transaction
    const order = await prisma.$transaction(async (tx) => {
      // Validate product availability (optional, as we already checked existence)
      for (const item of data.orderItems) {
        const product = productMap.get(item.productId);
        if (product.stockQuantity < item.quantity) {
          throw new AppError(
            `Insufficient stock for product ${product.name}.Current stock: ${product.stockQuantity} `,
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
              totalPrice: Money.roundHalfUp(Money.mul(item.quantity, item.unitPrice), 4),
              itemType: item.itemType || 'package',
              metadata: item.metadata || null
            }))
          },
          orderHistory: {
            create: {
              tenantId: resolveTenantId(customer.tenantId),
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

    // Trigger workflows with order_created trigger (fully detached from request cycle)
    setImmediate(() => {
      workflowService.triggerOrderCreatedWorkflows(order).catch(error => {
        logger.error('Failed to trigger order_created workflows', {
          orderId: order.id,
          error: error.message
        });
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
    agentMap?: Map<string, number>,
    silent: boolean = false
  ) {
    logger.info('🔥🔥🔥 CANARY: Starting bulkImportOrders with sequential processing V3 🔥🔥🔥');
    const results = {
      success: 0,
      failed: 0,
      duplicates: 0,
      errors: [] as Array<{ order: BulkImportOrderData; error: string }>
    };

    // Track duplicates WITHIN the current import to catch them before they hit the DB
    const processedInImport = new Set<string>();

    const normalize = (val: string | number | null | undefined) =>
      String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    // Phone key for in-import duplicate detection: the shared E.164 form; unparseable input
    // falls back to its last 9 digits so odd values still dedupe against themselves.
    const phoneKey = (phone: string | null | undefined) => {
      const e164 = normalizePhone(phone);
      if (e164) return e164;
      const digits = String(phone || '').replace(/[^0-9]/g, '');
      return digits.length >= 9 ? digits.slice(-9) : digits;
    };

    // Process orders in batches for better performance
    for (let i = 0; i < orders.length; i += BULK_ORDER_CONFIG.IMPORT_BATCH_SIZE) {
      const batch = orders.slice(i, i + BULK_ORDER_CONFIG.IMPORT_BATCH_SIZE);

      // Process orders in the current batch SEQUENTIALLY to prevent race conditions
      for (const orderData of batch) {
        try {
          // 1. Check for duplicates within the SAME import first
          const normalizedPhone = phoneKey(orderData.customerPhone);
          const orderDateValue = orderData.orderDate || new Date();
          const orderDateString = orderDateValue.toDateString();
          const orderFingerprint = `${normalizedPhone}| ${Money.toApi(orderData.totalAmount)}| ${normalize(orderData.deliveryAddress)}| ${orderDateString} `;

          if (processedInImport.has(orderFingerprint)) {
            logger.warn('🚫 CANARY: DUPLICATE FOUND IN SAME BATCH', {
              phone: orderData.customerPhone,
              amount: orderData.totalAmount,
              date: orderDateString
            });
            results.duplicates++;
            continue;
          }

          // 2. Check for duplicates in DB (User's Logic: same phone, address, amount, date)
          const startOfCurrentDay = new Date(orderDateValue);
          startOfCurrentDay.setHours(0, 0, 0, 0);
          const endOfCurrentDay = new Date(orderDateValue);
          endOfCurrentDay.setHours(23, 59, 59, 999);

          // Use prismaBase to include soft-deleted orders in duplicate check
          const existingOrders = await prismaBase.order.findMany({
            where: {
              // Matches the number in the normalized or any old stored format.
              customer: { phoneNumber: { in: phoneLookupVariants(orderData.customerPhone) } },
              createdAt: {
                gte: startOfCurrentDay,
                lte: endOfCurrentDay
              },
              totalAmount: orderData.totalAmount
            },
            select: { id: true, deliveryAddress: true, deletedAt: true, status: true, tenantId: true },
            orderBy: { createdAt: 'desc' },
            take: 20
          });

          // Status progression order — higher index = further along
          const STATUS_ORDER: OrderStatus[] = [
            'pending_confirmation',
            'confirmed',
            'preparing',
            'ready_for_pickup',
            'out_for_delivery',
            'delivered',
          ];
          const isForwardStatus = (current: OrderStatus, next: OrderStatus) => {
            const ci = STATUS_ORDER.indexOf(current);
            const ni = STATUS_ORDER.indexOf(next);
            return ci !== -1 && ni !== -1 && ni > ci;
          };

          const matchingExisting = existingOrders.find(existing => {
            const sameAddr = normalize(existing.deliveryAddress) === normalize(orderData.deliveryAddress);
            const isRelevantRecord = !existing.deletedAt || (Date.now() - new Date(existing.deletedAt).getTime() < 5 * 60 * 1000);
            return sameAddr && isRelevantRecord;
          });

          if (matchingExisting) {
            const newStatus = (orderData.status || 'pending_confirmation') as OrderStatus;
            if (isForwardStatus(matchingExisting.status as OrderStatus, newStatus)) {
              // Update the existing order's status instead of creating a duplicate. Import is an
              // integration actor (D4); the history row keeps the importing user id.
              await transitionOrder(matchingExisting.id, newStatus, { kind: 'integration', userId: createdById }, {
                note: 'Status updated via bulk CSV re-import',
                deliveryDate: newStatus === 'delivered' ? orderDateValue : undefined,
              });
              logger.info('✅ CANARY: DUPLICATE — status updated forward', {
                orderId: matchingExisting.id,
                from: matchingExisting.status,
                to: newStatus,
              });
              results.success++;
            } else {
              // Same or earlier status — skip
              logger.warn('🚫 CANARY: DUPLICATE FOUND IN DB — status not advanced, skipping', {
                phone: orderData.customerPhone,
                existingStatus: matchingExisting.status,
                incomingStatus: newStatus,
              });
              throw new Error('DUPLICATE_ORDER');
            }
            processedInImport.add(orderFingerprint);
            continue;
          }

          const createdOrder = await prisma.$transaction(async (tx) => {
            // 3. Find or create customer by phone (tenant-scoped via Prisma extension).
            const customerPhone = normalizePhoneForStorage(orderData.customerPhone);
            const alternatePhone = normalizePhoneForStorage(orderData.customerAlternatePhone) || undefined;
            let customer = await findAndReactivateCustomerByPhone(
              tx,
              customerPhone,
              'bulk import'
            );
            if (customer) {
              customer = await tx.customer.update({
                where: { id: customer.id },
                data: {
                  ...(alternatePhone && { alternatePhone }),
                  ...(orderData.deliveryAddress && { address: orderData.deliveryAddress }),
                  ...(orderData.deliveryState && { state: orderData.deliveryState }),
                  ...(orderData.deliveryArea && { area: orderData.deliveryArea }),
                },
              });
            } else {
              customer = await tx.customer.create({
                data: {
                  firstName: orderData.customerFirstName || 'Unknown',
                  lastName: orderData.customerLastName || '',
                  phoneNumber: customerPhone,
                  alternatePhone,
                  address: orderData.deliveryAddress,
                  state: orderData.deliveryState,
                  area: orderData.deliveryArea,
                },
              });
            }

            // 4. Handle product lookup
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
                // A missing or zero unit price in the CSV falls back to the product price.
                const csvUnitPrice = Money.tryParse(orderData.unitPrice);
                const unitPrice = csvUnitPrice && !csvUnitPrice.isZero() ? csvUnitPrice : Money.parse(product.price);
                const quantity = orderData.quantity || 1;
                orderItemsData = [{
                  productId: product.id,
                  quantity,
                  unitPrice,
                  totalPrice: Money.roundHalfUp(Money.mul(quantity, unitPrice), 4)
                }];
              }
            }

            // 5. Create Order
            const customerRepId = orderData.assignedRepName && repMap ? repMap.get(orderData.assignedRepName) : undefined;
            const deliveryAgentId = orderData.assignedAgentName && agentMap ? agentMap.get(orderData.assignedAgentName) : undefined;

            const newOrder = await tx.order.create({
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
                deliveryDate: orderData.status === 'delivered' ? orderDateValue : null,
                source: 'bulk_import',
                createdById,
                customerRepId,
                deliveryAgentId,
                createdAt: orderDateValue,
                orderItems: orderItemsData.length > 0 ? { create: orderItemsData } : undefined,
                orderHistory: {
                  create: {
                    tenantId: resolveTenantId(),
                    status: orderData.status || 'pending_confirmation',
                    notes: 'Order imported via bulk CSV',
                    changedBy: createdById
                  }
                }
              },
              include: {
                orderItems: { include: { product: true } },
                customer: true,
                deliveryAgent: true,
                customerRep: true
              }
            });

            // 6. Auto-sync financial data if order is imported as delivered
            if (newOrder.status === 'delivered' && Money.isNonZero(newOrder.codAmount)) {
              try {
                const syncResult = await FinancialSyncService.syncOrderFinancialData(
                  tx as any,
                  newOrder as any,
                  createdById || undefined
                );

                if (syncResult.transaction || syncResult.journalEntry) {
                  logger.info(`Financial data auto - synced for imported order ${newOrder.id} `, {
                    transactionId: syncResult.transaction?.id,
                    journalEntryNumber: syncResult.journalEntry?.entryNumber
                  });
                }
              } catch (syncError: any) {
                // Log error but don't fail the import
                logger.error(`Failed to auto - sync financial data for imported order ${newOrder.id}: `, syncError);
                // Continue - order is still created
              }
            }

            return newOrder;
          }, {
            maxWait: 10000,  // Wait max 10s to get transaction slot
            timeout: 15000   // Transaction must complete within 15s
          });

          // Success - track it and emit events
          processedInImport.add(orderFingerprint);
          results.success++;

          if (!silent) {
            emitOrderCreated(getSocketInstance() as any, createdOrder);
          }

          workflowService.triggerOrderCreatedWorkflows(createdOrder).catch(err => {
            logger.error('Failed to trigger workflow for bulk imported order', {
              orderId: createdOrder.id,
              error: err.message
            });
          });

        } catch (error: any) {
          if (error.message === 'DUPLICATE_ORDER') {
            results.duplicates++;
            logger.info('Duplicate order skipped', { phone: orderData.customerPhone });
          } else if (error.code === 'P2002') {
            // Prisma unique constraint violation
            results.duplicates++;
            logger.warn('Duplicate customer detected via constraint', {
              phone: orderData.customerPhone,
              field: error.meta?.target,
              constraint: error.meta?.constraint
            });
          } else if (error.code === 'P2024') {
            // Prisma connection timeout
            results.failed++;
            results.errors.push({
              order: orderData,
              error: 'Database timeout - please try with smaller batch or contact support'
            });
            logger.error('Database timeout during import', {
              phone: orderData.customerPhone,
              orderData
            });
          } else if (error.code && error.code.startsWith('P')) {
            // Other Prisma errors
            results.failed++;
            results.errors.push({
              order: orderData,
              error: `Database error: ${error.message}`
            });
            logger.error('Prisma error during import', {
              code: error.code,
              message: error.message,
              phone: orderData.customerPhone
            });
          } else {
            // Generic errors
            results.failed++;
            results.errors.push({
              order: orderData,
              error: error.message || 'Unknown error'
            });
            logger.error('Failed to import order', {
              error: error.message,
              orderData
            });
          }
        }
      }

      // Emit progress update after each batch
      const processedCount = Math.min(i + BULK_ORDER_CONFIG.IMPORT_BATCH_SIZE, orders.length);
      const progress = Math.round((processedCount / orders.length) * 100);

      emitToTenant(getSocketInstance() as any, 'bulk_import_progress', {
        progress,
        processed: processedCount,
        total: orders.length,
        success: results.success,
        failed: results.failed,
        duplicates: results.duplicates
      });

      logger.info('Batch handled', {
        progress,
        processedCount,
        success: results.success,
        duplicates: results.duplicates
      });
    }

    // Log audit trail
    logger.info('Bulk import completed', {
      success: results.success,
      failed: results.failed,
      duplicates: results.duplicates,
      userId: createdById
    });

    // Always emit completion event for dashboard refreshing
    emitToTenant(getSocketInstance() as any, 'bulk_import_completed', {
      success: results.success,
      failed: results.failed,
      duplicates: results.duplicates,
      total: orders.length
    });

    // Trigger proactive aging refresh via event bus (decoupled)
    appEvents.emit(AppEvent.BULK_ORDERS_IMPORTED);

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
      // D9: a status in this body is a move; it goes through the state machine and never into the generic update
      status: requestedStatus,
      force,
      reason,
      declineReason,
      failureReason,
      nextAttemptDate,
      ...orderUpdateData
    } = updateData;

    // First the move (its own transaction, so a refused move changes nothing), then the other fields.
    if (requestedStatus && requestedStatus !== order.status) {
      const actor = actorOf(requester);
      await transitionOrder(orderId, requestedStatus, actor, this.moveOptions({
        force,
        reason,
        declineReason,
        failureReason,
        nextAttemptDate: nextAttemptDate ? new Date(nextAttemptDate) : undefined,
      }));
      order.status = requestedStatus; // the item stock adjustment below depends on the current status
    }

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
          customerUpdateData.phoneNumber = normalizePhoneForStorage(customerPhone);
        }

        // Handle alternate phone
        if (alternatePhone !== undefined) {
          customerUpdateData.alternatePhone = normalizePhoneForStorage(alternatePhone);
        }

        // Only update if there are fields to update
        if (Object.keys(customerUpdateData).length > 0) {
          await tx.customer.update({
            where: { id: order.customerId },
            data: customerUpdateData
          });
        }
      }

      // If orderItems are provided, update them and adjust stock if needed
      if (orderItems && Array.isArray(orderItems)) {
        // Only adjust stock if the order status is 'out_for_delivery' or further
        const statusesWithStockDeduction = ['out_for_delivery', 'delivered'];
        const shouldAdjustStock = statusesWithStockDeduction.includes(order.status);

        if (shouldAdjustStock) {
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
            totalPrice: Money.roundHalfUp(Money.mul(item.unitPrice, item.quantity), 4),
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
   * Update order status with history tracking. A thin wrapper over `transitionOrder` (M1-T11): the
   * state machine owns the rules, history row, stock seam, GL posting, sockets and workflows.
   * API callers (a signed-in user) must give the reasons the state machine asks for.
   */
  async updateOrderStatus(orderId: number, data: UpdateOrderStatusData, requester?: Requester) {
    const actor = data.actor ?? actorOf(requester, data.changedBy);
    const result = await transitionOrder(orderId, data.status, actor, {
      ...this.moveOptions(data),
      note: data.notes,
      deliveryDate: data.deliveryDate,
      // Both used to be written by this method on delivered; kept as is
      paymentStatus: data.status === 'delivered' ? 'collected' : undefined,
    });

    logger.info(`Order status updated: ${orderId} `, {
      orderId,
      oldStatus: result.from,
      newStatus: data.status,
      changed: result.changed,
      glReversalCreated: !!result.gl?.reversal,
    });

    return prisma.order.findFirst({ where: { id: orderId, deletedAt: null }, include: ORDER_EVENT_INCLUDE });
  }

  /**
   * Order search for the `orders_search` tool (M2-T07): filters, newest id first, one extra row read to tell
   * whether a next page exists. Runs in the tenant context of the caller.
   */
  async search(filters: {
    status?: OrderStatus;
    dateFrom?: string;
    dateTo?: string;
    customerId?: number;
    agentId?: number;
    search?: string;
    limit: number;
    cursorId?: number;
  }) {
    const where: Prisma.OrderWhereInput = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.agentId) where.deliveryAgentId = filters.agentId;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters.search) {
      const searchNum = parseInt(filters.search);
      const phoneSearch = customerPhoneSearch(filters.search);
      where.OR = [
        ...(isNaN(searchNum) ? [] : [{ id: searchNum }]),
        ...(phoneSearch ? [phoneSearch] : []),
        { customer: { firstName: { contains: filters.search, mode: 'insensitive' as const } } },
      ];
    }

    const orders = await prisma.order.findMany({
      where,
      ...(filters.cursorId !== undefined ? { cursor: { id: filters.cursorId }, skip: 1 } : {}),
      take: filters.limit + 1, // one extra row: tells whether there is a next page
      orderBy: { id: 'desc' },
      include: {
        customer: {
          select: {
            id: true, firstName: true, lastName: true, phoneNumber: true,
            alternatePhone: true, address: true, state: true,
          },
        },
        deliveryAgent: { select: { id: true, firstName: true, lastName: true } },
        orderItems: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    const hasMore = orders.length > filters.limit;
    return { orders: hasMore ? orders.slice(0, filters.limit) : orders, hasMore };
  }

  /** Orders placed in [from, to) counted by status (the status breakdown of the summary tools). */
  async statusCounts(from: Date, to: Date) {
    return prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lt: to }, deletedAt: null },
      _count: { id: true },
    });
  }

  /** The order and its customer, for the `orders_update_status` tool. Null when it is not in this tenant. */
  async findForStatusUpdate(orderId: number) {
    return prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { customer: { select: { firstName: true, lastName: true, phoneNumber: true } } },
    });
  }

  /** Options common to every status move that comes from a request body. */
  private moveOptions(
    data: Pick<UpdateOrderStatusData, 'force' | 'reason' | 'declineReason' | 'failureReason' | 'nextAttemptDate'>,
  ): TransitionOptions {
    return {
      force: data.force,
      reason: data.reason,
      declineReason: data.declineReason,
      failureReason: data.failureReason,
      nextAttemptDate: data.nextAttemptDate,
    };
  }

  /** Moves the requester can make on this order now (GET /orders/:id/transitions). */
  async getTransitions(orderId: number, requester: Requester) {
    const [order, canForce] = await Promise.all([
      prisma.order.findFirst({
        where: { id: orderId, deletedAt: null },
        select: { status: true, orderType: true, customerRepId: true, deliveryAgentId: true },
      }),
      hasPermission(requester, 'orders', 'force_status'),
    ]);
    // Reps and agents see only their own orders (same rule as the machine's role gate).
    const actor = actorOf(requester);
    if (!order || !ownsOrder(order, actor)) throw new AppError('Order not found', 404);
    return { status: order.status, ...allowedTransitions(order, actor, { canForce }) };
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

    // The state machine restocks (legacy stock seam) and writes the history row
    const result = await prisma.$transaction(async (tx) => {
      const moved = await transitionOrder(orderId, 'cancelled', actorOf(requester, changedBy), {
        note: notes || 'Order cancelled',
        tx,
      });

      // Update customer stats
      await tx.customer.update({
        where: { id: order.customerId },
        data: {
          totalOrders: { decrement: 1 },
          totalSpent: { decrement: order.totalAmount }
        }
      });
      return moved;
    });
    result.afterCommit?.();

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
      // Restock products ONLY if they were deducted (out_for_delivery, delivered)
      if (["out_for_delivery", "delivered"].includes(order.status)) {
        let reversedFromAgent: number[] = [];
        if (order.deliveryAgentId) {
          reversedFromAgent = await agentInventoryService.reverseOrderFulfillment(
            tx,
            orderId,
            order.deliveryAgentId,
            userId ?? order.deliveryAgentId,
            order.status === 'delivered'
          );
        }
        for (const item of order.orderItems) {
          if (reversedFromAgent.includes(item.productId)) continue;
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { increment: item.quantity } }
          });
        }
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
          tenantId: resolveTenantId(order.tenantId),
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

      // Remove any associated AgentCollection record that isn't yet fully processed
      // (If it's already 'deposited', we might want to keep it or handle it separately, 
      // but usually deleting an order means its collection is invalid)
      await (tx as any).agentCollection.deleteMany({
        where: {
          orderId,
          status: { in: ['draft', 'verified', 'approved'] }
        }
      });
    });

    // Trigger proactive aging refresh (non-blocking)
    appEvents.emit(AppEvent.ORDERS_DELETED);

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
    const customerUpdates = new Map<number, { count: number, total: Prisma.Decimal }>();
    const historyData: Prisma.OrderHistoryCreateManyInput[] = [];
    const actualOrderIds = orders.map(o => o.id);

    for (const order of orders) {
      // Aggregate customer stats
      const currentCust = customerUpdates.get(order.customerId) || { count: 0, total: Money.ZERO };
      customerUpdates.set(order.customerId, {
        count: currentCust.count + 1,
        total: Money.add(currentCust.total, order.totalAmount)
      });

      // Prepare history data
      historyData.push({
        tenantId: resolveTenantId(order.tenantId),
        orderId: order.id,
        status: order.status,
        notes: `Order deleted in bulk by user ${userId || 'system'} `,
        changedBy: userId
      });
    }

    // Perform bulk deletion in a single transaction
    await prisma.$transaction(async (tx) => {
      // Phase 1: reverse agent stock (sequential — each call makes multiple tx queries
      // that depend on per-order state, so they cannot be parallelised within the tx).
      // Performance ceiling: ~50ms × N orders. For bulk deletes > ~100 orders, consider
      // processing in smaller batches outside a single transaction.
      // Aggregate warehouse restocks into a Map for batched Phase 2
      const warehouseRestocks = new Map<number, number>(); // productId → qty
      const deductedStatuses = ['out_for_delivery', 'delivered'];

      for (const order of orders) {
        if (!deductedStatuses.includes(order.status)) continue;

        let reversedFromAgent: number[] = [];
        if (order.deliveryAgentId) {
          reversedFromAgent = await agentInventoryService.reverseOrderFulfillment(
            tx,
            order.id,
            order.deliveryAgentId,
            userId ?? order.deliveryAgentId,
            order.status === 'delivered'
          );
        }
        for (const item of order.orderItems) {
          if (reversedFromAgent.includes(item.productId)) continue;
          warehouseRestocks.set(
            item.productId,
            (warehouseRestocks.get(item.productId) ?? 0) + item.quantity
          );
        }
      }

      // Phase 2: batch warehouse restocks (1 update per distinct product)
      const updatePromises: Promise<any>[] = [];
      for (const [productId, quantity] of warehouseRestocks.entries()) {
        updatePromises.push(
          tx.product.update({
            where: { id: productId },
            data: { stockQuantity: { increment: quantity } }
          })
        );
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

    // Trigger proactive aging refresh (non-blocking)
    appEvents.emit(AppEvent.ORDERS_DELETED);

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
            tenantId: resolveTenantId(order.tenantId),
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
        tenantId: resolveTenantId(order.tenantId),
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
            tenantId: resolveTenantId(order.tenantId),
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
        tenantId: resolveTenantId(order.tenantId),
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

    // Revenue is the KPI delivered revenue (delivery-date basis); no dates means all time. The KPI range is [from, to).
    const { from, to } = kpiWindow(filters.startDate, filters.endDate);
    const [totalOrders, ordersByStatus, revenue, avgOrderValue] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ['status'],
        where,
        _count: true
      }),
      deliveredRevenue(resolveTenantId(), from, to, revenueScope(roleScope(requester))),
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
      totalRevenue: Money.parse(revenue.total.value),
      avgOrderValue: Money.orZero(avgOrderValue._avg.totalAmount)
    };

    return stats;
  }
}

export default new OrderService();
