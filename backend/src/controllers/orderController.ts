import { Response } from 'express';
import { AuthRequest } from '../types';
import { OrderStatus } from '@prisma/client';
import orderService, { OrderFilters, OrderInclude, OrderSortField } from '../services/orderService';
import { clearCache } from '../middleware/cache';
import { readDateBound } from '../utils/kpiRequest';
import { ALL_STATUSES } from '../services/orderStateMachine';
import { assertWithinCap, BatchRow, ExportColumn, exportDate, exportMoney, exportPhone, readFormat, streamExport } from '../services/exportStream';

/** Filters shared by the list and the tab counts. Sort, page and include are read by the list only. */
const readOrderFilters = (query: AuthRequest['query']): OrderFilters => {
  const { status, customerId, customerRepId, unassigned, deliveryAgentId, area, flag, dateBasis, startDate, endDate, search } = query;
  const many = (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

  return {
    status: status ? many(status) as OrderStatus[] : undefined,
    customerId: customerId ? Number(customerId) : undefined,
    customerRepId: customerRepId ? Number(customerRepId) : undefined,
    unassigned: unassigned === 'true',
    deliveryAgentId: deliveryAgentId ? Number(deliveryAgentId) : undefined,
    // `productId=1&productId=2` and `productId[]=1` both arrive as an array
    productIds: many(query.productId).map(Number).filter(Number.isInteger),
    area: area as string | undefined,
    flag: flag as OrderFilters['flag'],
    dateBasis: dateBasis as OrderFilters['dateBasis'],
    startDate: readDateBound(startDate, 'from'),
    endDate: readDateBound(endDate, 'to'),
    search: search as string | undefined,
  };
};

export const getAllOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  const { sortBy, sortOrder, page = 1, limit = 50, include } = req.query;
  // Row scope (a rep sees own orders, an agent own deliveries) is applied in the service from req.user
  const result = await orderService.getAllOrders({
    ...readOrderFilters(req.query),
    sortBy: sortBy as OrderSortField | undefined,
    sortOrder: sortOrder as 'asc' | 'desc' | undefined,
    page: Number(page),
    limit: Number(limit),
    include: String(include ?? '').split(',').filter((i): i is OrderInclude => ['flags', 'reminder', 'threadCount'].includes(i)),
  }, req.user);

  res.json(result);
};

export const getOrderCounts = async (req: AuthRequest, res: Response): Promise<void> => {
  // Tabs count every filter except status
  const { status: _status, ...filters } = readOrderFilters(req.query);
  res.json(await orderService.getOrderCounts(filters, req.user));
};

type ExportOrder = BatchRow<ReturnType<typeof orderService.exportBatches>>;
const fullName = (u: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');

/** F-320 columns. The order number is the id; the id the 3PL or store gave sits beside it. */
const ORDER_EXPORT_COLUMNS: ExportColumn<ExportOrder>[] = [
  { header: 'Order number', value: (o) => o.id },
  { header: 'External order ID', value: (o) => o.externalOrderId },
  { header: 'Date', value: (o) => exportDate(o.createdAt) },
  { header: 'Customer', value: (o) => fullName(o.customer) },
  { header: 'Phone', value: (o) => exportPhone(o.customer?.phoneNumber), kind: 'phone' },
  { header: 'Alternate phone', value: (o) => exportPhone(o.customer?.alternatePhone), kind: 'phone' },
  { header: 'Region', value: (o) => o.deliveryState },
  { header: 'Town', value: (o) => o.deliveryArea },
  { header: 'Address', value: (o) => o.deliveryAddress },
  { header: 'Products', value: (o) => o.orderItems.map((i) => `${i.product?.name ?? 'Product'} x ${i.quantity}`).join('; ') },
  { header: 'Quantity', value: (o) => o.orderItems.reduce((sum, i) => sum + i.quantity, 0), kind: 'count' },
  { header: 'Status', value: (o) => o.status },
  { header: 'Call rep', value: (o) => fullName(o.customerRep) },
  { header: 'Delivery agent', value: (o) => fullName(o.deliveryAgent) },
  { header: 'Subtotal', value: (o) => exportMoney(o.subtotal), kind: 'money' },
  { header: 'Discount', value: (o) => exportMoney(o.discount), kind: 'money' },
  { header: 'Total', value: (o) => exportMoney(o.totalAmount), kind: 'money' },
  { header: 'Payment method', value: (o) => o.paymentMethod },
  { header: 'Payment status', value: (o) => o.paymentStatus },
  { header: 'Delivery date', value: (o) => exportDate(o.deliveryDate) },
  { header: 'Decline or failure reason', value: (o) => o.declineReason ?? o.failureReason },
  { header: 'Source', value: (o) => o.source },
];

/** F-320: the list filters and row scope, streamed as CSV or XLSX. */
export const exportOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  const format = readFormat(req.query.format);
  const filters = readOrderFilters(req.query);
  assertWithinCap(await orderService.exportCount(filters, req.user));
  await streamExport(res, {
    format,
    filename: `orders-${new Date().toISOString().slice(0, 10)}`,
    columns: ORDER_EXPORT_COLUMNS,
    batches: orderService.exportBatches(filters, req.user),
  });
};

