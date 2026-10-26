import apiClient from './api';
import { markOwnMoves } from './ownMoves';
import { Order, OrderStatus, FilterOptions, PaginationMeta, FailureReason, DeclineReason } from '../types';

/** Reasons the order state machine can ask for with a status move (PATCH /api/orders/:id/status). */
export interface StatusMoveExtras {
  failureReason?: FailureReason;
  declineReason?: DeclineReason;
  nextAttemptDate?: string;
  force?: boolean;
  reason?: string;
}

/** One row of GET /api/orders as the Orders list reads it (M3-T11: include=flags,reminder,threadCount). */
export interface OrderListRow {
  id: number;
  status: OrderStatus;
  /** Digital orders move differently from physical ones (F-301). */
  orderType?: 'physical' | 'digital';
  totalAmount: number;
  createdAt: string;
  customer: { id: number; firstName: string; lastName: string; phoneNumber: string; alternatePhone?: string | null };
  /** null when nobody is assigned; also null for a removed user. */
  customerRep: { id: number; firstName: string; lastName: string } | null;
  deliveryAgent: { id: number; firstName: string; lastName: string } | null;
  orderItems: Array<{
    id: number;
    quantity: number;
    itemType?: string | null;
    metadata?: { upsellName?: string } | null;
    product: { id: number; name: string; sku?: string | null } | null;
  }>;
  flags?: Array<{ code: string; label: string }>;
  /** null until M9 builds reminders. */
  reminder?: { dueAt?: string } | null;
  /** null until M9 builds team threads. */
  threadCount?: number | null;
  /** Only on the Unpaid by agent tab: days since delivery and the partner's days to pay (F-309). */
  unpaid?: { days: number | null; daysToPay: number | null };
}

/** Query of GET /api/orders and GET /api/orders/counts (counts ignore the sort and page fields). */
export interface OrderListParams {
  status?: OrderStatus[];
  search?: string;
  sortBy?: 'id' | 'customer' | 'totalAmount' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  dateBasis?: 'created' | 'delivery';
  productId?: number[];
  deliveryAgentId?: number;
  customerRepId?: number;
  unassigned?: boolean;
  /** Failed or returned orders with this reason (the Deliveries reasons card). */
  failureReason?: FailureReason;
  flag?: 'any';
  /** Comma list of order ids (the orders an import made). */
  ids?: string;
  /** "Unpaid by agent" (F-309): delivered orders whose cash the partner holds past its days to pay. The server ignores dates and status for it. */
  tab?: 'unpaid_by_agent';
}

/** One problem row of the import check (POST /api/orders/upload/validate). */
export interface ImportProblem {
  row: number;
  problems: string[];
  values?: Record<string, unknown>;
}

/** What the check step answers (orderImportService.checkReport). Nothing is saved. */
export interface ImportCheck {
  fileName: string;
  total: number;
  ready: number;
  needFix: number;
  duplicates: number;
  note?: string | null;
  problems: ImportProblem[];
  problemsCsv: string | null;
}

/** What the import answers (POST /api/orders/upload). */
export interface ImportResult {
  results: { success: number; failed: number; duplicates: number; orderIds: number[]; errors: Array<{ error: string }> };
  total: number;
  needFix: number;
  note?: string | null;
  problems: ImportProblem[];
  problemsCsv: string | null;
}

export interface OrderCounts {
  all: number;
  byStatus: Record<OrderStatus, number>;
  waitingToDispatch: number;
  /** Orders past their partner's days to pay: the same number as the unpaid-by-age card. null when the role cannot see finance. */
  unpaidByAgent?: number | null;
}

/** Per-order result of a bulk status change or assign (orderService.BulkResult). */
export interface BulkResult {
  succeeded: number[];
  failed: Array<{ id: number; code: string; message: string }>;
}

/** Reasons a bulk status move may carry (one for all the orders). */
export interface BulkStatusBody extends StatusMoveExtras {
  orderIds: number[];
  status: OrderStatus;
}

/** Who a bulk assign gives the orders to: a call rep, a delivery agent, both, or `unassign: 'both'`. */
export interface BulkAssignBody {
  orderIds: number[];
  customerRepId?: number;
  deliveryAgentId?: number;
  unassign?: 'both';
  confirmBlocked?: boolean;
}

/** DELETE /api/orders/bulk: what was deleted and what the rules kept (F-315). */
export interface BulkDeleteResult {
  deleted: number;
  skipped: Array<{ id: number; reason: string }>;
}

/** What the order state machine allows next for one order (GET /api/orders/:id/transitions). */
export interface OrderTransitions {
  status: OrderStatus;
  normal: OrderStatus[];
  forced: OrderStatus[];
}

