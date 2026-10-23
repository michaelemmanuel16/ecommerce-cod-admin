/**
 * useDashboardData Hook
 * Fetches and manages dashboard data based on configuration
 * Updated: 2025-11-06
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import debounce from 'lodash/debounce';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { DashboardConfig, DashboardData, DateRangePreset } from '../config/types/dashboard';
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

/** Unpaid delivered orders x the rep's commission rate. Missing rate or count counts as 0. */
export function computeRepEarnings(repPerformance: any, user: any) {
  const unpaidCount = Number(repPerformance?.unpaidDeliveredOrders) || 0;
  const rate = Number(user?.commissionAmount) || 0;
  return {
    myCommission: (unpaidCount * rate).toFixed(2),
    commissionAmount: rate,
    unpaidDeliveredCount: unpaidCount,
  };
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
  const fetchRepPerformance = useAnalyticsStore(state => state.fetchRepPerformance);
  const fetchAgentPerformance = useAnalyticsStore(state => state.fetchAgentPerformance);
  const fetchReadyForPickup = useAnalyticsStore(state => state.fetchReadyForPickup);
  const fetchOrdersByStatus = useAnalyticsStore(state => state.fetchOrdersByStatus);

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
      return;
    }

    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const storeMethods = {
        fetchDashboardMetrics,
        fetchSalesTrends,
        fetchRepPerformance,
        fetchAgentPerformance,
        fetchReadyForPickup,
        fetchOrdersByStatus,
      };

      // Build dashboard data object
      const dashboardData: DashboardData = {
        currentUser: user,
      };

      // Fetch critical metrics first in parallel
      const criticalFetchers = config.dataFetchers.slice(0, 3);
      await Promise.all(
        criticalFetchers.map(async (fetcherName) => {
          try {
            await executeFetcher(fetcherName, dashboardData, storeMethods, user, dateRange);
          } catch (err) {
            console.error(`Error fetching ${fetcherName}:`, err);
            // Continue with other fetchers even if one fails
          }
        })
      );

      // Fetch remaining data in parallel batches (larger batch size for speed)
      const remainingFetchers = config.dataFetchers.slice(3);
      const batchSize = 4;

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
        // No delay between batches - rely on backend rate limiting
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

        // Earnings (for sales reps). A rep with no rate or no unpaid orders earns 0, not a blank card.
        if (dashboardData.repPerformance) {
          Object.assign(calculated, computeRepEarnings(dashboardData.repPerformance, user));
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

        // Success rate (for delivery agents)
        if (dashboardData.myPerformance) {
          calculated.mySuccessRate = dashboardData.myPerformance.deliverySuccessRate?.toFixed(1);
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
    fetchRepPerformance,
    fetchAgentPerformance,
    fetchReadyForPickup,
    fetchOrdersByStatus,
  ]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Setup real-time updates if configured
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // List of events that should trigger a full dashboard refresh
    const refreshEvents = [
      ...(config.realtimeEvents || []),
      'bulk_import_completed',
      'orders:deleted'
    ];

    // Throttled version of fetchData to prevent event storms
    // We use a longer window for bulk operations to ensure data is ready
    const throttledFetch = debounce(() => {
      fetchData();
    }, 5000, { leading: true, trailing: true });

    refreshEvents.forEach((eventName) => {
      socket.on(eventName, (payload: any) => {
        throttledFetch();
      });
    });

    // Cleanup
    return () => {
      refreshEvents.forEach((eventName) => {
        socket.off(eventName);
      });
      throttledFetch.cancel();
    };
  }, [config.realtimeEvents, fetchData]);

  // Setup auto-refresh if configured
  useEffect(() => {
    if (!config.refreshInterval) return;

    const interval = setInterval(() => {
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
  const analyticsStore = useAnalyticsStore.getState();

  // Calculate days for backward compatibility with backend
  const days = dateRange?.startDate && dateRange?.endDate
    ? calculateDaysBetween(dateRange.startDate, dateRange.endDate)
    : parseDateRangeToDays(dateRange?.preset);

  switch (fetcherName) {
    case 'fetchDashboardMetrics':
      await storeMethods.fetchDashboardMetrics(
        dateRange?.startDate,
        dateRange?.endDate
      );
      dashboardData.metrics = useAnalyticsStore.getState().metrics;
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
            confirmationRate: myPerf.confirmationRate ?? null,
            userId: myPerf.userId,
            userName: myPerf.userName,
            unpaidDeliveredOrders: myPerf.unpaidDeliveredOrders || 0,
          };
        } else {
          // No performance data found - use empty defaults
          dashboardData.repPerformance = {
            totalOrders: 0,
            deliveredOrders: 0,
            pendingOrders: 0,
            totalRevenue: 0,
            confirmationRate: null,
          };
        }
      } else {
        // Admins/managers see all reps' performance (array)
        dashboardData.repPerformance = repPerf;
      }
      break;

    case 'fetchAgentPerformance':
      await storeMethods.fetchAgentPerformance(
        dateRange?.startDate,
        dateRange?.endDate
      );
      const agentPerf = useAnalyticsStore.getState().agentPerformance;

      if (user?.role === 'delivery_agent') {
        const myPerf = agentPerf.find((agent: any) => agent.userId === user.id);
        dashboardData.myPerformance = myPerf;

        // Transform backend fields to match config data paths
        if (myPerf) {
          dashboardData.agentPerformance = {
            completedDeliveries: myPerf.completed || 0,
            activeDeliveries: myPerf.active ?? myPerf.pending ?? 0,
            successfulDeliveries: myPerf.completed || 0,
            failedDeliveries: myPerf.failed || 0,
            totalAssigned: myPerf.totalAssigned || 0,
            deliverySuccessRate: myPerf.deliverySuccessRate ?? null,
          };
        } else {
          dashboardData.agentPerformance = {
            completedDeliveries: 0, activeDeliveries: 0,
            successfulDeliveries: 0, failedDeliveries: 0,
            totalAssigned: 0, deliverySuccessRate: null,
          };
        }
      } else {
        dashboardData.agentPerformance = agentPerf;
      }
      break;

    case 'fetchReadyForPickup':
      await storeMethods.fetchReadyForPickup();
      dashboardData.readyForPickup = useAnalyticsStore.getState().readyForPickup;
      break;

    case 'fetchOrdersByStatus':
      await storeMethods.fetchOrdersByStatus(
        dateRange?.startDate,
        dateRange?.endDate
      );
      dashboardData.ordersByStatus = useAnalyticsStore.getState().ordersByStatus;
      break;

    default:
      console.warn(`Unknown data fetcher: ${fetcherName}`);
  }
}

/**
 * Helper to parse date range preset to number of days
 */
function parseDateRangeToDays(dateRange?: DateRangePreset): number {
  const rangeToDays: Record<string, number> = {
    today: 1,
    yesterday: 1,
    'last-7-days': 7,
    'last_7_days': 7,
    'last-30-days': 30,
    'last_30_days': 30,
    'this-week': 7,
    'this_week': 7,
    'this-month': 30,
    'this_month': 30,
    'last-month': 30,
    'last_month': 30,
    'this-quarter': 90,
    'this_quarter': 90,
    'last-quarter': 90,
    'last_quarter': 90,
    'this-year': 365,
    'this_year': 365,
    'last-year': 365,
    'last_year': 365,
    all_time: 365,
  };

  return rangeToDays[(typeof dateRange === 'string' && dateRange) || 'last-30-days'] || 30;
}

/**
 * Calculate number of days between two date strings
 */
function calculateDaysBetween(startDate: string, endDate: string): number {
  // Inclusive of both calendar days (the range bounds are YYYY-MM-DD days)
  const diffDays = Math.abs(differenceInCalendarDays(parseISO(endDate), parseISO(startDate))) + 1;
  return diffDays;
}
