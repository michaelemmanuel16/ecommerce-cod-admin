import apiClient from './api';
import { Customer, PaginationMeta } from '../types';

export const customersService = {
  async getCustomers(params?: { page?: number; limit?: number; search?: string; area?: string }): Promise<{ customers: Customer[]; pagination: PaginationMeta }> {
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
          postalCode: c.zipCode,
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
        postalCode: customer.zipCode,
        country: 'US',
        phone: customer.phoneNumber
      } : undefined
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
