/**
 * Admin Dashboard Configuration
 * Dashboard for super_admin, admin, and manager roles
 */

import { DashboardConfig } from '../types/dashboard';

export const adminDashboardConfig: DashboardConfig = {
  title: 'Admin Dashboard',
  description: 'Business Activity Overview',
  roles: ['super_admin', 'admin', 'manager'],

  // Date range settings
  dateRangePresets: ['today', 'yesterday', 'this-week', 'this-month', 'last-7-days', 'last-30-days', 'this-year', 'last-year'],
  defaultDateRange: 'this-month',
  allowComparison: true,

  // Row 1: Stat cards (4 key metrics)
  statCards: [
    {
      id: 'total-revenue',
      type: 'stat',
      title: 'Total Revenue',
      icon: 'DollarSign',
      iconColor: 'text-green-600',
      dataSource: 'metrics.totalRevenue',
      format: 'currency',
      trend: {
        enabled: true,
        comparison: 'previousPeriod',
      },
      subtitle: undefined,
    },
    {
      id: 'total-orders',
      type: 'stat',
      title: 'Total Orders',
      icon: 'ShoppingBag',
      iconColor: 'text-blue-600',
      dataSource: 'metrics.totalOrders',
      format: 'number',
      trend: {
        enabled: true,
        comparison: 'previousPeriod',
      },
      subtitle: undefined,
    },
    {
      id: 'total-customers',
      type: 'stat',
      title: 'Total Customers',
      icon: 'Users',
      iconColor: 'text-purple-600',
      dataSource: 'customerInsights.totalCustomers',
      format: 'number',
      trend: {
        enabled: true,
        comparison: 'previousPeriod',
      },
      subtitle: undefined,
    },
    {
      id: 'delivery-rate',
      type: 'stat',
      title: 'Delivery Rate',
      icon: 'TrendingUp',
      iconColor: 'text-indigo-600',
      dataSource: 'metrics.deliveryRate',
      format: 'percentage',
      trend: {
        enabled: true,
        comparison: 'previousPeriod',
      },
      subtitle: undefined,
    },
  ],

  // Row 2: Charts (60% Revenue Trend + 40% Order Status Distribution)
  // Row 3: Orders Awaiting Action + Recent Activity
  charts: [
    {
      id: 'fulfillment-trend',
      type: 'lineChart',
      title: 'Order Fulfillment Trend',
      gridPosition: { row: 1, col: 1, colSpan: 2 },
      height: 350,
      dataSource: 'salesTrends',
      config: {
        xAxis: 'date',
        yAxis: ['orders', 'delivered'],
        colors: ['#3B82F6', '#10B981'], // Blue for orders, Green for delivered
        showMovingAverage: false,
        strokeWidth: 2,
        showDots: true,
        format: 'number',
      },
    },
    {
      id: 'order-status',
      type: 'donutChart',
      title: 'Order Status Distribution',
      gridPosition: { row: 1, col: 3, colSpan: 1 },
      height: 350,
      dataSource: 'conversionFunnel',
      config: {
        nameKey: 'status',
        valueKey: 'count',
        innerRadius: 60,
        showLegend: true,
        showLabels: false,
      },
    },
    {
      id: 'orders-awaiting',
      type: 'ordersAwaiting',
      title: 'Orders Awaiting Action',
      gridPosition: { row: 2, col: 1, colSpan: 2 },
      height: 400,
      dataSource: 'pendingOrders',
    },
    {
      id: 'recent-activity',
      type: 'recentActivity',
      title: 'Recent Activity',
      gridPosition: { row: 2, col: 3, colSpan: 1 },
      height: 400,
      dataSource: 'recentActivity',
    },
  ],

  // Real-time Socket.io events to listen for
  realtimeEvents: [
    'order:created',
    'order:updated',
    'order:assigned',
    'order:status_changed',
    'delivery:completed',
  ],

  // Data fetchers to call on mount
  dataFetchers: [
    'fetchDashboardMetrics',
    'fetchSalesTrends',
    'fetchConversionFunnel',
    'fetchCustomerInsights',
    'fetchPendingOrders',
    'fetchRecentActivity',
  ],
};
