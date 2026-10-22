import prisma, { prismaBase } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { Prisma, OrderStatus, DeclineReason, FailureReason } from '@prisma/client';
import logger from '../utils/logger';
import appEvents, { AppEvent, emitOrderCreatedEvent, emitOrderDeletedEvent } from '../utils/appEvents';
import { getSocketInstance } from '../utils/socketInstance';
import {
  emitOrderCreated,
  emitOrdersDeleted,
  emitToTenant,
} from '../sockets';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';
import { checkResourceOwnership, Requester } from '../utils/authUtils';
import { customerPhoneSearch, normalizePhone, normalizePhoneForStorage, phoneLookupVariants } from '../utils/phone';
import FinancialSyncService from './financialSyncService';
import { ORDER_EVENT_INCLUDE } from './orderSideEffects';
import assignmentService from './assignmentService';
import { transitionOrder, allowedTransitions, actorOf, ownsOrder, TransitionActor, TransitionOptions } from './orderStateMachine';
import { hasPermission } from '../middleware/auth';
import { findAndReactivateCustomerByPhone, findCustomerByPhoneIncludingArchived } from '../utils/customerLookup';
import { auditService } from './auditService';
import * as Money from '../utils/money';
import { roleScope } from '../utils/kpiRequest';
import orderFlagService, { OrderFlagCode } from './orderFlagService';
import { classifyQuery, nameMatch } from './searchService';
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
  /** Default: the sum of the lines. */
  subtotal?: Money.MoneyInput;
  shippingCost?: Money.MoneyInput;
  discount?: Money.MoneyInput;
  totalAmount: Money.MoneyInput;
  deliveryAddress: string;
  deliveryState: string;
  deliveryArea: string;
  notes?: string;
  estimatedDelivery?: Date;
  createdById?: number;
  /** F-317: the call rep and delivery agent. A sales_rep requester is always the call rep; only `orders:assign` roles may set either. */
  customerRepId?: number;
  deliveryAgentId?: number;
  /** F-317: "Customer already confirmed on this call". The order moves to confirmed through the machine and a manual `Call` is saved. */
  customerConfirmed?: boolean;
  requester?: Requester;
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

export const ORDER_SORT_FIELDS = ['id', 'customer', 'totalAmount', 'createdAt'] as const;
export type OrderSortField = typeof ORDER_SORT_FIELDS[number];
export type OrderInclude = 'flags' | 'reminder' | 'threadCount';

/** Filters shared by the list and the tab counts (F-308: counts use every filter except status). */
export interface OrderFilters {
  status?: OrderStatus[];
  customerId?: number;
  customerRepId?: number;
  /** Orders with no call rep. Wins over `customerRepId`. */
  unassigned?: boolean;
  deliveryAgentId?: number;
  productIds?: number[];
  area?: string;
  flag?: OrderFlagCode | 'any';
  /** What startDate and endDate filter on: order date (default) or delivery date. */
  dateBasis?: 'created' | 'delivery';
  startDate?: Date;
  endDate?: Date;
  search?: string;
}

export interface OrderListQuery extends OrderFilters {
  sortBy?: OrderSortField;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  include?: OrderInclude[];
}

/** A search term is cut at 100 characters and 5 name words, as in the command palette search. */
const SEARCH_MAX_LENGTH = 100;
const SEARCH_MAX_WORDS = 5;

/** Row scope: a rep sees orders where they are the call rep, a delivery agent their own deliveries. Other roles see all. */
function orderScope(requester?: Requester): Prisma.OrderWhereInput {
  if (requester?.role === 'sales_rep') return { customerRepId: requester.id };
  if (requester?.role === 'delivery_agent') return { deliveryAgentId: requester.id };
  return {};
}

