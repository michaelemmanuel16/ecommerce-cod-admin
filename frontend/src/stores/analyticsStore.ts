import { create } from 'zustand';
import {
  analyticsService,
  DashboardMetrics,
  SalesTrend,
  ConversionFunnelStep,
  PerformanceMetrics,
  CustomerInsights,
  PendingOrder,
  Activity,
  ProductPerformance,
  AreaDistribution,
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
  pendingOrders: PendingOrder[];
  recentActivity: Activity[];
  ordersByStatus: ConversionFunnelStep[];
  productPerformance: ProductPerformance[];
  areaDistribution: AreaDistribution[];
  isLoading: boolean;
  error: string | null;
  fetchDashboardMetrics: (startDate?: string, endDate?: string) => Promise<void>;
  fetchSalesTrends: (
    period?: 'daily' | 'monthly',
    days?: number,
    startDate?: string,
    endDate?: string
  ) => Promise<void>;
  fetchConversionFunnel: (startDate?: string, endDate?: string) => Promise<void>;
  fetchRepPerformance: (startDate?: string, endDate?: string) => Promise<void>;
  fetchAgentPerformance: (startDate?: string, endDate?: string) => Promise<void>;
  fetchCustomerInsights: () => Promise<void>;
  fetchPendingOrders: () => Promise<void>;
  fetchRecentActivity: () => Promise<void>;
  fetchOrdersByStatus: (startDate?: string, endDate?: string) => Promise<void>;
  fetchProductPerformance: (startDate?: string, endDate?: string) => Promise<void>;
  fetchAreaDistribution: (startDate?: string, endDate?: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  setupSocketListeners: () => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set, get) => {
  return {
    metrics: null,
    trends: [],
    conversionFunnel: [],
    repPerformance: [],
    agentPerformance: [],
    customerInsights: null,
    pendingOrders: [],
    recentActivity: [],
    ordersByStatus: [],
    productPerformance: [],
    areaDistribution: [],
    isLoading: false,
    error: null,

    setupSocketListeners: () => {
      const socket = getSocket();
      if (!socket) return;

      // Remove existing listeners to prevent duplicates
      socket.off('order:created');
      socket.off('order:updated');
      socket.off('order:assigned');
      socket.off('order:status_changed');
      socket.off('delivery:completed');

      socket.on('order:created', () => {
        // Refresh metrics when new orders are created
        get().fetchDashboardMetrics();
        get().fetchPendingOrders();
      });

      socket.on('order:updated', () => {
        // Refresh pending orders when orders are updated (e.g., workflow assignments)
        console.log('[analyticsStore] order:updated event received, refreshing pending orders');
        get().fetchPendingOrders();
        get().fetchDashboardMetrics();
      });

      socket.on('order:assigned', () => {
        // Refresh pending orders when sales reps or agents are assigned
        console.log('[analyticsStore] order:assigned event received, refreshing pending orders');
        get().fetchPendingOrders();
        get().fetchRepPerformance();
        get().fetchAgentPerformance();
      });

      socket.on('order:status_changed', () => {
        // Refresh metrics when order status changes
        get().fetchDashboardMetrics();
        get().fetchPendingOrders();
      });

      socket.on('delivery:completed', () => {
        // Refresh metrics when delivery is completed
        get().fetchDashboardMetrics();
        get().fetchAgentPerformance();
      });

      socket.on('bulk_import_completed', (payload) => {
        console.log('[analyticsStore] bulk_import_completed event received', payload);
        get().refreshAll();
      });

      socket.on('orders:deleted', (payload) => {
        console.log('[analyticsStore] orders:deleted event received', payload);
        get().refreshAll();
      });
    },

    fetchDashboardMetrics: async (startDate?: string, endDate?: string) => {
      set({ isLoading: true, error: null });
      try {
        const metrics = await analyticsService.getDashboardMetrics({ startDate, endDate });
        set({ metrics, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch dashboard metrics';
        set({ error: errorMessage, isLoading: false });
        console.error(errorMessage, error);
      }
    },

    fetchSalesTrends: async (
      period?: 'daily' | 'monthly',
      days?: number,
      startDate?: string,
      endDate?: string
    ) => {
      try {
        const trends = await analyticsService.getSalesTrends({
          period,
          days,
          startDate,
          endDate,
        });
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

    fetchRepPerformance: async (startDate?: string, endDate?: string) => {
      try {
        const repPerformance = await analyticsService.getRepPerformance({
          startDate,
          endDate
        });
        set({ repPerformance });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch rep performance';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchAgentPerformance: async (startDate?: string, endDate?: string) => {
      try {
        const agentPerformance = await analyticsService.getAgentPerformance({
          startDate,
          endDate,
        });
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

    fetchPendingOrders: async () => {
      try {
        const pendingOrders = await analyticsService.getPendingOrders();
        set({ pendingOrders });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch pending orders';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchRecentActivity: async () => {
      try {
        const recentActivity = await analyticsService.getRecentActivity();
        set({ recentActivity });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch recent activity';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchOrdersByStatus: async (startDate?: string, endDate?: string) => {
      try {
        const ordersByStatus = await analyticsService.getOrderStatusDistribution({ startDate, endDate });
        set({ ordersByStatus });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch orders by status';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchProductPerformance: async (startDate?: string, endDate?: string) => {
      try {
        const productPerformance = await analyticsService.getProductPerformance({
          startDate,
          endDate,
        });
        set({ productPerformance });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch product performance';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchAreaDistribution: async (startDate?: string, endDate?: string) => {
      try {
        const areaDistribution = await analyticsService.getAreaDistribution({
          startDate,
          endDate,
        });
        set({ areaDistribution });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch area distribution';
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
          get().fetchPendingOrders(),
          get().fetchRecentActivity(),
          get().fetchOrdersByStatus(),
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