export const createOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      customerId,
      customerPhone,
      customerEmail,
      customerName,
      alternatePhone,
      orderItems,
      subtotal,
      shippingCost,
      discount,
      totalAmount,
      deliveryAddress,
      deliveryState,
      deliveryArea,
      notes,
      estimatedDelivery,
      customerRepId,
      deliveryAgentId,
      customerConfirmed
    } = req.body;

    const order = await orderService.createOrder({
      customerId,
      customerPhone,
      customerEmail,
      customerName,
      alternatePhone,
      orderItems,
      subtotal,
      shippingCost,
      discount,
      totalAmount,
      deliveryAddress,
      deliveryState,
      deliveryArea,
      notes,
      estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : undefined,
      createdById: req.user?.id,
      // F-317: a status in the body is not read. Every manual order starts at pending_confirmation.
      customerRepId: customerRepId ? Number(customerRepId) : undefined,
      deliveryAgentId: deliveryAgentId ? Number(deliveryAgentId) : undefined,
      customerConfirmed: customerConfirmed === true,
      requester: req.user
    });

    // Invalidate analytics cache
    clearCache('/api/analytics');

    res.status(201).json({ order });
  } catch (error) {
    throw error;
  }
};

export const bulkImportOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orders } = req.body;

    if (!Array.isArray(orders) || orders.length === 0) {
      throw new Error('Invalid orders data');
    }

    const results = await orderService.bulkImportOrders(orders, req.user?.id, undefined, undefined, true, {
      runWorkflows: req.body.runWorkflows === true ? true : undefined,
    });

    // Invalidate analytics cache after bulk import
    clearCache('/api/analytics');

    res.json({ results });
  } catch (error) {
    throw error;
  }
};

export const getOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const order = await orderService.getOrderById(Number(id), req.user);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const updateOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const order = await orderService.updateOrder(Number(id), updateData, req.user);

    // Invalidate analytics cache
    clearCache('/api/analytics');

    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const deleteOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await orderService.deleteOrder(Number(id), req.user?.id, req.user);

    // Invalidate analytics cache
    clearCache('/api/analytics');

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const bulkDeleteOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = req.body;
    const result = await orderService.bulkDeleteOrders(ids, req.user?.id, req.user);

    // Invalidate analytics cache
    clearCache('/api/analytics');

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const updateOrderStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, note, force, reason, declineReason, failureReason, nextAttemptDate } = req.body;

    const order = await orderService.updateOrderStatus(Number(id), {
      status: status as OrderStatus,
      notes: note,
      changedBy: req.user?.id,
      force,
      reason,
      declineReason,
      failureReason,
      nextAttemptDate: nextAttemptDate ? new Date(nextAttemptDate) : undefined
    }, req.user);

    // Invalidate analytics cache as status change affects metrics
    clearCache('/api/analytics');

    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const bulkUpdateOrderStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const { orderIds, status, note, declineReason, failureReason, nextAttemptDate } = req.body;
  const result = await orderService.bulkUpdateStatus({
    orderIds, status, note, declineReason, failureReason,
    nextAttemptDate: nextAttemptDate ? new Date(nextAttemptDate) : undefined
  }, req.user!);

  // Invalidate analytics cache as status changes affect metrics
  clearCache('/api/analytics');

  res.json(result);
};

export const bulkAssignOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  const { orderIds, customerRepId, deliveryAgentId, confirmBlocked, unassign } = req.body;
  res.json(await orderService.bulkAssign({ orderIds, customerRepId, deliveryAgentId, confirmBlocked: confirmBlocked === true, unassign }, req.user!));
};

export const getOrderTransitions = async (req: AuthRequest, res: Response): Promise<void> => {
  const transitions = await orderService.getTransitions(Number(req.params.id), req.user!);
  res.json(transitions);
};
export const getOrderStatuses = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ statuses: ALL_STATUSES });
};
// ... rest of file (assignCustomerRep, etc)

export const assignCustomerRep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { customerRepId, unassign } = req.body;
    if (unassign === 'both') {
      res.json({ order: await orderService.unassignOrder(Number(id), req.user!) });
      return;
    }
    const order = await orderService.assignCustomerRep(Number(id), Number(customerRepId), req.user!);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const assignDeliveryAgent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { deliveryAgentId, confirmBlocked, unassign } = req.body;
    if (unassign === 'both') {
      res.json({ order: await orderService.unassignOrder(Number(id), req.user!) });
      return;
    }
    const order = await orderService.assignDeliveryAgent(Number(id), Number(deliveryAgentId), req.user!, confirmBlocked === true);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const getKanbanView = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { area, agentId } = req.query;
    const kanban = await orderService.getKanbanView({
      area: area as string | undefined,
      agentId: agentId as string | undefined
    }, req.user);
    res.json({ kanban });
  } catch (error) {
    throw error;
  }
};

export const getOrderStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await orderService.getOrderStats({
      startDate: readDateBound(startDate, 'from'),
      endDate: readDateBound(endDate, 'to')
    }, req.user);
    res.json({ stats });
  } catch (error) {
    throw error;
  }
};
