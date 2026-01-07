/**
 * Inventory Manager Dashboard Configuration
 *
 * Focus: Stock levels, low stock alerts, product performance, inventory turnover
 *
 * Metrics:
 * - Total products in catalog
 * - Low stock items (below reorder threshold)
 * - Out of stock products
 * - Total inventory value
 *
 * Charts:
 * - Stock levels by category
 * - Top selling products
 * - Inventory turnover trends
 * - Low stock items list
 * - Product performance
 * - Stock movement
 */

import { DashboardConfig } from '../types/dashboard';

export const inventoryManagerConfig: DashboardConfig = {
  title: 'Inventory Overview',

  // Date range controls
  dateRangePresets: [
    { label: 'Today', value: 'today' },
    { label: 'Last 7 days', value: 'last_7_days' },
    { label: 'Last 30 days', value: 'last_30_days' },
    { label: 'This Month', value: 'this_month' },
    { label: 'Last Month', value: 'last_month' },
    { label: 'This Quarter', value: 'this_quarter' },
  ],
  defaultDateRange: { label: 'This Month', value: 'this_month' },

  // 4 Stat Cards
  statCards: [
    {
      id: 'total-products',
      type: 'stat',
      title: 'Total Products',
      icon: 'Package',
      iconColor: 'text-blue-600',
      dataSource: 'inventoryMetrics.totalProducts',
      format: 'number',
      subtitle: {
        template: '{active} active products',
        dataSources: {
          active: 'inventoryMetrics.activeProducts',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'inventoryMetrics.previousTotalProducts',
      },
    },
    {
      id: 'low-stock-items',
      type: 'stat',
      title: 'Low Stock Items',
      icon: 'AlertTriangle',
      iconColor: 'text-orange-600',
      dataSource: 'inventoryMetrics.lowStockItems',
      format: 'number',
      subtitle: {
        template: 'Reorder required',
        dataSources: {},
      },
      trend: {
        enabled: true,
        compareKey: 'inventoryMetrics.previousLowStockItems',
        inverted: true, // More low stock = worse
      },
    },
    {
      id: 'out-of-stock',
      type: 'stat',
      title: 'Out of Stock',
      icon: 'XCircle',
      iconColor: 'text-red-600',
      dataSource: 'inventoryMetrics.outOfStock',
      format: 'number',
      subtitle: {
        template: 'Urgent restock needed',
        dataSources: {},
      },
      trend: {
        enabled: true,
        compareKey: 'inventoryMetrics.previousOutOfStock',
        inverted: true, // More out of stock = worse
      },
    },
    {
      id: 'inventory-value',
      type: 'stat',
      title: 'Inventory Value',
      icon: 'DollarSign',
      iconColor: 'text-green-600',
      dataSource: 'inventoryMetrics.totalValue',
      format: 'currency',
      subtitle: {
        template: '{count} units in stock',
        dataSources: {
          count: 'inventoryMetrics.totalUnits',
        },
      },
      trend: {
        enabled: true,
        compareKey: 'inventoryMetrics.previousTotalValue',
      },
    },
  ],

  // Charts
  charts: [
    // Stock Levels by Category (Bar Chart)
    {
      id: 'stock-by-category',
      type: 'barChart',
      title: 'Stock Levels by Category',
      dataSource: 'stockByCategory',
      gridPosition: { row: 1, col: 1, colSpan: 1 },
      height: 300,
      config: {
        xAxis: 'category',
        yAxis: 'quantity',
        orientation: 'vertical',
        format: 'number',
        colors: ['#3B82F6'],
      },
    },

    // Top Selling Products (Leaderboard)
    {
      id: 'top-selling-products',
      type: 'leaderboard',
      title: 'Top Selling Products',
      dataSource: 'topSellingProducts',
      gridPosition: { row: 1, col: 2, colSpan: 1 },
      height: 300,
      config: {
        nameKey: 'name',
        valueKey: 'unitsSold',
        sortBy: 'unitsSold',
        sortOrder: 'desc',
        maxItems: 10,
        format: 'number',
        showRank: true,
      },
    },

    // Inventory Turnover (Line Chart)
    {
      id: 'inventory-turnover',
      type: 'lineChart',
      title: 'Inventory Turnover',
      dataSource: 'inventoryTurnover',
      gridPosition: { row: 1, col: 3, colSpan: 1 },
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['turnoverRate'],
        colors: ['#10B981'],
        showDots: true,
        showMovingAverage: true,
        movingAverageWindow: 7,
        format: 'number',
      },
    },

    // Product Performance (Bar Chart)
    {
      id: 'product-performance',
      type: 'barChart',
      title: 'Product Performance',
      dataSource: 'productPerformance',
      gridPosition: { row: 2, col: 1, colSpan: 1 },
      height: 300,
      config: {
        xAxis: 'name',
        yAxis: ['revenue', 'profit'],
        orientation: 'vertical',
        maxBars: 10,
        format: 'currency',
        colors: ['#3B82F6', '#10B981'],
      },
    },

    // Stock Movement (Line Chart)
    {
      id: 'stock-movement',
      type: 'lineChart',
      title: 'Stock Movement',
      dataSource: 'stockMovement',
      gridPosition: { row: 2, col: 2, colSpan: 2 },
      height: 300,
      config: {
        xAxis: 'date',
        yAxis: ['stockIn', 'stockOut'],
        colors: ['#10B981', '#EF4444'],
        showDots: false,
        fill: true,
        format: 'number',
      },
    },

    // Low Stock Items (Data Table)
    {
      id: 'low-stock-items-list',
      type: 'dataTable',
      title: 'Low Stock Items',
      dataSource: 'lowStockItemsList',
      gridPosition: { row: 3, col: 1, colSpan: 3 },
      height: 400,
      config: {
        columns: [
          { key: 'name', label: 'Product', sortable: true },
          { key: 'sku', label: 'SKU', sortable: true },
          { key: 'currentStock', label: 'In Stock', sortable: true, format: 'number' },
          { key: 'reorderLevel', label: 'Reorder Level', sortable: true, format: 'number' },
          { key: 'unitsSold', label: 'Units Sold', sortable: true, format: 'number' },
          { key: 'lastRestocked', label: 'Last Restock', sortable: true, format: 'date' },
        ],
        maxRows: 15,
        onRowClick: 'product_details',
      },
    },
  ],

  // Real-time updates
  realtimeEvents: [
    'product:updated',
    'product:stock_changed',
    'order:created',
  ],

  // Data fetchers needed
  dataFetchers: [
    'fetchDashboardMetrics',
    'fetchInventoryMetrics',
    'fetchStockByCategory',
    'fetchTopSellingProducts',
    'fetchInventoryTurnover',
    'fetchProductPerformance',
    'fetchStockMovement',
    'fetchLowStockItemsList',
  ],
};
