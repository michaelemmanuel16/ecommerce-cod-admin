/**
 * Accountant Dashboard Configuration
 *
 * Focus: Financial reconciliation, payment tracking, revenue analysis, cash flow
 *
 * Metrics:
 * - Total cash collected from deliveries
 * - Pending collections (outstanding COD payments)
 * - Orders reconciled today
 * - Financial discrepancies
 *
 * Charts:
 * - Daily collections trends
 * - Payment status distribution
 * - Revenue by region
 * - Pending reconciliation items
 * - Cash flow analysis
 * - Top revenue sources
 */

import { DashboardConfig } from '../types/dashboard';

export const accountantConfig: DashboardConfig = {
  title: 'Financial Overview',

  // Date range controls
  dateRangePresets: [
    { label: 'Today', value: 'today' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: 'Last 7 days', value: 'last_7_days' },
    { label: 'Last 30 days', value: 'last_30_days' },
    { label: 'This Month', value: 'this_month' },
    { label: 'Last Month', value: 'last_month' },
    { label: 'This Quarter', value: 'this_quarter' },
    { label: 'Last Quarter', value: 'last_quarter' },
  ],
  defaultDateRange: { label: 'This Month', value: 'this_month' },

  // 4 Stat Cards
  statCards: [
    {
      id: 'total-collected',
      type: 'stat',
      title: 'Total Collected',
      icon: 'Wallet',
      iconColor: 'text-green-600',
      dataSource: 'financialMetrics.totalCollected',
      format: 'currency',
      subtitle: {
        template: 'From {count} deliveries',
        dataSources: {
          count: 'financialMetrics.completedDeliveries',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'financialMetrics.previousCollected',
      },
    },
    {
      id: 'pending-collections',
      type: 'stat',
      title: 'Pending Collections',
      icon: 'Clock',
      iconColor: 'text-orange-600',
      dataSource: 'financialMetrics.pendingCollections',
      format: 'currency',
      subtitle: {
        template: '{count} orders outstanding',
        dataSources: {
          count: 'financialMetrics.pendingOrders',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'financialMetrics.previousPending',
        inverted: true, // More pending = worse
      },
    },
    {
      id: 'reconciled-today',
      type: 'stat',
      title: 'Reconciled Today',
      icon: 'CheckCircle',
      iconColor: 'text-blue-600',
      dataSource: 'financialMetrics.reconciledToday',
      format: 'number',
      subtitle: {
        template: '{amount} processed',
        dataSources: {
          amount: 'financialMetrics.reconciledAmount',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'financialMetrics.previousReconciled',
      },
    },
    {
      id: 'discrepancies',
      type: 'stat',
      title: 'Discrepancies',
      icon: 'AlertCircle',
      iconColor: 'text-red-600',
      dataSource: 'financialMetrics.discrepancies',
      format: 'number',
      subtitle: {
        template: '{amount} total value',
        dataSources: {
          amount: 'financialMetrics.discrepancyAmount',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'financialMetrics.previousDiscrepancies',
        inverted: true, // More discrepancies = worse
      },
    },
  ],

  // Charts
  charts: [
    // Daily Collections (Line Chart)
    {
      id: 'daily-collections',
      type: 'lineChart',
      title: 'Daily Collections',
      dataSource: 'collectionsTrends',
      gridPosition: { row: 1, col: 1, colSpan: 2 },
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['collected', 'pending'],
        colors: ['#10B981', '#F59E0B'],
        showDots: true,
        showMovingAverage: true,
        movingAverageWindow: 7,
        format: 'currency',
      },
    },

    // Payment Status Distribution (Donut Chart)
    {
      id: 'payment-status',
      type: 'donutChart',
      title: 'Payment Status Distribution',
      dataSource: 'paymentsByStatus',
      gridPosition: { row: 1, col: 3, colSpan: 1 },
      height: 300,
      config: {
        nameKey: 'status',
        valueKey: 'amount',
        innerRadius: 60,
        showLabels: true,
        showLegend: true,
        colors: ['#10B981', '#F59E0B', '#EF4444', '#6B7280'],
      },
    },

    // Revenue by Region (Bar Chart)
    {
      id: 'revenue-by-region',
      type: 'barChart',
      title: 'Revenue by Region',
      dataSource: 'revenueByRegion',
      gridPosition: { row: 2, col: 1, colSpan: 1 },
      height: 300,
      config: {
        xAxis: 'region',
        yAxis: 'revenue',
        orientation: 'vertical',
        maxBars: 10,
        format: 'currency',
        colors: ['#3B82F6'],
      },
    },

    // Cash Flow Analysis (Line Chart)
    {
      id: 'cash-flow',
      type: 'lineChart',
      title: 'Cash Flow Analysis',
      dataSource: 'cashFlowData',
      gridPosition: { row: 2, col: 2, colSpan: 1 },
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['inflow', 'outflow'],
        colors: ['#10B981', '#EF4444'],
        showDots: false,
        fill: true,
        format: 'currency',
      },
    },

    // Top Revenue Sources (Leaderboard)
    {
      id: 'top-revenue-sources',
      type: 'leaderboard',
      title: 'Top Revenue Sources',
      dataSource: 'topRevenueSources',
      gridPosition: { row: 2, col: 3, colSpan: 1 },
      height: 300,
      config: {
        nameKey: 'source',
        valueKey: 'revenue',
        sortBy: 'revenue',
        sortOrder: 'desc',
        maxItems: 10,
        format: 'currency',
        showRank: true,
      },
    },

    // Pending Reconciliation (Data Table)
    {
      id: 'pending-reconciliation',
      type: 'dataTable',
      title: 'Pending Reconciliation',
      dataSource: 'pendingReconciliation',
      gridPosition: { row: 3, col: 1, colSpan: 3 },
      height: 400,
      config: {
        columns: [
          { key: 'orderId', label: 'Order ID', sortable: true },
          { key: 'customerName', label: 'Customer', sortable: true },
          { key: 'amount', label: 'Amount', sortable: true, format: 'currency' },
          { key: 'deliveryDate', label: 'Delivered', sortable: true, format: 'date' },
          { key: 'status', label: 'Status', sortable: true },
          { key: 'agentName', label: 'Agent', sortable: true },
        ],
        maxRows: 15,
        onRowClick: 'order_details',
      },
    },
  ],

  // Real-time updates
  realtimeEvents: [
    'order:status_changed',
    'delivery:completed',
    'payment:received',
  ],

  // Data fetchers needed
  dataFetchers: [
    'fetchDashboardMetrics',
    'fetchFinancialMetrics',
    'fetchCollectionsTrends',
    'fetchPaymentsByStatus',
    'fetchRevenueByRegion',
    'fetchCashFlowData',
    'fetchTopRevenueSources',
    'fetchPendingReconciliation',
  ],
};
