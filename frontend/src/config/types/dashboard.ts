/**
 * Dashboard Configuration Types
 * Defines the structure for config-driven dashboards
 */

import { LucideIcon } from 'lucide-react';

// ============================================================================
// Base Types
// ============================================================================

export type DateRangePreset =
  | string
  | { label: string; value: string };

export type ValueFormat = 'number' | 'currency' | 'percentage' | 'time' | 'date' | 'datetime' | 'custom';

export type TrendComparison = 'previousPeriod' | 'yesterday' | 'lastWeek' | 'lastMonth' | 'custom';

export type WidgetType = 'stat' | 'lineChart' | 'donutChart' | 'barChart' | 'leaderboard' | 'dataTable' | 'ordersAwaiting' | 'recentActivity';

export type ChartOrientation = 'horizontal' | 'vertical';

export type SortOrder = 'asc' | 'desc';

// ============================================================================
// Grid Layout Types
// ============================================================================

export interface GridPosition {
  row: number;
  col: number;
  colSpan?: number;
  rowSpan?: number;
}

// ============================================================================
// Stat Card Configuration
// ============================================================================

export interface TrendConfig {
  enabled: boolean;
  comparison?: TrendComparison;
  dataSource?: string;
  compareKey?: string; // Support for older config format
  inverted?: boolean; // True if lower values are better (e.g., cancellation rate)
}

export interface SubtitleConfig {
  template: string; // Template string with {placeholder} syntax
  dataSources: Record<string, string>; // Map of placeholder names to data paths
}

export interface StatCardConfig {
  id: string;
  type: 'stat';
  title: string;
  icon: string; // Lucide icon name
  iconColor: string; // Tailwind color class
  dataSource: string; // Path to data (e.g., 'metrics.totalRevenue')
  format: ValueFormat;
  trend?: TrendConfig;
  subtitle?: SubtitleConfig;
  onClick?: string; // Action to trigger on click
  info?: string; // Tooltip text
}

// ============================================================================
// Chart Configurations
// ============================================================================

export interface LineChartConfig {
  id: string;
  type: 'lineChart';
  title: string;
  gridPosition: GridPosition;
  height: number;
  dataSource: string;
  config: {
    xAxis: string; // Data key for X axis
    yAxis: string[]; // Data keys for Y axis (can be multiple lines)
    colors?: string[]; // Colors for each line
    showMovingAverage?: boolean;
    movingAverageWindow?: number;
    showComparison?: boolean; // Show comparison to previous period
    strokeWidth?: number;
    showDots?: boolean;
    fill?: boolean; // Area chart style
    format?: ValueFormat;
  };
}

export interface DonutChartConfig {
  id: string;
  type: 'donutChart';
  title: string;
  gridPosition: GridPosition;
  height: number;
  dataSource: string;
  config: {
    nameKey: string;
    valueKey: string;
    colors?: string[];
    innerRadius?: number; // Percentage (60 = 60%)
    showLegend?: boolean;
    showLabels?: boolean;
  };
}

export interface BarChartConfig {
  id: string;
  type: 'barChart';
  title: string;
  gridPosition: GridPosition;
  height: number;
  dataSource: string;
  config: {
    xAxis: string;
    yAxis: string | string[]; // Can have multiple bars
    colors?: string[];
    orientation?: ChartOrientation;
    maxBars?: number; // Limit to top N
    format?: ValueFormat;
    stacked?: boolean;
  };
}

export interface LeaderboardConfig {
  id: string;
  type: 'leaderboard';
  title: string;
  gridPosition: GridPosition;
  height: number;
  dataSource: string;
  config: {
    nameKey: string;
    valueKey: string;
    avatarKey?: string;
    maxItems?: number;
    sortBy: string;
    sortOrder?: SortOrder;
    format?: ValueFormat;
    showRank?: boolean;
    showAvatar?: boolean;
  };
}

export interface DataTableConfig {
  id: string;
  type: 'dataTable';
  title: string;
  gridPosition: GridPosition;
  height: number;
  dataSource: string;
  config: {
    columns: Array<{
      key: string;
      label: string;
      format?: ValueFormat;
      sortable?: boolean;
    }>;
    maxRows?: number;
    showPagination?: boolean;
    onRowClick?: string; // Action to trigger
  };
}

export interface OrdersAwaitingConfig {
  id: string;
  type: 'ordersAwaiting';
  title: string;
  gridPosition: GridPosition;
  height: number;
  dataSource: string;
}

export interface RecentActivityConfig {
  id: string;
  type: 'recentActivity';
  title: string;
  gridPosition: GridPosition;
  height: number;
  dataSource: string;
}

export type ChartConfig =
  | LineChartConfig
  | DonutChartConfig
  | BarChartConfig
  | LeaderboardConfig
  | DataTableConfig
  | OrdersAwaitingConfig
  | RecentActivityConfig;

// ============================================================================
// Widget Configuration (Union of all widget types)
// ============================================================================

export type WidgetConfig = StatCardConfig | ChartConfig;

// ============================================================================
// Data Filters
// ============================================================================

export interface DataFilters {
  [dataSourceKey: string]: {
    [filterKey: string]: string | number | boolean;
  };
}

// ============================================================================
// Dashboard Configuration
// ============================================================================

export interface DashboardConfig {
  // Metadata
  title: string;
  description?: string;
  roles?: string[]; // Which roles can access this dashboard

  // Date range settings
  dateRangePresets: DateRangePreset[];
  defaultDateRange: DateRangePreset;
  allowComparison?: boolean;

  // Data filtering (for role-specific filtering)
  dataFilters?: DataFilters;

  // Layout
  statCards: StatCardConfig[];
  charts: ChartConfig[];

  // Real-time updates
  realtimeEvents?: string[]; // Socket.io events to listen for
  refreshInterval?: number; // Auto-refresh interval in milliseconds

  // Data fetching
  dataFetchers: string[]; // Array of analytics store method names to call

  // Calculated fields (for derived metrics)
  calculations?: Record<string, (data: any) => any>;
}

// ============================================================================
// Dashboard Data Structure (What gets passed to components)
// ============================================================================

export interface DashboardData {
  // Raw data from analytics API
  metrics?: any;
  trends?: any[];
  salesTrends?: any[];
  conversionFunnel?: any[];
  repPerformance?: any[];
  agentPerformance?: any[];
  customerInsights?: any;
  productPerformance?: any[];
  areaDistribution?: any[];
  pendingOrders?: any[];
  recentActivity?: any[];

  // Filtered/calculated data
  myPerformance?: any;
  myTrends?: any[];
  myOrders?: any[];

  // Calculated fields
  calculated?: {
    cancellationRate?: number;
    [key: string]: any;
  };

  // Additional data sources
  [key: string]: any;
}

// ============================================================================
// Dashboard Registry (Map of role to config)
// ============================================================================

export type DashboardRegistry = Record<string, DashboardConfig>;

// ============================================================================
// Helper Types for Components
// ============================================================================

export interface WidgetProps<T = any> {
  config: WidgetConfig;
  data: T;
  loading?: boolean;
  error?: Error | null;
}

export interface TrendData {
  direction: 'up' | 'down' | 'neutral';
  percentage: number;
  isPositive: boolean; // Considers inverted trends
}

export interface FormattedValue {
  raw: number | string;
  formatted: string;
  prefix?: string;
  suffix?: string;
}