/** One row of GET /api/orders/:id/timeline (orderTimeline.ts). */
export interface TimelineEntry {
  kind: 'placed' | 'status' | 'assignment' | 'edit' | 'call' | 'note' | 'planned';
  size: 'main' | 'small';
  at: string;
  title: string;
  actor: { kind: 'person' | 'ai_agent' | 'partner' | 'system'; userId: number | null; name: string | null } | null;
  note: string | null;
  status?: OrderStatus;
  override?: boolean;
  reason?: string | null;
  durationChip?: string;
}

export type PaymentTagCode = 'pay_on_delivery' | 'cash_with_agent' | 'overdue_from_agent' | 'paid_in' | 'paid' | 'no_payment';

/** GET /api/orders/:id as the order drawer reads it (orderDetailService.getDetail). Money fields arrive as strings or numbers. */
export interface OrderDetail {
  id: number;
  displayNumber: string;
  status: OrderStatus;
  orderType?: 'physical' | 'digital';
  createdAt: string;
  updatedAt: string;
  statusVersion: number;
  source: string;
  sourceLabel: string;
  notes: string | null;
  deliveryAddress: string | null;
  deliveryState: string | null;
  deliveryArea: string | null;
  discount: string | number;
  subtotal: string | number;
  totalAmount: string | number;
  customer: { id: number; firstName: string; lastName: string; email: string | null; phoneNumber: string; alternatePhone: string | null };
  items: Array<{
    id: number;
    productId: number;
    quantity: number;
    unitPrice: string | number;
    totalPrice: string | number;
    itemType?: string | null;
    metadata?: { upsellName?: string } | null;
    product: { id: number; name: string } | null;
  }>;
  assignees: {
    customerRep: { id: number; firstName: string; lastName: string } | null;
    deliveryAgent: { id: number; firstName: string; lastName: string } | null;
  };
  calls: Array<{
    id: number;
    outcome: string;
    notes: string | null;
    duration?: number | null;
    createdAt: string;
    salesRep: { id: number; firstName: string; lastName: string };
  }>;
  messages: unknown[];
  flags: Array<{ code: string; label: string }>;
  transitions: OrderTransitions;
  paymentTag: { code: PaymentTagCode; label: string };
  payment: {
    method: string;
    status: string;
    amount: string;
    deposit: { paid: string; due: string } | null;
    cashHeldBy?: string;
  };
}

/** The body of PUT /api/orders/:id from the edit mode: only the fields that changed, plus the version and the two ticks. */
export interface OrderEditBody {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  alternatePhone?: string;
  deliveryAddress?: string;
  deliveryState?: string;
  deliveryArea?: string;
  notes?: string;
  orderItems?: Array<{ productId: number; quantity: number; unitPrice: number }>;
  discount?: number;
  totalAmount?: number;
  updatedAt?: string;
  confirmTotalChange?: boolean;
  confirmPhoneChange?: boolean;
}

const transformOrder = (order: any): Order => {
  try {
    // Transform orderItems to match frontend OrderItem interface
    const items = (order.orderItems || []).map((item: any) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product?.name || 'Unknown Product',
      quantity: item.quantity,
      price: item.unitPrice,
      total: item.totalPrice || (item.unitPrice * item.quantity),
      itemType: item.itemType,
      metadata: item.metadata,
    }));

    // Build shipping address from delivery fields
    const shippingAddress = {
      street: order.deliveryAddress || '',
      state: order.deliveryState || '',
      area: order.deliveryArea || '',
      country: 'USA', // Default country
      phone: order.customer?.alternatePhone || order.customer?.phoneNumber || '',
    };

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      customerName: order.customer
        ? `${order.customer.firstName} ${order.customer.lastName}`.trim()
        : 'Unknown Customer',
      customerEmail: order.customer?.email || '',
      customerPhone: order.customer?.phoneNumber || '',
      items,
      totalAmount: order.totalAmount || 0,
      status: order.status || 'pending_confirmation',
      priority: order.priority || 'medium',
      paymentStatus: order.paymentStatus || 'pending',
      paymentMethod: order.paymentMethod || 'cod',
      shippingAddress,
      notes: order.notes || '',
      assignedTo: order.customerRepId || order.deliveryAgentId,
      assignedToName: order.customerRep
        ? `${order.customerRep.firstName} ${order.customerRep.lastName}`.trim()
        : order.deliveryAgent
          ? `${order.deliveryAgent.firstName} ${order.deliveryAgent.lastName}`.trim()
          : undefined,
      customerRep: order.customerRep,
      deliveryAgent: order.deliveryAgent,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      estimatedDelivery: order.estimatedDelivery,
    };
  } catch (error) {
    console.error('Error transforming order:', error, order);
    throw error;
  }
};

