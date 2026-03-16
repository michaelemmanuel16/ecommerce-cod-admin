/**
 * Delivery Agent Dashboard Configuration
 *
 * Focus: Daily earnings, delivery performance, active routes, efficiency
 *
 * Layout:
 * - Row 1: 4 stat cards (earnings, active, completed, success rate)
 * - Row 2: Orders by Status donut chart (2/3) + Pending Orders widget (1/3)
 */

import { DashboardConfig } from '../types/dashboard';

export const deliveryAgentConfig: DashboardConfig = {
  title: 'My Deliveries',

  // Date range controls
  dateRangePresets: [
    { label: 'Today', value: 'today' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: 'Last 7 days', value: 'last_7_days' },
    { label: 'Last 30 days', value: 'last_30_days' },
    { label: 'This Month', value: 'this_month' },
    { label: 'Last Month', value: 'last_month' },
  ],
  defaultDateRange: { label: 'This Month', value: 'this_month' },

  // 4 Stat Cards (Per User Requirements)
  statCards: [
    {
      id: 'my-earnings',
      type: 'stat',
      title: 'My Earnings',
      icon: 'DollarSign',
      iconColor: 'text-green-600',
      dataSource: 'calculated.myEarnings',
      format: 'currency',
      info: 'Total earnings based on your delivery rate per completed delivery this period',
      subtitle: {
        template: 'From {count} deliveries',
        dataSources: {
          count: 'agentPerformance.completedDeliveries',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'agentPerformance.previousEarnings',
      },
    },
    {
      id: 'my-active-deliveries',
      type: 'stat',
      title: 'My Active Deliveries',
      icon: 'Package',
      iconColor: 'text-blue-600',
      dataSource: 'agentPerformance.activeDeliveries',
      format: 'number',
      info: 'Orders currently assigned to you that are in progress',
      subtitle: {
        template: 'In progress',
        dataSources: {},
      },
      trend: {
        enabled: false,
      },
    },
    {
      id: 'my-completed-deliveries',
      type: 'stat',
      title: 'My Completed Deliveries',
      icon: 'CheckCircle',
      iconColor: 'text-indigo-600',
      dataSource: 'agentPerformance.completedDeliveries',
      format: 'number',
      info: 'Total deliveries you have completed this period',
      subtitle: {
        template: '{successful} successful',
        dataSources: {
          successful: 'agentPerformance.successfulDeliveries',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'agentPerformance.previousCompletedDeliveries',
      },
    },
    {
      id: 'my-success-rate',
      type: 'stat',
      title: 'My Success Rate',
      icon: 'Award',
      iconColor: 'text-orange-600',
      dataSource: 'calculated.mySuccessRate',
      format: 'percentage',
      info: 'Percentage of assigned deliveries successfully completed',
      subtitle: {
        template: '{failed} failed deliveries',
        dataSources: {
          failed: 'agentPerformance.failedDeliveries',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'agentPerformance.previousSuccessRate',
      },
    },
  ],

  // Charts
  charts: [
    // Orders by Status (Donut Chart) — real data from fetchOrdersByStatus
    {
      id: 'orders-by-status',
      type: 'donutChart',
      title: 'Orders by Status',
      dataSource: 'ordersByStatus',
      gridPosition: { row: 1, col: 1, colSpan: 2 },
      height: 300,
      config: {
        nameKey: 'status',
        valueKey: 'count',
        innerRadius: 60,
        showLabels: true,
        showLegend: true,
        colors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'],
      },
    },
    // Pending Orders — real data from fetchPendingOrders
    {
      id: 'pending-orders',
      type: 'ordersAwaiting',
      title: 'Pending Orders',
      dataSource: 'pendingOrders',
      gridPosition: { row: 1, col: 3, colSpan: 1 },
      height: 300,
      config: {},
    },
  ],

  // Real-time updates
  realtimeEvents: [
    'delivery:updated',
    'delivery:assigned',
    'delivery:completed',
  ],

  // Data fetchers needed
  dataFetchers: [
    'fetchDashboardMetrics',
    'fetchAgentPerformance',
    'fetchOrdersByStatus',
    'fetchPendingOrders',
  ],
};
