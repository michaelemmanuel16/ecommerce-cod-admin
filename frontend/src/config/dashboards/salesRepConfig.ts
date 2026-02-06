/**
 * Sales Representative Dashboard Configuration
 *
 * Focus: Personal sales performance, commission tracking, customer acquisition
 *
 * Metrics:
 * - Personal commission and earnings
 * - Pending orders to follow up
 * - Total orders created
 * - Conversion rate
 *
 * Charts:
 * - Sales trends over time
 * - Order status distribution
 * - Top selling products
 * - Recent customer interactions
 */

import { DashboardConfig } from '../types/dashboard';

export const salesRepConfig: DashboardConfig = {
  title: 'Rep Dashboard',

  // Date range controls
  dateRangePresets: [
    { label: 'Last 7 days', value: 'last_7_days' },
    { label: 'Last 30 days', value: 'last_30_days' },
    { label: 'This Month', value: 'this_month' },
    { label: 'Last Month', value: 'last_month' },
    { label: 'This Quarter', value: 'this_quarter' },
    { label: 'Last Quarter', value: 'last_quarter' },
    { label: 'This Year', value: 'this_year' },
    { label: 'All Time', value: 'all_time' },
  ],
  defaultDateRange: { label: 'This Month', value: 'this_month' },

  // 4 Stat Cards (Per User Requirements)
  statCards: [
    {
      id: 'my-commission',
      type: 'stat',
      title: 'My Earnings',
      icon: 'Wallet',
      iconColor: 'text-green-600',
      dataSource: 'calculated.myCommission',
      format: 'currency',
      subtitle: {
        template: 'Pending from {delivered} unpaid orders @ {rate}',
        dataSources: {
          delivered: 'repPerformance.deliveredOrders',
          rate: 'calculated.commissionAmount',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'repPerformance.previousCommission',
      },
    },
    {
      id: 'my-pending-orders',
      type: 'stat',
      title: 'My Pending Orders',
      icon: 'Clock',
      iconColor: 'text-orange-600',
      dataSource: 'repPerformance.pendingOrders',
      format: 'number',
      subtitle: {
        template: 'Follow up required',
        dataSources: {},
      },
      trend: {
        enabled: true,
        compareKey: 'repPerformance.previousPendingOrders',
        inverted: true, // More pending = worse
      },
    },
    {
      id: 'my-total-orders',
      type: 'stat',
      title: 'My Total Orders',
      icon: 'ShoppingBag',
      iconColor: 'text-blue-600',
      dataSource: 'repPerformance.totalOrders',
      format: 'number',
      subtitle: {
        template: '{amount} revenue',
        dataSources: {
          amount: 'repPerformance.totalRevenue',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'repPerformance.previousTotalOrders',
      },
    },
    {
      id: 'my-conversion-rate',
      type: 'stat',
      title: 'My Conversion Rate',
      icon: 'TrendingUp',
      iconColor: 'text-indigo-600',
      dataSource: 'calculated.myConversionRate',
      format: 'percentage',
      subtitle: {
        template: '{delivered} of {total} delivered',
        dataSources: {
          delivered: 'repPerformance.deliveredOrders',
          total: 'repPerformance.totalOrders',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'repPerformance.previousConversionRate',
      },
    },
  ],

  // Charts
  charts: [
    // My Orders vs Deliveries (Line Chart)
    {
      id: 'my-sales-trends',
      type: 'lineChart',
      title: 'My Orders vs Deliveries',
      dataSource: 'salesTrends',
      gridPosition: { row: 1, col: 1, colSpan: 2 },
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['orders', 'delivered'],
        colors: ['#3B82F6', '#10B981'],
        showDots: true,
        showMovingAverage: false,
        format: 'number',
      },
    },

    // My Order Status Distribution (Donut Chart)
    {
      id: 'my-order-status',
      type: 'donutChart',
      title: 'My Order Status Distribution',
      dataSource: 'ordersByStatus',
      gridPosition: { row: 1, col: 3, colSpan: 1 },
      height: 300,
      config: {
        nameKey: 'status',
        valueKey: 'count',
        innerRadius: 60,
        showLabels: true,
        showLegend: true,
        colors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
      },
    },

  ],

  // Real-time updates
  realtimeEvents: [
    'order:created',
    'order:updated',
    'order:assigned',
    'order:status_changed',
  ],

  // Data fetchers needed
  dataFetchers: [
    'fetchDashboardMetrics',
    'fetchSalesTrends',
    'fetchOrdersByStatus',
    'fetchRepPerformance',
  ],
};
