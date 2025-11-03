import apiClient from './api';
import { CheckoutForm as CheckoutFormType } from '../types/checkout-form';

export type CheckoutForm = CheckoutFormType;

export interface CheckoutFormStats {
  id: number;
  totalSubmissions: number;
  totalRevenue: number;
  conversionRate: number;
  averageOrderValue: number;
  submissionsByStatus: Record<string, number>;
}

export interface CheckoutFormFilters {
  search?: string;
  isActive?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export const checkoutFormsService = {
  async getCheckoutForms(filters?: CheckoutFormFilters): Promise<CheckoutForm[]> {
    const response = await apiClient.get('/api/checkout-forms', { params: filters });
    return response.data.forms || response.data || [];
  },

  async getCheckoutForm(id: number): Promise<CheckoutForm> {
    const response = await apiClient.get(`/api/checkout-forms/${id}`);
    return response.data.form || response.data;
  },

  async createCheckoutForm(data: Partial<CheckoutForm>): Promise<CheckoutForm> {
    const response = await apiClient.post('/api/checkout-forms', data);
    return response.data.form || response.data;
  },

  async updateCheckoutForm(id: number, data: Partial<CheckoutForm>): Promise<CheckoutForm> {
    const response = await apiClient.put(`/api/checkout-forms/${id}`, data);
    return response.data.form || response.data;
  },

  async deleteCheckoutForm(id: number): Promise<void> {
    await apiClient.delete(`/api/checkout-forms/${id}`);
  },

  async getFormStats(id: number): Promise<CheckoutFormStats> {
    const response = await apiClient.get(`/api/checkout-forms/${id}/stats`);
    return response.data.stats || response.data;
  },
};
