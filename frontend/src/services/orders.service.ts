import apiClient from './api';
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
  flag?: 'any';
}

export interface OrderCounts {
  all: number;
  byStatus: Record<OrderStatus, number>;
  waitingToDispatch: number;
}

/** Per-order result of a bulk status change or assign (orderService.BulkResult). */
export interface BulkResult {
  succeeded: number[];
  failed: Array<{ id: number; code: string; message: string }>;
}

/** What the order state machine allows next for one order (GET /api/orders/:id/transitions). */
export interface OrderTransitions {
  status: OrderStatus;
  normal: OrderStatus[];
  forced: OrderStatus[];
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
    const response = await apiClient.get('/api/orders', { params: { ...params, include: 'flags,reminder,threadCount' }, skipCache });
    return {
      rows: response.data.orders || [],
      pagination: response.data.pagination || { page: 1, limit: 25, total: 0, pages: 0 },
    };
  },

  async getCounts(params: OrderListParams, skipCache = false): Promise<OrderCounts> {
    const { sortBy: _s, sortOrder: _o, page: _p, limit: _l, ...filters } = params;
    const response = await apiClient.get('/api/orders/counts', { params: filters, skipCache });
    return response.data;
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

  async createOrder(order: Partial<Order>): Promise<Order> {
    const response = await apiClient.post('/api/orders', order);
    return transformOrder(response.data.order || response.data);
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
    const response = await apiClient.patch(`/api/orders/${id}/status`, { status, ...(notes && { note: notes }), ...extra });
    return transformOrder(response.data.order || response.data);
  },

  async deleteOrder(id: number): Promise<void> {
    await apiClient.delete(`/api/orders/${id}`);
  },

  async bulkDeleteOrders(ids: number[]): Promise<{ message: string; deletedCount: number }> {
    const response = await apiClient.delete('/api/orders/bulk', { data: { ids } });
    return response.data;
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
