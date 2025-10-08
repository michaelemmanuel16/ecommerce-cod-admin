import apiClient from './api';
import { Order, OrderStatus, FilterOptions } from '../types';

export const ordersService = {
  async getOrders(filters?: FilterOptions): Promise<Order[]> {
    const response = await apiClient.get('/api/orders', { params: filters });
    return response.data;
  },

  async getOrderById(id: string): Promise<Order> {
    const response = await apiClient.get(`/api/orders/${id}`);
    return response.data;
  },

  async createOrder(order: Partial<Order>): Promise<Order> {
    const response = await apiClient.post('/api/orders', order);
    return response.data;
  },

  async updateOrder(id: string, order: Partial<Order>): Promise<Order> {
    const response = await apiClient.put(`/api/orders/${id}`, order);
    return response.data;
  },

  async updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
    const response = await apiClient.put(`/api/orders/${id}/status`, { status });
    return response.data;
  },

  async deleteOrder(id: string): Promise<void> {
    await apiClient.delete(`/api/orders/${id}`);
  },

  async assignOrder(id: string, userId: string): Promise<Order> {
    const response = await apiClient.put(`/api/orders/${id}/assign`, { userId });
    return response.data;
  },

  async getOrdersByStatus(): Promise<{ status: OrderStatus; count: number; revenue: number }[]> {
    const response = await apiClient.get('/api/orders/stats/by-status');
    return response.data;
  },
};
