import apiClient from './api';

export interface DashboardMetrics {
  totalOrders: number;
  todayOrders: number;
  pendingOrders: number;
  deliveredOrders: number;
  totalRevenue: number;
  todayRevenue: number;
  activeAgents: number;
  avgDeliveryTime: number;
  deliveryRate: number;
}

export interface SalesTrend {
  date: string;
  orders: number;
  revenue: number;
  delivered: number;
  conversionRate: number;
}

export interface ConversionFunnelStep {
  status: string;
  count: number;
}

export interface PerformanceMetrics {
  userId: string;
  userName: string;
  totalAssigned: number;
  completed: number;
  pending: number;
  successRate: number;
  revenue?: number;
  avgResponseTime?: number;
  failed?: number;
  onTimeRate?: number;
  totalDeliveries?: number;
}

export interface CustomerInsights {
  totalCustomers: number;
  activeCustomers: number;
  topCustomers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    totalOrders: number;
    totalSpent: number;
  }>;
  customersByState: Array<{
    state: string;
    count: number;
  }>;
  avgOrderValue: number;
}

export const analyticsService = {
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const response = await apiClient.get('/api/analytics/dashboard');
    return response.data.metrics;
  },

  async getSalesTrends(params?: {
    period?: 'daily' | 'monthly';
    days?: number;
  }): Promise<SalesTrend[]> {
    const response = await apiClient.get('/api/analytics/sales-trends', { params });
    return response.data.trends;
  },

  async getConversionFunnel(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<ConversionFunnelStep[]> {
    const response = await apiClient.get('/api/analytics/conversion-funnel', { params });
    return response.data.funnel;
  },

  async getRepPerformance(): Promise<PerformanceMetrics[]> {
    const response = await apiClient.get('/api/analytics/rep-performance');
    return response.data.performance;
  },

  async getAgentPerformance(): Promise<PerformanceMetrics[]> {
    const response = await apiClient.get('/api/analytics/agent-performance');
    return response.data.performance;
  },

  async getCustomerInsights(): Promise<CustomerInsights> {
    const response = await apiClient.get('/api/analytics/customer-insights');
    return response.data.insights;
  }
};
