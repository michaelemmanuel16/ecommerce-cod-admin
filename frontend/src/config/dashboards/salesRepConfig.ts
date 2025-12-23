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
  title: 'Sales Performance',

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
  defaultDateRange: { label: 'Last 30 days', value: 'last_30_days' },

  // 4 Stat Cards (Per User Requirements)
  statCards: [
    {
      id: 'my-commission',
      type: 'stat',
      title: 'My Commission',
      icon: 'Wallet',
      dataSource: 'calculated.myCommission',
      format: 'currency',
      subtitle: {
        template: 'From {count} orders @ {rate}%',
        dataSources: {
          count: 'repPerformance.totalOrders',
          rate: 'calculated.commissionRate',
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
    // My Sales Trends (Line Chart)
    {
      id: 'my-sales-trends',
      type: 'lineChart',
      title: 'My Sales Trends',
      dataSource: 'salesTrends',
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['revenue', 'orders'],
        colors: ['#3B82F6', '#10B981'],
        showDots: true,
        showMovingAverage: true,
        movingAverageWindow: 7,
        format: 'currency',
      },
    },

    // My Order Status Distribution (Donut Chart)
    {
      id: 'my-order-status',
      type: 'donutChart',
      title: 'My Order Status Distribution',
      dataSource: 'ordersByStatus',
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

    // My Top Products (Bar Chart)
    {
      id: 'my-top-products',
      type: 'barChart',
      title: 'My Top Products',
      dataSource: 'productPerformance',
      height: 300,
      config: {
        xAxis: 'name',
        yAxis: 'revenue',
        orientation: 'vertical',
        maxBars: 10,
        format: 'currency',
        colors: ['#3B82F6'],
      },
    },

    // My Commission Over Time (Line Chart)
    {
      id: 'my-commission-trends',
      type: 'lineChart',
      title: 'My Commission Over Time',
      dataSource: 'salesTrends',
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['commission'],
        colors: ['#10B981'],
        showDots: false,
        fill: true,
        format: 'currency',
      },
    },

    // My Customer Acquisition (Bar Chart)
    {
      id: 'my-customer-acquisition',
      type: 'barChart',
      title: 'My Customer Acquisition',
      dataSource: 'customerAcquisition',
      height: 300,
      config: {
        xAxis: 'month',
        yAxis: 'customers',
        orientation: 'vertical',
        format: 'number',
        colors: ['#8B5CF6'],
      },
    },

    // My Recent Customers (Data Table)
    {
      id: 'my-recent-customers',
      type: 'dataTable',
      title: 'My Recent Customers',
      dataSource: 'recentCustomers',
      height: 400,
      config: {
        columns: [
          { key: 'name', label: 'Customer', sortable: true },
          { key: 'phone', label: 'Phone', sortable: false },
          { key: 'totalOrders', label: 'Orders', sortable: true, format: 'number' },
          { key: 'totalSpent', label: 'Spent', sortable: true, format: 'currency' },
          { key: 'lastOrderDate', label: 'Last Order', sortable: true, format: 'date' },
        ],
        maxRows: 10,
        onRowClick: true,
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
    'fetchProductPerformance',
    'fetchCustomerAcquisition',
    'fetchRecentCustomers',
    'fetchRepPerformance',
  ],
};
