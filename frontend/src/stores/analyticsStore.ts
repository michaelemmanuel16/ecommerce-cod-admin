import { create } from 'zustand';
import {
  analyticsService,
  DashboardMetrics,
  SalesTrend,
  ConversionFunnelStep,
  PerformanceMetrics,
  CustomerInsights
} from '../services/analytics.service';
import { getSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface AnalyticsState {
  metrics: DashboardMetrics | null;
  trends: SalesTrend[];
  conversionFunnel: ConversionFunnelStep[];
  repPerformance: PerformanceMetrics[];
  agentPerformance: PerformanceMetrics[];
  customerInsights: CustomerInsights | null;
  isLoading: boolean;
  error: string | null;
  fetchDashboardMetrics: () => Promise<void>;
  fetchSalesTrends: (period?: 'daily' | 'monthly', days?: number) => Promise<void>;
  fetchConversionFunnel: (startDate?: string, endDate?: string) => Promise<void>;
  fetchRepPerformance: () => Promise<void>;
  fetchAgentPerformance: () => Promise<void>;
  fetchCustomerInsights: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

export const useAnalyticsStore = create<AnalyticsState>((set, get) => {
  // Initialize Socket.io listeners for real-time updates
  const socket = getSocket();
  if (socket) {
    socket.on('order:created', () => {
      // Refresh metrics when new orders are created
      get().fetchDashboardMetrics();
    });

    socket.on('order:status_changed', () => {
      // Refresh metrics when order status changes
      get().fetchDashboardMetrics();
    });

    socket.on('delivery:completed', () => {
      // Refresh metrics when delivery is completed
      get().fetchDashboardMetrics();
      get().fetchAgentPerformance();
    });
  }

  return {
    metrics: null,
    trends: [],
    conversionFunnel: [],
    repPerformance: [],
    agentPerformance: [],
    customerInsights: null,
    isLoading: false,
    error: null,

    fetchDashboardMetrics: async () => {
      set({ isLoading: true, error: null });
      try {
        const metrics = await analyticsService.getDashboardMetrics();
        set({ metrics, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch dashboard metrics';
        set({ error: errorMessage, isLoading: false });
        console.error(errorMessage, error);
      }
    },

    fetchSalesTrends: async (period?: 'daily' | 'monthly', days?: number) => {
      try {
        const trends = await analyticsService.getSalesTrends({ period, days });
        set({ trends });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch sales trends';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchConversionFunnel: async (startDate?: string, endDate?: string) => {
      try {
        const conversionFunnel = await analyticsService.getConversionFunnel({ startDate, endDate });
        set({ conversionFunnel });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch conversion funnel';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchRepPerformance: async () => {
      try {
        const repPerformance = await analyticsService.getRepPerformance();
        set({ repPerformance });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch rep performance';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchAgentPerformance: async () => {
      try {
        const agentPerformance = await analyticsService.getAgentPerformance();
        set({ agentPerformance });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch agent performance';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchCustomerInsights: async () => {
      try {
        const customerInsights = await analyticsService.getCustomerInsights();
        set({ customerInsights });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch customer insights';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    refreshAll: async () => {
      set({ isLoading: true, error: null });
      try {
        await Promise.all([
          get().fetchDashboardMetrics(),
          get().fetchSalesTrends('daily', 7),
          get().fetchRepPerformance(),
          get().fetchAgentPerformance(),
        ]);
        set({ isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to refresh analytics data';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
      }
    },
  };
});
