import apiClient from './api';
import { Call, CallOutcome, CallStats } from '../types';

export interface CreateCallData {
  customerId: number;
  orderId?: number;
  outcome: CallOutcome;
  duration?: number;
  notes?: string;
}

export interface CallFilters {
  salesRepId?: number;
  customerId?: number;
  orderId?: number;
  outcome?: CallOutcome;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export const callsService = {
  async createCall(data: CreateCallData): Promise<Call> {
    const response = await apiClient.post('/api/calls', data);
    return response.data.call;
  },

  async getCalls(filters?: CallFilters): Promise<{ calls: Call[]; pagination: any }> {
    const response = await apiClient.get('/api/calls', { params: filters });
    return response.data;
  },

  async getCallsByOrder(orderId: number): Promise<Call[]> {
    const response = await apiClient.get(`/api/calls/order/${orderId}`);
    return response.data.calls;
  },

  async getCallsByCustomer(customerId: number): Promise<Call[]> {
    const response = await apiClient.get(`/api/calls/customer/${customerId}`);
    return response.data.calls;
  },

  async getCallStats(filters?: {
    salesRepId?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<CallStats[]> {
    const response = await apiClient.get('/api/calls/stats', { params: filters });
    return response.data.stats;
  }
};
