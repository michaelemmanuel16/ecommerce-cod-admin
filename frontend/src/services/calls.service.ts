import apiClient from './api';
import { Call, CallOutcome, CallStats } from '../types';

export interface CreateCallData {
  customerId: number;
  orderId?: number;
  outcome: CallOutcome | string;
  duration?: number;
  notes?: string;
  startedAt?: string;
  source?: string;
  declineReason?: string;
  callbackAt?: string;
  expectedUpdatedAt?: string;
  orderChanges?: {
    packageId?: number | null;
    addOnIds?: number[];
  };
}

export interface CreateCallResult {
  call: Call;
  nextOrderId?: number | null;
  upsell?: {
    orderId: number;
    repId: number;
    extraValue: string | number;
    estimatedReward: string | number;
    lines?: Array<{
      id: number;
      kind: string;
      sourceId: number | null;
      extraValue: string | number;
      status: string;
    }>;
    warningFlag?: boolean;
    warning?: string;
  } | null;
  warningFlag?: boolean;
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
  async createCall(data: CreateCallData): Promise<CreateCallResult> {
    const response = await apiClient.post('/api/calls', data);
    return response.data;
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
