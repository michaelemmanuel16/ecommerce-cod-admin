/**
 * useDashboardData Hook
 * Fetches and manages dashboard data based on configuration
 * Updated: 2025-11-06
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { DashboardConfig, DashboardData } from '../config/types/dashboard';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { useAuthStore } from '../stores/authStore';
import { useOrdersStore } from '../stores/ordersStore';
import { getSocket } from '../services/socket';
import { DateRangeFilter } from '../pages/DynamicDashboard';

interface UseDashboardDataResult {
  data: DashboardData;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and manage dashboard data
 * @param config - Dashboard configuration
 * @param dateRange - Selected date range (preset or custom dates)
 * @returns Dashboard data, loading state, error, and refetch function
 */
export function useDashboardData(
  config: DashboardConfig,
  dateRange?: DateRangeFilter
): UseDashboardDataResult {
  const [data, setData] = useState<DashboardData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fetchingRef = useRef(false);

  // Select individual stable method references from Zustand store
  // These are stable and won't cause re-renders
  const fetchDashboardMetrics = useAnalyticsStore(state => state.fetchDashboardMetrics);
  const fetchSalesTrends = useAnalyticsStore(state => state.fetchSalesTrends);
  const fetchConversionFunnel = useAnalyticsStore(state => state.fetchConversionFunnel);
  const fetchRepPerformance = useAnalyticsStore(state => state.fetchRepPerformance);
  const fetchAgentPerformance = useAnalyticsStore(state => state.fetchAgentPerformance);
  const fetchCustomerInsights = useAnalyticsStore(state => state.fetchCustomerInsights);
  const fetchPendingOrders = useAnalyticsStore(state => state.fetchPendingOrders);
  const fetchRecentActivity = useAnalyticsStore(state => state.fetchRecentActivity);

  const { user } = useAuthStore();

  /**
   * Fetch all data sources defined in config
   */
  const fetchData = useCallback(async () => {
    if (!config || !config.dataFetchers || config.dataFetchers.length === 0) {
      setLoading(false);
      return;
    }

    // Prevent duplicate fetches
    if (fetchingRef.current) {
      console.log('Fetch already in progress, skipping...');
      return;
    }

    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const storeMethods = {
        fetchDashboardMetrics,
        fetchSalesTrends,
        fetchConversionFunnel,
        fetchRepPerformance,
        fetchAgentPerformance,
        fetchCustomerInsights,
        fetchPendingOrders,
        fetchRecentActivity,
      };

      // Build dashboard data object
      const dashboardData: DashboardData = {
        currentUser: user,
      };

      // DEBUG: Log all data fetchers
      console.log('📊 Dashboard config dataFetchers:', config.dataFetchers);
      console.log('📊 First 3 fetchers:', config.dataFetchers.slice(0, 3));
      console.log('📊 Remaining fetchers:', config.dataFetchers.slice(3));

      // Fetch critical metrics first (sequential for rate limiting)
      for (const fetcherName of config.dataFetchers.slice(0, 3)) {
        try {
          await executeFetcher(fetcherName, dashboardData, storeMethods, user, dateRange);
          // Small delay to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.error(`Error fetching ${fetcherName}:`, err);
          // Continue with other fetchers even if one fails
        }
      }

      // Fetch remaining data in smaller batches
      const remainingFetchers = config.dataFetchers.slice(3);
      const batchSize = 2;

      for (let i = 0; i < remainingFetchers.length; i += batchSize) {
        const batch = remainingFetchers.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (fetcherName) => {
            try {
              await executeFetcher(fetcherName, dashboardData, storeMethods, user, dateRange);
            } catch (err) {
              console.error(`Error fetching ${fetcherName}:`, err);
            }
          })
        );
        // Delay between batches
        if (i + batchSize < remainingFetchers.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Apply calculations if defined in config
      if (config.calculations) {
        Object.entries(config.calculations).forEach(([key, calculationFn]) => {
          try {
            (dashboardData as any)[key] = calculationFn(dashboardData);
          } catch (err) {
            console.error(`Error calculating ${key}:`, err);
          }
        });
      }

      // Calculate derived metrics
      if (dashboardData.metrics) {
        const calculated: any = {};

        // Cancellation rate
        if (dashboardData.metrics.totalOrders > 0) {
          const cancelledOrders = dashboardData.metrics.cancelledOrders || 0;
          calculated.cancellationRate = (
            (cancelledOrders / dashboardData.metrics.totalOrders) *
            100
          ).toFixed(1);
        }

        // Active customer percentage
        if (dashboardData.customerInsights) {
          const total = dashboardData.customerInsights.totalCustomers || 0;
          const active = dashboardData.customerInsights.activeCustomers || 0;
          if (total > 0) {
            calculated.activeCustomerPercentage = ((active / total) * 100).toFixed(1);
          }
        }

        // Earnings (for sales reps)
        if (dashboardData.repPerformance && user?.commissionRate) {
          calculated.myCommission = (
            dashboardData.repPerformance.deliveredOrders * user.commissionRate
          ).toFixed(2);
          calculated.commissionRate = user.commissionRate;
        }

        // Conversion rate (for sales reps)
        if (dashboardData.repPerformance && dashboardData.repPerformance.totalOrders > 0) {
          calculated.myConversionRate = (
            (dashboardData.repPerformance.deliveredOrders / dashboardData.repPerformance.totalOrders) *
            100
          ).toFixed(1);
        }

        // Earnings (for delivery agents)
        if (dashboardData.myPerformance && user?.deliveryRate) {
          calculated.myEarnings = (
            dashboardData.myPerformance.completed * user.deliveryRate
          ).toFixed(2);
        }

        dashboardData.calculated = calculated;
      }

      setData(dashboardData);
      setError(null);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err as Error);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
    // Only include stable references in dependencies
    // Do NOT include store state (metrics, trends, etc.) to avoid infinite loop
  }, [
    config,
    dateRange,
    user,
    fetchDashboardMetrics,
    fetchSalesTrends,
    fetchConversionFunnel,
    fetchRepPerformance,
    fetchAgentPerformance,
    fetchCustomerInsights,
    fetchPendingOrders,
    fetchRecentActivity,
  ]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Setup real-time updates if configured
  useEffect(() => {
    if (!config.realtimeEvents || config.realtimeEvents.length === 0) {
      return;
    }

    const socket = getSocket();
    if (!socket) return;

    // Listen to all configured events
    config.realtimeEvents.forEach((eventName) => {
      socket.on(eventName, () => {
        console.log(`Real-time event received: ${eventName}`);
        fetchData(); // Refetch data on event
      });
    });

    // Cleanup
    return () => {
      config.realtimeEvents?.forEach((eventName) => {
        socket.off(eventName);
      });
    };
  }, [config.realtimeEvents, fetchData]);

  // Setup auto-refresh if configured
  useEffect(() => {
    if (!config.refreshInterval) return;

    const interval = setInterval(() => {
      console.log('Auto-refreshing dashboard...');
      fetchData();
    }, config.refreshInterval);

    return () => clearInterval(interval);
  }, [config.refreshInterval, fetchData]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Execute a single data fetcher
 * Note: We fetch data and then read it from the Zustand store
 * The store methods update the store state, so we need to access it after the await
 */
async function executeFetcher(
  fetcherName: string,
  dashboardData: DashboardData,
  storeMethods: any,
  user: any,
  dateRange?: DateRangeFilter
) {
  console.log(`🔄 Executing fetcher: ${fetcherName}`);
  const analyticsStore = useAnalyticsStore.getState();

  // Calculate days for backward compatibility with backend
  const days = dateRange?.startDate && dateRange?.endDate
    ? calculateDaysBetween(dateRange.startDate, dateRange.endDate)
    : parseDateRangeToDays(dateRange?.preset);

  switch (fetcherName) {
    case 'fetchDashboardMetrics':
      console.log('[useDashboardData] Calling fetchDashboardMetrics with dates:', {
        startDate: dateRange?.startDate,
        endDate: dateRange?.endDate,
        dateRange
      });
      await storeMethods.fetchDashboardMetrics(
        dateRange?.startDate,
        dateRange?.endDate
      );
      dashboardData.metrics = useAnalyticsStore.getState().metrics;
      console.log('[useDashboardData] Received metrics:', dashboardData.metrics);
      break;

    case 'fetchSalesTrends':
      await storeMethods.fetchSalesTrends(
        'daily',
        days,
        dateRange?.startDate,
        dateRange?.endDate
      );
      dashboardData.salesTrends = useAnalyticsStore.getState().trends;
      break;

    case 'fetchConversionFunnel':
      await storeMethods.fetchConversionFunnel(
        dateRange?.startDate,
        dateRange?.endDate
      );
      dashboardData.conversionFunnel = useAnalyticsStore.getState().conversionFunnel;
      break;

    case 'fetchRepPerformance':
      await storeMethods.fetchRepPerformance(
        dateRange?.startDate,
        dateRange?.endDate
      );
      const repPerf = useAnalyticsStore.getState().repPerformance;

      // Filter for current user if role is sales_rep
      if (user?.role === 'sales_rep') {
        const myPerf = repPerf.find(
          (rep: any) => rep.userId === user.id
        );

        // Transform backend field names to match config expectations
        if (myPerf) {
          dashboardData.repPerformance = {
            totalOrders: myPerf.totalAssigned || 0,
            deliveredOrders: myPerf.completed || 0,
            pendingOrders: myPerf.pending || 0,
            totalRevenue: myPerf.revenue || 0,
            avgResponseTime: myPerf.avgResponseTime || 0,
            successRate: myPerf.successRate || 0,
            userId: myPerf.userId,
            userName: myPerf.userName,
          };
        } else {
          // No performance data found - use empty defaults
          dashboardData.repPerformance = {
            totalOrders: 0,
            deliveredOrders: 0,
            pendingOrders: 0,
            totalRevenue: 0,
            avgResponseTime: 0,
            successRate: 0,
          };
        }
      } else {
        // Admins/managers see all reps' performance (array)
        dashboardData.repPerformance = repPerf;
      }
      break;

    case 'fetchAgentPerformance':
      await storeMethods.fetchAgentPerformance();
      const agentPerf = useAnalyticsStore.getState().agentPerformance;
      dashboardData.agentPerformance = agentPerf;

      // Filter for current user if role is delivery_agent
      if (user?.role === 'delivery_agent') {
        dashboardData.myPerformance = agentPerf.find(
          (agent: any) => agent.userId === user.id
        );
      }
      break;

    case 'fetchCustomerInsights':
      try {
        await storeMethods.fetchCustomerInsights();
        dashboardData.customerInsights = useAnalyticsStore.getState().customerInsights;
      } catch (error) {
        console.error('Failed to fetch customer insights:', error);
        // Provide fallback data so dashboard still renders
        dashboardData.customerInsights = {
          totalCustomers: 0,
          activeCustomers: 0,
          topCustomers: [],
          customersByArea: [],
          avgOrderValue: 0
        };
      }
      break;

    case 'fetchPendingOrders':
      console.log('📋 Fetching pending orders...');
      await storeMethods.fetchPendingOrders();
      dashboardData.pendingOrders = useAnalyticsStore.getState().pendingOrders;
      console.log('📋 Pending orders fetched:', dashboardData.pendingOrders);
      break;

    case 'fetchRecentActivity':
      console.log('📝 Fetching recent activity...');
      await storeMethods.fetchRecentActivity();
      dashboardData.recentActivity = useAnalyticsStore.getState().recentActivity;
      console.log('📝 Recent activity fetched:', dashboardData.recentActivity);
      break;

    case 'fetchAreaDistribution':
      // Create mock geographic distribution based on total orders
      const analyticsStoreForArea = useAnalyticsStore.getState();
      const metricsForArea = analyticsStoreForArea.metrics;
      const totalOrders = metricsForArea?.totalOrders || 76;

      // Mock geographic distribution - Ghana regions
      dashboardData.areaDistribution = [
        { area: 'Greater Accra', orderCount: Math.floor(totalOrders * 0.35) },
        { area: 'Ashanti', orderCount: Math.floor(totalOrders * 0.25) },
        { area: 'Eastern', orderCount: Math.floor(totalOrders * 0.15) },
        { area: 'Western', orderCount: Math.floor(totalOrders * 0.10) },
        { area: 'Central', orderCount: Math.floor(totalOrders * 0.08) },
        { area: 'Northern', orderCount: Math.floor(totalOrders * 0.04) },
        { area: 'Volta', orderCount: Math.floor(totalOrders * 0.03) },
      ].filter(item => item.orderCount > 0);
      break;

    case 'fetchProductPerformance':
      // Aggregate revenue by product - use mock data for now
      const analyticsStoreForProducts = useAnalyticsStore.getState();
      const metricsForProducts = analyticsStoreForProducts.metrics;

      // Create mock product performance data
      dashboardData.productPerformance = [
        { productName: 'Product A', revenue: metricsForProducts?.totalRevenue ? metricsForProducts.totalRevenue * 0.3 : 5000 },
        { productName: 'Product B', revenue: metricsForProducts?.totalRevenue ? metricsForProducts.totalRevenue * 0.25 : 4000 },
        { productName: 'Product C', revenue: metricsForProducts?.totalRevenue ? metricsForProducts.totalRevenue * 0.2 : 3000 },
        { productName: 'Product D', revenue: metricsForProducts?.totalRevenue ? metricsForProducts.totalRevenue * 0.15 : 2000 },
        { productName: 'Product E', revenue: metricsForProducts?.totalRevenue ? metricsForProducts.totalRevenue * 0.1 : 1000 },
      ];
      break;

    case 'fetchOrdersByStatus':
      // Fetch orders from the orders store and group by status for current sales rep
      const ordersStore = useOrdersStore.getState();

      // Ensure orders are loaded
      if (ordersStore.orders.length === 0) {
        await ordersStore.fetchOrders();
      }

      const allOrders = useOrdersStore.getState().orders;

      // Filter orders for current sales rep if role is sales_rep
      const relevantOrders = user?.role === 'sales_rep'
        ? allOrders.filter(order => order.assignedSalesRepId === user.id)
        : allOrders;

      // Group by status and count
      const statusCounts: Record<string, number> = {};
      relevantOrders.forEach(order => {
        const status = order.status || 'unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      // Convert to array format for chart
      dashboardData.ordersByStatus = Object.entries(statusCounts)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count); // Sort by count descending

      console.log('📊 Orders by status:', dashboardData.ordersByStatus);
      break;

    case 'fetchTopProducts':
    case 'fetchRevenueByRegion':
    case 'fetchRecentOrders':
    case 'fetchCustomerAcquisition':
    case 'fetchRecentCustomers':
    case 'fetchEarningsTrends':
    case 'fetchDeliveriesByStatus':
    case 'fetchPerformanceMetrics':
    case 'fetchDailyDeliveries':
    case 'fetchDeliveryTimeAnalysis':
    case 'fetchRecentDeliveries':
    case 'fetchFinancialMetrics':
    case 'fetchCollectionsTrends':
    case 'fetchPaymentsByStatus':
    case 'fetchCashFlowData':
    case 'fetchTopRevenueSources':
    case 'fetchPendingReconciliation':
    case 'fetchInventoryMetrics':
    case 'fetchStockByCategory':
    case 'fetchTopSellingProducts':
    case 'fetchInventoryTurnover':
    case 'fetchStockMovement':
    case 'fetchLowStockItemsList':
      // These methods don't exist yet - return empty data to prevent crashes
      console.warn(`Data fetcher not implemented: ${fetcherName}`);
      dashboardData[fetcherName.replace('fetch', '').toLowerCase()] = [];
      break;

    default:
      console.warn(`Unknown data fetcher: ${fetcherName}`);
  }
}

/**
 * Helper to parse date range preset to number of days
 */
function parseDateRangeToDays(dateRange?: string): number {
  const rangeToDays: Record<string, number> = {
    today: 1,
    yesterday: 1,
    'last-7-days': 7,
    'last-30-days': 30,
    'this-week': 7,
    'this-month': 30,
    'last-month': 30,
    'this-quarter': 90,
    'last-quarter': 90,
    'this-year': 365,
    'last-year': 365,
    all_time: 365,
  };

  return rangeToDays[dateRange || 'last-30-days'] || 30;
}

/**
 * Calculate number of days between two date strings
 */
function calculateDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays || 1; // Return at least 1 day
}
