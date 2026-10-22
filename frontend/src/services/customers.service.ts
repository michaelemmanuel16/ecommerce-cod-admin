import apiClient from './api';
import { Customer, PaginationMeta } from '../types';
import { samePhone } from '../utils/phone';

export const customersService = {
  async getCustomers(params?: { page?: number; limit?: number; search?: string; area?: string; sortBy?: 'totalOrders' | 'totalSpent'; sortOrder?: 'asc' | 'desc' }): Promise<{ customers: Customer[]; pagination: PaginationMeta }> {
    const response = await apiClient.get('/api/customers', { params });
    const customers = response.data.customers || [];
    const pagination = response.data.pagination || { page: 1, limit: 20, total: 0, pages: 0 };
    // Transform backend data to match frontend types
    return {
      customers: customers.map((c: any) => ({
        ...c,
        name: `${c.firstName} ${c.lastName}`.trim(),
        phone: c.phoneNumber,
        alternatePhone: c.alternatePhone,
        address: c.address ? {
          street: c.address,
          state: c.state,
          country: 'US',
          phone: c.phoneNumber
        } : undefined
      })),
      pagination
    };
  },

  async getCustomerById(id: number): Promise<Customer> {
    const response = await apiClient.get(`/api/customers/${id}`);
    const customer = response.data.customer || response.data;
    // Transform if needed
    return {
      ...customer,
      name: `${customer.firstName} ${customer.lastName}`.trim(),
      phone: customer.phoneNumber,
      alternatePhone: customer.alternatePhone,
      address: customer.address ? {
        street: customer.address,
        state: customer.state,
        country: 'US',
        phone: customer.phoneNumber
      } : undefined
    };
  },

  /** The customer a typed phone belongs to, if any (F-362). The list search matches every phone format. */
  async findByPhone(phone: string): Promise<{ id: number; name: string; totalOrders: number; codBlocked: boolean } | null> {
    const response = await apiClient.get('/api/customers', { params: { search: phone, limit: 10 } });
    const hit = (response.data.customers || []).find((c: any) => samePhone(c.phoneNumber, phone) || samePhone(c.alternatePhone, phone));
    if (!hit) return null;
    return { id: hit.id, name: `${hit.firstName} ${hit.lastName}`.trim(), totalOrders: hit.totalOrders ?? 0, codBlocked: hit.codBlocked === true };
  },

  /** The fields the New order sheet prefills from a customer (`/orders?new=1&customerId=`). */
  async getForOrder(id: number) {
    const response = await apiClient.get(`/api/customers/${id}`);
    const c = response.data.customer || response.data;
    return {
      name: `${c.firstName} ${c.lastName}`.trim(),
      phone: c.phoneNumber ?? '',
      alternatePhone: c.alternatePhone ?? '',
      email: c.email ?? '',
      address: typeof c.address === 'string' ? c.address : '',
      region: c.state ?? '',
      town: c.area ?? '',
    };
  },

  async createCustomer(customer: any): Promise<Customer> {
    const response = await apiClient.post('/api/customers', customer);
    return response.data.customer || response.data;
  },

  async updateCustomer(id: number, customer: any): Promise<Customer> {
    const response = await apiClient.put(`/api/customers/${id}`, customer);
    return response.data.customer || response.data;
  },

  async deleteCustomer(id: number): Promise<void> {
    await apiClient.delete(`/api/customers/${id}`);
  },
};
