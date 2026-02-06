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
  unpaidDeliveredOrders?: number;
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

export interface PendingOrder {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerArea: string;
  totalAmount: number;
  createdAt: string;
  repName: string;
}

export interface Activity {
  id: number;
  type: string;
  title: string;
  message: string;
  userName: string;
  userRole: string;
  isRead: boolean;
  createdAt: string;
  data?: any;
}

export const analyticsService = {
  async getDashboardMetrics(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<DashboardMetrics> {
    const response = await apiClient.get('/api/analytics/dashboard', { params });
    return response.data.metrics;
  },

  async getSalesTrends(params?: {
    period?: 'daily' | 'monthly';
    days?: number;
    startDate?: string;
    endDate?: string;
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

  async getRepPerformance(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<PerformanceMetrics[]> {
    const response = await apiClient.get('/api/analytics/rep-performance', { params });
    return response.data.performance;
  },

  async getAgentPerformance(): Promise<PerformanceMetrics[]> {
    const response = await apiClient.get('/api/analytics/agent-performance');
    return response.data.performance;
  },

  async getCustomerInsights(): Promise<CustomerInsights> {
    const response = await apiClient.get('/api/analytics/customer-insights');
    return response.data.insights;
  },

  async getPendingOrders(): Promise<PendingOrder[]> {
    const response = await apiClient.get('/api/analytics/pending-orders');
    return response.data.orders;
  },

  async getRecentActivity(): Promise<Activity[]> {
    const response = await apiClient.get('/api/analytics/recent-activity');
    return response.data.activity;
  },

  async getOrderStatusDistribution(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<ConversionFunnelStep[]> {
    const response = await apiClient.get('/api/analytics/status-distribution', { params });
    return response.data.distribution;
  }
};
