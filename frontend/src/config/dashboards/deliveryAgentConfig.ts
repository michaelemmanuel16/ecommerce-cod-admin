/**
 * Delivery Agent Dashboard Configuration
 *
 * Focus: Daily earnings, delivery performance, active routes, efficiency
 *
 * Metrics:
 * - Personal earnings from deliveries
 * - Active deliveries to complete
 * - Completed deliveries
 * - Success rate
 *
 * Charts:
 * - Earnings over time
 * - Delivery status distribution
 * - Performance metrics
 * - Recent deliveries list (per user feedback: NOT "Delivery Areas")
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
    // My Earnings Over Time (Line Chart)
    {
      id: 'my-earnings-trends',
      type: 'lineChart',
      title: 'My Earnings Over Time',
      dataSource: 'earningsTrends',
      gridPosition: { row: 1, col: 1, colSpan: 2 },
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['earnings'],
        colors: ['#10B981'],
        showDots: true,
        fill: true,
        format: 'currency',
      },
    },

    // My Delivery Status (Donut Chart)
    {
      id: 'my-delivery-status',
      type: 'donutChart',
      title: 'My Delivery Status',
      dataSource: 'deliveriesByStatus',
      gridPosition: { row: 1, col: 3, colSpan: 1 },
      height: 300,
      config: {
        nameKey: 'status',
        valueKey: 'count',
        innerRadius: 60,
        showLabels: true,
        showLegend: true,
        colors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'],
      },
    },

    // My Performance Metrics (Bar Chart)
    {
      id: 'my-performance-metrics',
      type: 'barChart',
      title: 'My Performance Metrics',
      dataSource: 'performanceMetrics',
      gridPosition: { row: 2, col: 1, colSpan: 1 },
      height: 300,
      config: {
        xAxis: 'metric',
        yAxis: 'value',
        orientation: 'horizontal',
        format: 'percentage',
        colors: ['#3B82F6'],
      },
    },

    // My Delivery Count by Day (Bar Chart)
    {
      id: 'my-daily-deliveries',
      type: 'barChart',
      title: 'My Daily Deliveries',
      dataSource: 'dailyDeliveries',
      gridPosition: { row: 2, col: 2, colSpan: 1 },
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: 'count',
        orientation: 'vertical',
        format: 'number',
        colors: ['#8B5CF6'],
      },
    },

    // My Delivery Time Analysis (Line Chart)
    {
      id: 'my-delivery-time',
      type: 'lineChart',
      title: 'My Average Delivery Time',
      dataSource: 'deliveryTimeAnalysis',
      gridPosition: { row: 2, col: 3, colSpan: 1 },
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['avgTime'],
        colors: ['#F59E0B'],
        showDots: true,
        format: 'number',
      },
    },

    // My Recent Deliveries (Data Table) - Per User Feedback
    {
      id: 'my-recent-deliveries',
      type: 'dataTable',
      title: 'My Recent Deliveries',
      dataSource: 'recentDeliveries',
      gridPosition: { row: 3, col: 1, colSpan: 3 },
      height: 400,
      config: {
        columns: [
          { key: 'orderId', label: 'Order ID', sortable: true },
          { key: 'customerName', label: 'Customer', sortable: true },
          { key: 'address', label: 'Address', sortable: false },
          { key: 'status', label: 'Status', sortable: true },
          { key: 'deliveryTime', label: 'Time', sortable: true, format: 'datetime' },
          { key: 'earnings', label: 'Earnings', sortable: true, format: 'currency' },
        ],
        maxRows: 10,
        onRowClick: 'order_details',
      },
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
    'fetchEarningsTrends',
    'fetchDeliveriesByStatus',
    'fetchPerformanceMetrics',
    'fetchDailyDeliveries',
    'fetchDeliveryTimeAnalysis',
    'fetchRecentDeliveries',
    'fetchAgentPerformance',
  ],
};