export const ordersService = {
  /** The Orders list page: raw rows with customer, call rep, delivery agent, items and flags. */
  async listOrders(params: OrderListParams, skipCache = false): Promise<{ rows: OrderListRow[]; pagination: PaginationMeta }> {
    // The Unpaid by agent tab counts every overdue order, whatever its date or status, so the card and the tab agree
    const { startDate: _a, endDate: _b, dateBasis: _c, status: _d, ...undated } = params;
    const wanted = params.tab ? undated : params;
    const response = await apiClient.get('/api/orders', { params: { ...wanted, include: 'flags,reminder,threadCount' }, skipCache });
    return {
      rows: response.data.orders || [],
      pagination: response.data.pagination || { page: 1, limit: 25, total: 0, pages: 0 },
    };
  },

  async getCounts(params: OrderListParams, skipCache = false): Promise<OrderCounts> {
    const { sortBy: _s, sortOrder: _o, page: _p, limit: _l, tab: _t, ...filters } = params;
    const [response, unpaid] = await Promise.all([
      apiClient.get('/api/orders/counts', { params: filters, skipCache }),
      // The Unpaid by agent tab count is the unpaid-by-age card's overdue number (F-309). A role without finance view is
      // refused: no count, and the tab is not drawn.
      apiClient.get('/api/financial/unpaid-by-age', { skipCache, quiet: true }).then((r) => Number(r.data.overdue.orders), () => null),
    ]);
    return { ...response.data, unpaidByAgent: unpaid };
  },

  /** GET /api/orders/statuses: the fixed list of order statuses from the state machine (F-1233). */
  async getStatuses(): Promise<OrderStatus[]> {
    const response = await apiClient.get('/api/orders/statuses');
    return response.data.statuses;
  },

  async getOrders(filters?: FilterOptions): Promise<{ orders: Order[]; pagination: PaginationMeta }> {
    const response = await apiClient.get('/api/orders', { params: filters });
    const orders = response.data.orders || [];
    const pagination = response.data.pagination || { page: 1, limit: 20, total: 0, pages: 0 };
    return {
      orders: orders.map(transformOrder),
      pagination
    };
  },

  async getOrderById(id: number): Promise<Order> {
    const response = await apiClient.get(`/api/orders/${id}`);
    return transformOrder(response.data.order || response.data);
  },

  /** The order drawer (F-321): the whole order in one read. */
  async getOrderDetail(id: number): Promise<OrderDetail> {
    const response = await apiClient.get(`/api/orders/${id}`, { skipCache: true, quiet: true });
    return response.data.order;
  },

  async getTimeline(id: number): Promise<TimelineEntry[]> {
    const response = await apiClient.get(`/api/orders/${id}/timeline`, { skipCache: true, quiet: true });
    return response.data.timeline;
  },

  /** Save from the drawer's edit mode (F-318). A stale save is refused with HTTP 409 STALE_ORDER. */
  async editOrder(id: number, body: OrderEditBody): Promise<void> {
    await apiClient.put(`/api/orders/${id}`, body);
  },

  async createOrder(order: Partial<Order>): Promise<Order> {
    const response = await apiClient.post('/api/orders', order);
    return transformOrder(response.data.order || response.data);
  },

  /** Creates a manual order (F-317) and returns the number to show in the toast. */
  async createManualOrder(body: ManualOrderBody): Promise<{ id: number; orderNumber: string }> {
    const response = await apiClient.post('/api/orders', body);
    const order = response.data.order || response.data;
    return { id: order.id, orderNumber: order.orderNumber };
  },

  async updateOrder(id: number, order: Partial<Order>): Promise<Order> {
    console.log('[ordersService.updateOrder] Starting - ID:', id, 'Data:', order);
    console.log('[ordersService.updateOrder] apiClient:', apiClient);
    console.log('[ordersService.updateOrder] apiClient.put:', apiClient.put);
    try {
      console.log('[ordersService.updateOrder] Making PUT request to:', `/api/orders/${id}`);
      console.log('[ordersService.updateOrder] Calling apiClient.put now...');
      const response = await apiClient.put(`/api/orders/${id}`, order);
      console.log('[ordersService.updateOrder] Response received:', response);
      const transformed = transformOrder(response.data.order || response.data);
      console.log('[ordersService.updateOrder] Transformed:', transformed);
      return transformed;
    } catch (error) {
      console.error('[ordersService.updateOrder] Error:', error);
      throw error;
    }
  },

  async updateOrderStatus(id: number, status: OrderStatus, notes?: string, extra: StatusMoveExtras = {}): Promise<Order> {
    markOwnMoves([id]);
    const response = await apiClient.patch(`/api/orders/${id}/status`, { status, ...(notes && { note: notes }), ...extra });
    return transformOrder(response.data.order || response.data);
  },

  async deleteOrder(id: number): Promise<void> {
    await apiClient.delete(`/api/orders/${id}`);
  },

  async bulkDeleteOrders(ids: number[]): Promise<{ message: string; deletedCount: number } & BulkDeleteResult> {
    const response = await apiClient.delete('/api/orders/bulk', { data: { ids } });
    return response.data;
  },

  /** The moves the order can make now, for the row status menu (F-313). */
  async getTransitions(id: number): Promise<OrderTransitions> {
    const response = await apiClient.get(`/api/orders/${id}/transitions`, { skipCache: true });
    return response.data;
  },

  async bulkStatus(body: BulkStatusBody): Promise<BulkResult> {
    const { force: _force, reason: _reason, ...move } = body;
    markOwnMoves(body.orderIds);
    const response = await apiClient.patch('/api/orders/bulk/status', move);
    return response.data;
  },

  async bulkAssign(body: BulkAssignBody): Promise<BulkResult> {
    const response = await apiClient.patch('/api/orders/bulk/assign', body);
    return response.data;
  },

  async assignRep(id: number, customerRepId: number): Promise<void> {
    await apiClient.patch(`/api/orders/${id}/assign-rep`, { customerRepId });
  },

  async assignAgent(id: number, deliveryAgentId: number, confirmBlocked = false): Promise<void> {
    await apiClient.patch(`/api/orders/${id}/assign-agent`, { deliveryAgentId, confirmBlocked });
  },

  /** "Unassign both" (F-314): clears the call rep and the delivery agent. */
  async unassignBoth(id: number): Promise<void> {
    await apiClient.patch(`/api/orders/${id}/assign-rep`, { unassign: 'both' });
  },

  async assignOrder(id: number, userId: number, role: 'rep' | 'agent' = 'rep'): Promise<Order> {
    const endpoint = role === 'agent' ? 'assign-agent' : 'assign-rep';
    const response = await apiClient.patch(`/api/orders/${id}/${endpoint}`, { userId });
    return transformOrder(response.data.order || response.data);
  },

  async exportOrders(filters?: FilterOptions): Promise<void> {
    const response = await apiClient.get('/api/orders/export', {
      params: filters,
      responseType: 'blob'
    });

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;

    const extension = filters?.format === 'xlsx' ? 'xlsx' : 'csv';
    link.setAttribute('download', `orders_export_${Date.now()}.${extension}`);

    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  /** Import step 1 (F-319): reads the file and counts ready rows and problems. Saves nothing. */
  async checkImport(file: File): Promise<ImportCheck> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post('/api/orders/upload/validate', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    return response.data;
  },

  /**
   * The Export menu (F-320): downloads the list with its filters as CSV or XLSX. Resolves with the file name
   * the server chose (orders-<date>.csv). The sort and page are not sent; the file holds every matching order.
   */
  async exportList(params: OrderListParams, format: 'csv' | 'xlsx'): Promise<string> {
    const { sortBy: _s, sortOrder: _o, page: _p, limit: _l, tab: _t, ...filters } = params;
    const response = await apiClient.get('/api/orders/export', { params: { ...filters, format }, responseType: 'blob', skipCache: true });
    const named = /filename="?([^";]+)"?/.exec(String(response.headers?.['content-disposition'] ?? ''));
    const name = named?.[1] ?? `orders-${new Date().toISOString().slice(0, 10)}.${format}`;
    const url = window.URL.createObjectURL(response.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return name;
  },

  async uploadOrders(file: File, runWorkflows = false): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('runWorkflows', String(runWorkflows));
    const response = await apiClient.post('/api/orders/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  },

  async getOrdersByStatus(): Promise<{ status: OrderStatus; count: number; revenue: number }[]> {
    const response = await apiClient.get('/api/orders/stats/by-status');
    return response.data;
  },
};

/** The body of `POST /api/orders` for a manual order (F-317). A status is never sent: the order starts at pending_confirmation. */
export interface ManualOrderBody {
  customerName: string;
  customerPhone: string;
  alternatePhone?: string;
  customerEmail?: string;
  deliveryAddress: string;
  deliveryState: string;
  deliveryArea: string;
  /** Nearest landmark: saved on the customer and added to the delivery address riders read. */
  landmark?: string;
  orderItems: Array<{ productId: number; quantity: number; unitPrice: number }>;
  subtotal: number;
  discount: number;
  totalAmount: number;
  notes?: string;
  customerConfirmed: boolean;
  customerRepId?: number;
  deliveryAgentId?: number;
}
