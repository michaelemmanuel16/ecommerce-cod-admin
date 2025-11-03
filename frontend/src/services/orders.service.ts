import apiClient from './api';
import { Order, OrderStatus, FilterOptions, PaginationMeta } from '../types';

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

  async updateOrderStatus(id: number, status: OrderStatus): Promise<Order> {
    const response = await apiClient.patch(`/api/orders/${id}/status`, { status });
    return transformOrder(response.data.order || response.data);
  },

  async deleteOrder(id: number): Promise<void> {
    await apiClient.delete(`/api/orders/${id}`);
  },

  async assignOrder(id: number, userId: number, role: 'rep' | 'agent' = 'rep'): Promise<Order> {
    const endpoint = role === 'agent' ? 'assign-agent' : 'assign-rep';
    const response = await apiClient.patch(`/api/orders/${id}/${endpoint}`, { userId });
    return transformOrder(response.data.order || response.data);
  },

  async getOrdersByStatus(): Promise<{ status: OrderStatus; count: number; revenue: number }[]> {
    const response = await apiClient.get('/api/orders/stats/by-status');
    return response.data;
  },
};