/** The list `where`: tenant comes from the client extension. `withStatus: false` is the tab counts. */
function listWhere(filters: OrderFilters, requester: Requester | undefined, withStatus: boolean): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [orderScope(requester)];
  if (withStatus && filters.status?.length) and.push({ status: { in: filters.status } });
  if (filters.customerId) and.push({ customerId: filters.customerId });
  if (filters.unassigned) and.push({ customerRepId: null });
  else if (filters.customerRepId) and.push({ customerRepId: filters.customerRepId });
  if (filters.deliveryAgentId) and.push({ deliveryAgentId: filters.deliveryAgentId });
  if (filters.area) and.push({ deliveryArea: filters.area });
  if (filters.productIds?.length) and.push({ orderItems: { some: { productId: { in: filters.productIds } } } });
  if (filters.flag) and.push(orderFlagService.where(filters.flag));

  if (filters.startDate || filters.endDate) {
    const range = { ...(filters.startDate && { gte: filters.startDate }), ...(filters.endDate && { lte: filters.endDate }) };
    // Delivery date is set only by a delivery, so this basis shows delivered orders only (F-311).
    and.push(filters.dateBasis === 'delivery'
      ? { deliveryDate: range, status: { in: ['delivered', 'digital_delivered'] } }
      : { createdAt: range });
  }

  if (filters.search?.trim()) {
    // `#23001` is an order number; a phone matches in any format; words match the customer's names (F-310).
    const q = classifyQuery(filters.search.trim().slice(0, SEARCH_MAX_LENGTH));
    const customerMatch: Prisma.CustomerWhereInput[] = [
      ...q.phone.map((p) => p as Prisma.CustomerWhereInput),
      ...(q.nameWords.length ? [nameMatch(q.nameWords.slice(0, SEARCH_MAX_WORDS))] : []),
    ];
    // An empty OR matches nothing, as wanted for a term that is neither.
    and.push({
      OR: [
        ...(q.orderId !== null ? [{ id: q.orderId }] : []),
        ...(customerMatch.length ? [{ customer: { OR: customerMatch } }] : []),
      ],
    });
  }
  return { deletedAt: null, AND: and };
}

const SORT_ORDER_BY: Record<OrderSortField, (dir: Prisma.SortOrder) => Prisma.OrderOrderByWithRelationInput[]> = {
  id: (dir) => [{ id: dir }],
  customer: (dir) => [{ customer: { lastName: dir } }, { customer: { firstName: dir } }, { id: 'desc' }],
  totalAmount: (dir) => [{ totalAmount: dir }, { id: 'desc' }],
  createdAt: (dir) => [{ createdAt: dir }, { id: 'desc' }],
};

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
  // M2-T17: an integration move with an old deliveryDate fires no workflows, unless this is true
  runWorkflows?: boolean;
}


/** One order line as sent by an edit. */
interface ItemInput {
  productId: number;
  quantity: number;
  unitPrice: Money.MoneyInput;
  itemType?: 'package' | 'upsell';
  metadata?: any;
}

const itemSnapshot = (i: { productId: number; quantity: number; unitPrice: Money.MoneyInput }) =>
  ({ productId: i.productId, quantity: i.quantity, unitPrice: Money.toApi(i.unitPrice) });

/**
 * F-318: the fields an edit may change, by status. Before dispatch: everything. On the road: contact, address
 * and notes. Done or closed: notes only. (`payment_failed` has nothing dispatched, so it edits like the first group.)
 */
function editableFields(status: OrderStatus): string[] {
  if (status === 'out_for_delivery' || status === 'failed_delivery') {
    return ['customerPhone', 'alternatePhone', 'deliveryAddress', 'deliveryState', 'deliveryArea', 'notes'];
  }
  if (['delivered', 'digital_delivered', 'returned', 'cancelled'].includes(status)) return ['notes'];
  return ['customerName', 'customerPhone', 'alternatePhone', 'customerEmail', 'deliveryAddress', 'deliveryState', 'deliveryArea', 'orderItems', 'discount', 'totalAmount', 'notes'];
}

/** F-316: states that can be deleted. The others have money or stock effects. */
const DELETABLE_STATUSES: OrderStatus[] = [
  'pending_confirmation', 'payment_pending', 'payment_failed', 'confirmed', 'preparing', 'ready_for_pickup', 'cancelled', 'failed_delivery',
];

/** One bulk request covers up to 200 orders (F-313, F-314). */
export const BULK_ORDER_LIMIT = 200;

/** Per-order result of a bulk status change or assign. */
export interface BulkResult {
  succeeded: number[];
  failed: Array<{ id: number; code: string; message: string }>;
}

/** The ids of a bulk request without repeats, or HTTP 413 above the limit. */
function limitBulk(orderIds: number[]): number[] {
  const ids = [...new Set(orderIds)];
  if (ids.length > BULK_ORDER_LIMIT) {
    throw new AppError(`Select ${BULK_ORDER_LIMIT} orders or fewer.`, 413, 'TOO_MANY_ORDERS');
  }
  return ids;
}

/** One failed order of a bulk request: the error's code and message. An unexpected error is logged, not shown. */
function bulkFailure(id: number, error: unknown): BulkResult['failed'][number] {
  if (error instanceof AppError) {
    return { id, code: error.errorCode ?? (error.statusCode === 404 ? 'NOT_FOUND' : 'ERROR'), message: error.message };
  }
  logger.error('Bulk order change failed', { orderId: id, error: (error as Error).message });
  return { id, code: 'ERROR', message: 'This order could not be changed.' };
}

