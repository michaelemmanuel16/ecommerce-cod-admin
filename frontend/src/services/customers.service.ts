import apiClient from './api';
import { Customer } from '../types';

export const customersService = {
  async getCustomers(): Promise<Customer[]> {
    const response = await apiClient.get('/api/customers');
    return response.data;
  },

  async getCustomerById(id: string): Promise<Customer> {
    const response = await apiClient.get(`/api/customers/${id}`);
    return response.data;
  },

  async createCustomer(customer: Partial<Customer>): Promise<Customer> {
    const response = await apiClient.post('/api/customers', customer);
    return response.data;
  },

  async updateCustomer(id: string, customer: Partial<Customer>): Promise<Customer> {
    const response = await apiClient.put(`/api/customers/${id}`, customer);
    return response.data;
  },

  async deleteCustomer(id: string): Promise<void> {
    await apiClient.delete(`/api/customers/${id}`);
  },
};