export class OrderService {
  /**
   * Orders list (F-307, F-310 to F-312): filters, server sort and pagination. `include` adds `flags`, `reminder`
   * and `threadCount` to each row; reminder and thread count are null until M9.
   */
  async getAllOrders(query: OrderListQuery, requester?: Requester) {
    const { sortBy = 'createdAt', sortOrder = 'desc', page = 1, limit = 20, include = [] } = query;
    this.checkRange(query);
    const where = listWhere(query, requester, true);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
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
        orderBy: SORT_ORDER_BY[sortBy](sortOrder)
      }),
      prisma.order.count({ where })
    ]);

    const flags = include.includes('flags') ? await orderFlagService.forOrders(orders.map((o) => o.id)) : null;
    const rows = orders.map((o) => ({
      ...o,
      ...(flags && { flags: flags.get(o.id) ?? [] }),
      ...(include.includes('reminder') && { reminder: null }),
      ...(include.includes('threadCount') && { threadCount: null }),
    }));

    return {
      orders: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Tab counts (F-308): every filter of the list except status, same row scope. `all` is the sum of the 12 statuses;
   * `waitingToDispatch` is confirmed + preparing + ready_for_pickup.
   */
  async getOrderCounts(filters: OrderFilters, requester?: Requester) {
    this.checkRange(filters);
    const groups = await prisma.order.groupBy({
      by: ['status'],
      where: listWhere(filters, requester, false),
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(Object.values(OrderStatus).map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const g of groups) byStatus[g.status] = g._count._all;
    return {
      all: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      byStatus,
      waitingToDispatch: byStatus.confirmed + byStatus.preparing + byStatus.ready_for_pickup,
    };
  }

  /** Rows the export would write (F-320): the list rows for the same filters. */
  async exportCount(filters: OrderFilters, requester?: Requester) {
    this.checkRange(filters);
    return prisma.order.count({ where: listWhere(filters, requester, true) });
  }

  /** The export rows in batches of `size`, newest id first, one cursor read per batch (never the whole set at once). */
  async *exportBatches(filters: OrderFilters, requester?: Requester, size = 1000) {
    const where = listWhere(filters, requester, true);
    let last: number | undefined;
    for (;;) {
      const rows = await prisma.order.findMany({
        where: last === undefined ? where : { AND: [where, { id: { lt: last } }] },
        orderBy: { id: 'desc' },
        take: size,
        include: {
          customer: { select: { firstName: true, lastName: true, phoneNumber: true, alternatePhone: true } },
          customerRep: { select: { firstName: true, lastName: true } },
          deliveryAgent: { select: { firstName: true, lastName: true } },
          orderItems: { include: { product: { select: { name: true } } } },
        },
      });
      if (rows.length === 0) return;
      yield rows;
      last = rows[rows.length - 1].id;
      if (rows.length < size) return;
    }
  }

  private checkRange({ startDate, endDate }: OrderFilters) {
    if (startDate && endDate && startDate > endDate) {
      throw new AppError('The start date is after the end date.', 400, 'INVALID_RANGE');
    }
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

    // Call rep and delivery agent (F-317). A rep's own order is theirs; the assign fields need `orders:assign`.
    let customerRepId = data.customerRepId;
    let deliveryAgentId = data.deliveryAgentId;
    if (data.requester?.role === 'sales_rep') {
      customerRepId = data.requester.id;
      if (deliveryAgentId) throw new AppError('You cannot assign a delivery agent.', 403, 'FORBIDDEN');
    } else if ((customerRepId || deliveryAgentId) && data.requester && !(await hasPermission(data.requester, 'orders', 'assign'))) {
      throw new AppError('You do not have permission to assign this order.', 403, 'FORBIDDEN');
    }
    if (customerRepId && customerRepId !== data.requester?.id) await assignmentService.loadAssignee(customerRepId, 'sales_rep');
    if (deliveryAgentId) await assignmentService.loadAssignee(deliveryAgentId, 'delivery_agent', { checkAvailable: true });
    if (data.customerConfirmed && !data.createdById) {
      throw new AppError('A confirmed order needs the person who took the call.', 400);
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

    const subtotal = data.subtotal ?? Money.sum(data.orderItems.map((item) => Money.mul(item.quantity, item.unitPrice)));
    let confirmMove: Awaited<ReturnType<typeof transitionOrder>> | undefined;

    // Create order in transaction
    const created = await prisma.$transaction(async (tx) => {
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
          subtotal,
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
          customerRepId,
          deliveryAgentId,
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

      if (data.customerConfirmed) {
        // F-317: created, then moved by the machine; the call row is what the pay rule reads
        confirmMove = await transitionOrder(newOrder.id, 'confirmed', actorOf(data.requester, data.createdById), {
          tx,
          note: 'Customer confirmed on the call',
        });
        const calledAt = new Date();
        await tx.call.create({
          data: {
            tenantId: resolveTenantId(customer.tenantId),
            customerId: customer.id,
            orderId: newOrder.id,
            salesRepId: data.createdById!,
            outcome: 'confirmed',
            source: 'manual',
            startedAt: calledAt,
          },
        });
        await tx.order.updateMany({ where: { id: newOrder.id, firstContactAt: null }, data: { firstContactAt: calledAt } });
      }

      return newOrder;
    });
    confirmMove?.afterCommit?.();
    const order = confirmMove
      ? await prisma.order.findUniqueOrThrow({ where: { id: created.id }, include: { customer: true, orderItems: { include: { product: true } } } })
      : created;

    logger.info(`Order created`, { orderId: order.id });

    // Emit socket event for real-time update
    emitOrderCreated(getSocketInstance() as any, order);

    // order_created workflows listen to this event (after commit, M2-T17)
    emitOrderCreatedEvent(order);

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
    silent: boolean = false,
    // M2-T17: an imported order whose status is not pending_confirmation fires no workflows, unless this is true
    { runWorkflows }: { runWorkflows?: boolean } = {}
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
                imported: true,
                runWorkflows,
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

          emitOrderCreatedEvent(createdOrder, { imported: true, runWorkflows });

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
   * Edit an order (F-318). Which fields may change depends on the status (`editableFields`); a locked field
   * that really changes is refused, one sent back unchanged is ignored. A status in the body is a move through
   * the machine. `statusVersion` / `updatedAt` in the body is the version check (STALE_ORDER, 409).
   */
  async updateOrder(orderId: number, updateData: any, requester?: Requester) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      include: { customer: true, orderItems: true }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // The delivery agent cannot edit; a rep edits own orders only (call rep, not delivery agent)
    if (requester?.role === 'delivery_agent') {
      throw new AppError('You do not have permission to update this order', 403);
    }
    if (requester?.role === 'sales_rep' && order.customerRepId !== requester.id) {
      throw new AppError('You do not have permission to update this order', 403);
    }

    const {
      // D9: a status in this body is a move; it goes through the state machine and never into the generic update
      status: requestedStatus,
      force,
      reason,
      declineReason,
      failureReason,
      nextAttemptDate,
      statusVersion,
      updatedAt: clientUpdatedAt,
      confirmTotalChange,
      confirmPhoneChange,
      subtotal: _subtotal, // always the sum of the lines
      ...fields
    } = updateData;

    if (
      (statusVersion !== undefined && Number(statusVersion) !== order.statusVersion)
      || (clientUpdatedAt && new Date(clientUpdatedAt).getTime() !== order.updatedAt.getTime())
    ) {
      throw new AppError('This order changed. Reload to see the new data.', 409, 'STALE_ORDER');
    }

    const targetStatus: OrderStatus = requestedStatus ?? order.status;
    const plan = await this.planEdit(order, fields, targetStatus, requester, { confirmTotalChange, confirmPhoneChange });

    // First the move (its own transaction, so a refused move changes nothing), then the other fields.
    let moved = false;
    if (requestedStatus && requestedStatus !== order.status) {
      await transitionOrder(orderId, requestedStatus, actorOf(requester), this.moveOptions({
        force,
        reason,
        declineReason,
        failureReason,
        nextAttemptDate: nextAttemptDate ? new Date(nextAttemptDate) : undefined,
      }));
      moved = true;
    }

    if (plan.changed.length === 0) {
      return prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true, orderItems: { include: { product: true } } } });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // The lock: nobody saved since we read the row (after a move the row changed on purpose, so the move is the check)
      const locked = await tx.order.updateMany({
        where: { id: orderId, ...(!moved && { updatedAt: order.updatedAt }) },
        data: { ...plan.orderData, updatedAt: new Date() },
      });
      if (locked.count === 0) {
        throw new AppError('This order changed. Reload to see the new data.', 409, 'STALE_ORDER');
      }
      if (Object.keys(plan.customerData).length > 0) {
        await tx.customer.update({ where: { id: order.customerId }, data: plan.customerData });
      }
      if (plan.items) {
        await tx.orderItem.deleteMany({ where: { orderId } });
        await tx.orderItem.createMany({
          data: plan.items.map((item) => ({
            orderId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: Money.roundHalfUp(Money.mul(item.unitPrice, item.quantity), 4),
            itemType: item.itemType,
            metadata: item.metadata,
          }))
        });
      }
      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { customer: true, orderItems: { include: { product: true } } },
      });
    });

    await auditService.record({
      actorId: requester?.id,
      actorKind: requester ? 'person' : 'system',
      channel: requester ? 'app' : 'system',
      action: 'update_order',
      resource: 'order',
      resourceId: String(orderId),
      before: plan.before,
      after: plan.after,
      metadata: { fields: plan.changed },
    });

    logger.info(`Order updated: ${orderId} `, { orderId: orderId });
    return updated;
  }

  /**
   * The checks and the write set of one edit: what really changes, whether the status allows it, the phone,
   * total and item rules. Throws before anything is written.
   */
  private async planEdit(
    order: Prisma.OrderGetPayload<{ include: { customer: true; orderItems: true } }>,
    fields: Record<string, any>,
    status: OrderStatus,
    requester: Requester | undefined,
    confirm: { confirmTotalChange?: boolean; confirmPhoneChange?: boolean },
  ) {
    const customer = order.customer;
    const items: ItemInput[] | undefined = Array.isArray(fields.orderItems) ? fields.orderItems : undefined;
    const sameText = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim();
    const samePhone = (input: unknown, stored: string | null) => {
      const wanted = String(input ?? '').trim();
      return wanted === '' ? !stored : !!stored && phoneLookupVariants(wanted).includes(stored);
    };
    const itemKey = (list: Array<{ productId: number; quantity: number; unitPrice: Money.MoneyInput }>) =>
      list.map((i) => `${i.productId}:${i.quantity}:${Money.toApi(i.unitPrice)}`).sort().join('|');
    const customerName = `${customer.firstName} ${customer.lastName}`.trim();

    // What differs from the stored order. Unknown keys always count as a change, so they are refused.
    const differs: Record<string, () => boolean> = {
      customerName: () => !sameText(fields.customerName, customerName),
      customerEmail: () => !sameText(fields.customerEmail, customer.email),
      customerPhone: () => !samePhone(fields.customerPhone, customer.phoneNumber),
      alternatePhone: () => !samePhone(fields.alternatePhone, customer.alternatePhone),
      deliveryAddress: () => !sameText(fields.deliveryAddress, order.deliveryAddress),
      deliveryState: () => !sameText(fields.deliveryState, order.deliveryState),
      deliveryArea: () => !sameText(fields.deliveryArea, order.deliveryArea),
      notes: () => !sameText(fields.notes, order.notes),
      discount: () => Money.compare(fields.discount ?? 0, order.discount) !== 0,
      totalAmount: () => Money.compare(fields.totalAmount, order.totalAmount) !== 0,
      orderItems: () => !!items && itemKey(items) !== itemKey(order.orderItems),
    };
    const changed = Object.keys(fields).filter((key) => fields[key] !== undefined && (differs[key]?.() ?? true));

    const allowed = editableFields(status);
    const locked = changed.filter((key) => !allowed.includes(key));
    if (locked.length > 0) {
      throw new AppError(`You cannot change ${locked.join(', ')} on an order that is ${status.replace(/_/g, ' ')}.`, 400, 'FIELD_NOT_EDITABLE');
    }

    const orderData: Prisma.OrderUncheckedUpdateManyInput = {};
    const customerData: Prisma.CustomerUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const note = (key: string, was: unknown, now: unknown) => { before[key] = was; after[key] = now; };

    for (const key of ['deliveryAddress', 'deliveryState', 'deliveryArea', 'notes'] as const) {
      if (changed.includes(key)) { orderData[key] = fields[key]; note(key, order[key], fields[key]); }
    }
    if (changed.includes('customerName')) {
      const parts = String(fields.customerName).trim().split(' ');
      customerData.firstName = parts[0] || 'Unknown';
      customerData.lastName = parts.slice(1).join(' ') || '';
      note('customerName', customerName, fields.customerName);
    }
    if (changed.includes('customerEmail')) {
      customerData.email = fields.customerEmail || null;
      note('customerEmail', customer.email, customerData.email);
    }
    if (changed.includes('alternatePhone')) {
      customerData.alternatePhone = normalizePhoneForStorage(fields.alternatePhone) || null;
      note('alternatePhone', customer.alternatePhone, customerData.alternatePhone);
    }

    if (changed.includes('customerPhone')) {
      const phone = normalizePhoneForStorage(fields.customerPhone);
      if (!phone) throw new AppError('Enter the customer phone number.', 400, 'PHONE_REQUIRED');
      const owner = await findCustomerByPhoneIncludingArchived(prisma, phone);
      if (owner && owner.id !== customer.id) {
        const name = `${owner.firstName} ${owner.lastName}`.trim();
        const err = new AppError(`This number belongs to ${name}`, 409, 'PHONE_BELONGS_TO_OTHER_CUSTOMER');
        err.details = { customerId: owner.id, customerName: name };
        throw err;
      }
      // The number is the customer's, so it changes for their other orders too: that needs a Yes
      const otherOrders = await prisma.order.count({ where: { customerId: order.customerId, id: { not: order.id }, deletedAt: null } });
      if (otherOrders > 0 && confirm.confirmPhoneChange !== true) {
        const err = new AppError("Update the number for all of this customer's orders?", 409, 'PHONE_CHANGE_NEEDS_CONFIRMATION');
        err.details = { otherOrders };
        throw err;
      }
      customerData.phoneNumber = phone;
      note('customerPhone', customer.phoneNumber, phone);
    }

    // Lines, discount and total (F-318): lines first, then the total the user typed or the one the lines give
    let newItems: ItemInput[] | undefined;
    if (items && changed.includes('orderItems')) {
      newItems = await this.checkEditedItems(items, order.orderItems, requester);
      orderData.subtotal = Money.sum(newItems.map((i) => Money.mul(i.quantity, i.unitPrice)));
      note('orderItems', order.orderItems.map(itemSnapshot), newItems.map(itemSnapshot));
    }
    const discount = changed.includes('discount') ? Money.parse(fields.discount ?? 0) : Money.parse(order.discount);
    if (changed.includes('discount')) { orderData.discount = discount; note('discount', Money.toApi(order.discount), Money.toApi(discount)); }

    if (newItems || changed.includes('discount') || changed.includes('totalAmount')) {
      const subtotal = Money.parse((orderData.subtotal as Money.MoneyInput | undefined) ?? order.subtotal);
      const total = fields.totalAmount !== undefined
        ? Money.parse(fields.totalAmount)
        : Money.add(Money.sub(subtotal, discount), order.shippingCost);
      if (total.isNegative()) throw new AppError('The total cannot be below zero.', 400, 'INVALID_TOTAL');
      if (Money.compare(total, order.totalAmount) !== 0) {
        if (status === 'confirmed' && confirm.confirmTotalChange !== true) {
          const err = new AppError(`The customer confirmed ${Money.toApi(order.totalAmount)}. The new total is ${Money.toApi(total)}.`, 400, 'TOTAL_CHANGE_NOT_CONFIRMED');
          err.details = { oldTotal: Money.toApi(order.totalAmount), newTotal: Money.toApi(total) };
          throw err;
        }
        orderData.totalAmount = total;
        // The cash to collect follows the total while it followed it before
        if (order.codAmount && Money.compare(order.codAmount, order.totalAmount) === 0) orderData.codAmount = total;
        note('totalAmount', Money.toApi(order.totalAmount), Money.toApi(total));
      }
    }

    return { changed, orderData, customerData, items: newItems, before, after };
  }

  /** Lines of an edit: at least one, known products, whole quantities, and stock for any line that is new or bigger. */
  private async checkEditedItems(items: ItemInput[], current: Array<{ productId: number; quantity: number; unitPrice: Money.MoneyInput }>, requester?: Requester): Promise<ItemInput[]> {
    if (items.length === 0) throw new AppError('An order needs at least one item', 400, 'ITEMS_REQUIRED');
    const products = await prisma.product.findMany({ where: { id: { in: [...new Set(items.map((i) => i.productId))] } } });
    const productMap = new Map(products.map((p) => [p.id, p]));
    const canGiveAway = !requester || requester.role === 'super_admin' || requester.role === 'admin';
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) throw new AppError(`Product ID ${item.productId} not found`, 404);
      if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new AppError('Quantity must be a whole number above 0.', 400, 'INVALID_QUANTITY');
      if (Money.tryParse(item.unitPrice)?.isNegative() ?? true) throw new AppError('Enter a price for each item.', 400, 'INVALID_PRICE');
      const was = current.find((c) => c.productId === item.productId);
      if (Money.parse(item.unitPrice).isZero() && !canGiveAway && !(was && Money.parse(was.unitPrice).isZero())) {
        throw new AppError('Only the owner and admins can set a price to 0.', 403, 'PRICE_ZERO_ADMIN_ONLY');
      }
      // Current stock number until M4 (available to sell); a line that did not grow is not checked again
      if ((!was || item.quantity > was.quantity) && product.stockQuantity < item.quantity) {
        throw new AppError(`Insufficient stock for product ${product.name}. Current stock: ${product.stockQuantity} `, 400);
      }
    }
    return items.map((item) => ({ ...item, itemType: item.itemType || 'package', metadata: item.metadata || null }));
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
      runWorkflows: data.runWorkflows,
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
      const searchNum = parseInt(filters.search.replace(/^#/, ''));
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
   * Soft delete one order (F-316). A thin wrapper over `softDeleteOrders`: a refusal becomes the error.
   */
  async deleteOrder(orderId: number, userId?: number, requester?: Requester) {
    const { skipped } = await this.softDeleteOrders([orderId], userId, requester);
    if (skipped.length) {
      throw new AppError(skipped[0].reason, skipped[0].httpStatus, skipped[0].code);
    }
    return { message: 'Order deleted successfully' };
  }

  /**
   * Bulk soft delete (F-315): deletes what the rules allow and lists the rest in `skipped`.
   */
  async bulkDeleteOrders(orderIds: number[], userId?: number, requester?: Requester) {
    if (!orderIds || orderIds.length === 0) {
      throw new AppError('No order IDs provided', 400);
    }
    const { deleted, skipped } = await this.softDeleteOrders(orderIds, userId, requester);
    return {
      message: `Successfully deleted ${deleted.length} order(s)`,
      deletedCount: deleted.length,
      deleted: deleted.length,
      skipped: skipped.map(({ id, reason }) => ({ id, reason })),
    };
  }

  /**
   * The one delete path. Orders in a state with money or stock effects (out for delivery, delivered, digital delivered,
   * returned) are refused, as are ids that are missing or not the requester's. The rest are soft deleted in one
   * transaction with one history row each, a draft AgentCollection removed and ONE audit row holding the id list.
   */
  private async softDeleteOrders(orderIds: number[], userId?: number, requester?: Requester) {
    const found = await prisma.order.findMany({ where: { id: { in: orderIds }, deletedAt: null } });
    const byId = new Map(found.map((o) => [o.id, o]));

    const deleted: typeof found = [];
    const skipped: Array<{ id: number; reason: string; httpStatus: number; code: string }> = [];
    for (const id of [...new Set(orderIds)]) {
      const order = byId.get(id);
      if (!order) {
        skipped.push({ id, reason: 'Order not found', httpStatus: 404, code: 'NOT_FOUND' });
      } else if (requester && !checkResourceOwnership(requester, {
        assignedRepId: order.customerRepId,
        deliveryAgentId: order.deliveryAgentId,
        customerId: order.customerId
      }, 'order')) {
        skipped.push({ id, reason: 'You do not have permission to delete this order', httpStatus: 403, code: 'FORBIDDEN' });
      } else if (!DELETABLE_STATUSES.includes(order.status)) {
        skipped.push({ id, reason: 'Cancel or return the order first.', httpStatus: 409, code: 'ORDER_NOT_DELETABLE' });
      } else {
        deleted.push(order);
      }
    }
    if (!deleted.length) return { deleted, skipped };

    const deletedIds = deleted.map((o) => o.id);
    const customerUpdates = new Map<number, { count: number, total: Prisma.Decimal }>();
    for (const order of deleted) {
      const current = customerUpdates.get(order.customerId) || { count: 0, total: Money.ZERO };
      customerUpdates.set(order.customerId, { count: current.count + 1, total: Money.add(current.total, order.totalAmount) });
    }

    await prisma.$transaction(async (tx) => {
      await Promise.all([...customerUpdates.entries()].map(([customerId, stats]) =>
        tx.customer.update({
          where: { id: customerId },
          data: { totalOrders: { decrement: stats.count }, totalSpent: { decrement: stats.total } }
        })));

      await tx.orderHistory.createMany({
        data: deleted.map((order) => ({
          tenantId: resolveTenantId(order.tenantId),
          orderId: order.id,
          status: order.status,
          notes: `Order deleted by user ${userId || 'system'} `,
          changedBy: userId
        }))
      });

      await tx.order.updateMany({ where: { id: { in: deletedIds } }, data: { deletedAt: new Date() } });

      // A draft collection of a deleted order is void. Later stages hold money and stay.
      await tx.agentCollection.deleteMany({ where: { orderId: { in: deletedIds }, status: 'draft' } });

      await tx.auditLog.create({
        data: {
          tenantId: resolveTenantId(deleted[0].tenantId),
          userId,
          action: orderIds.length === 1 ? 'delete_order' : 'bulk_delete_orders',
          resource: 'order',
          resourceId: deletedIds.length === 1 ? String(deletedIds[0]) : null,
          metadata: { orderIds: deletedIds, skipped: skipped.map(({ id, reason }) => ({ id, reason })) },
          ...(requester && { actorKind: 'person' as const, channel: 'app' as const })
        }
      });
    });

    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitOrdersDeleted(ioInstance as any, deletedIds);
    }

    logger.info(`Orders soft deleted: ${deletedIds.join(', ')} `, { orderIds: deletedIds, userId });

    // Trigger proactive aging refresh (non-blocking) and the customer stats refresh
    appEvents.emit(AppEvent.ORDERS_DELETED);
    deleted.forEach((o) => emitOrderDeletedEvent(o));

    return { deleted, skipped };
  }

  /**
   * Assign customer rep to order
   */
  async assignCustomerRep(orderId: number, customerRepId: number, requester: Requester) {
    // Only admin/manager can assign reps
    if (requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      throw new AppError('Only administrators or managers can assign customer representatives', 403);
    }
    return assignmentService.assignByRole(orderId, customerRepId, 'sales_rep', actorOf(requester));
  }

  /**
   * Assign delivery agent to order. `confirmBlocked`: the owner confirmed a partner who is blocked for unpaid cash.
   */
  async assignDeliveryAgent(orderId: number, deliveryAgentId: number, requester: Requester, confirmBlocked = false) {
    // Only admin/manager/sales_rep can assign delivery agent (sometimes sales reps do it after confirmation)
    // Actually, usually managers assign agents. Let's stick to manager+ for now, or check ownership.
    if (requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      // Check if sales rep is assigned to this order
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order || order.customerRepId !== requester.id) {
        throw new AppError('Only managers or the assigned sales representative can assign delivery agents', 403);
      }
    }
    return assignmentService.assignByRole(orderId, deliveryAgentId, 'delivery_agent', actorOf(requester), { checkAvailable: true, confirmBlocked });
  }

  /** "Unassign both" for one order (F-314): same role gate as assigning a rep. */
  async unassignOrder(orderId: number, requester: Requester) {
    this.assertCanAssign(requester);
    return assignmentService.unassignBoth(orderId, actorOf(requester));
  }

  private assertCanAssign(requester: Requester) {
    if (requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      throw new AppError('Only administrators or managers can assign orders', 403);
    }
  }

  /**
   * Bulk status change (F-313): each order goes through the state machine alone, with its own history row and side
   * effects. A move that fails does not stop the others. The partial result lists every failure with a code.
   */
  async bulkUpdateStatus(
    data: { orderIds: number[]; status: OrderStatus; note?: string; declineReason?: DeclineReason; failureReason?: FailureReason; nextAttemptDate?: Date },
    requester: Requester,
  ): Promise<BulkResult> {
    const { orderIds, ...move } = data;
    const result: BulkResult = { succeeded: [], failed: [] };
    for (const id of limitBulk(orderIds)) {
      try {
        await this.updateOrderStatus(id, { status: move.status, notes: move.note, declineReason: move.declineReason, failureReason: move.failureReason, nextAttemptDate: move.nextAttemptDate }, requester);
        result.succeeded.push(id);
      } catch (error) {
        result.failed.push(bulkFailure(id, error));
      }
    }
    return result;
  }

  /**
   * Bulk assign (F-314): one call rep, one delivery agent or both for up to 200 orders. The people are checked once
   * (missing, wrong role, deactivated, unavailable or blocked fails the whole request); then each order is assigned
   * alone and failures are listed.
   */
  async bulkAssign(
    data: { orderIds: number[]; customerRepId?: number; deliveryAgentId?: number; confirmBlocked?: boolean; unassign?: 'both' },
    requester: Requester,
  ): Promise<BulkResult> {
    this.assertCanAssign(requester);
    const ids = limitBulk(data.orderIds);
    const { customerRepId, deliveryAgentId, confirmBlocked } = data;
    if (data.unassign === 'both') {
      const cleared: BulkResult = { succeeded: [], failed: [] };
      for (const id of ids) {
        try {
          await assignmentService.unassignBoth(id, actorOf(requester));
          cleared.succeeded.push(id);
        } catch (error) {
          cleared.failed.push(bulkFailure(id, error));
        }
      }
      return cleared;
    }
    if (customerRepId) await assignmentService.loadAssignee(customerRepId, 'sales_rep');
    if (deliveryAgentId) await assignmentService.loadAssignee(deliveryAgentId, 'delivery_agent', { checkAvailable: true, confirmBlocked });

    const actor = actorOf(requester);
    const result: BulkResult = { succeeded: [], failed: [] };
    for (const id of ids) {
      try {
        if (customerRepId) await assignmentService.assignByRole(id, customerRepId, 'sales_rep', actor);
        if (deliveryAgentId) await assignmentService.assignByRole(id, deliveryAgentId, 'delivery_agent', actor, { checkAvailable: true, confirmBlocked });
        result.succeeded.push(id);
      } catch (error) {
        result.failed.push(bulkFailure(id, error));
      }
    }
    return result;
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

/**
 * Set an order's priority and/or append to its notes, in one tenant-scoped write. These two fields only:
 * the data object is built here, so no status (or anything else) can ride along. Callers validate the values.
 */
export async function setOrderPriorityAndNotes(orderId: number, fields: { priority?: number; notes?: string }): Promise<void> {
  const order = await prisma.order.findFirst({ where: { id: orderId }, select: { notes: true } });
  if (!order) throw new AppError('Order not found', 404);
  const data: { priority?: number; notes?: string } = {};
  if (fields.priority !== undefined) data.priority = fields.priority;
  if (fields.notes !== undefined) data.notes = order.notes ? `${order.notes}\n${fields.notes}` : fields.notes;
  await prisma.order.update({ where: { id: orderId }, data });
}

export default new OrderService();
