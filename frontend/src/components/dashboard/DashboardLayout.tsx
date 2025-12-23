/**
 * Dashboard Layout Component
 * Renders dashboard from configuration
 */

import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { DashboardConfig, DashboardData } from '../../config/types/dashboard';
import { WidgetRenderer } from './WidgetRenderer';
import { DateRangePicker } from '../ui/DateRangePicker';
import { DateRangeFilter } from '../../pages/DynamicDashboard';

interface DashboardLayoutProps {
  config: DashboardConfig;
  data: DashboardData;
  loading?: boolean;
  error?: Error | null;
  dateRange?: DateRangeFilter;
  onDateRangeChange?: (range: DateRangeFilter) => void;
  onRefresh?: () => void;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  config,
  data,
  loading = false,
  error = null,
  dateRange,
  onDateRangeChange,
  onRefresh,
}) => {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (onRefresh) {
      setRefreshing(true);
      await onRefresh();
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{config.title}</h1>
          {config.description && (
            <p className="text-sm text-gray-500 mt-1">{config.description}</p>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Date Range Picker */}
          {onDateRangeChange && (
            <div style={{ position: 'relative' }}>
              <style>{`
                .dashboard-date-picker .date-range-popover {
                  left: auto;
                  right: 0;
                  transform: none;
                }
              `}</style>
              <div className="dashboard-date-picker">
                <DateRangePicker
                  startDate={dateRange?.startDate}
                  endDate={dateRange?.endDate}
                  onChange={(start, end) => {
                    console.log('[DashboardLayout] Date range onChange called:', { start, end });
                    if (start && end) {
                      console.log('[DashboardLayout] Setting custom date range:', { startDate: start, endDate: end });
                      // User selected custom date range
                      onDateRangeChange({
                        startDate: start,
                        endDate: end,
                      });
                    } else {
                      console.log('[DashboardLayout] Clearing date range, resetting to preset');
                      // User cleared the date range - reset to default preset
                      onDateRangeChange({
                        preset: config.defaultDateRange || 'last-30-days',
                      });
                    }
                  }}
                  placeholder="Filter by date range"
                />
              </div>
            </div>
          )}

          {/* Refresh Button */}
          {onRefresh && (
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh dashboard"
            >
              <RefreshCw
                className={`w-5 h-5 text-gray-600 ${refreshing ? 'animate-spin' : ''}`}
              />
            </button>
          )}

          {/* Live Indicator (when real-time is enabled) */}
          {config.realtimeEvents && config.realtimeEvents.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 bg-green-50 rounded-full">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              <span className="text-xs font-medium text-green-700">Live</span>
            </div>
          )}
        </div>
      </div>

      {/* Global Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm">
            <strong>Error loading dashboard:</strong> {error.message}
          </p>
        </div>
      )}

      {/* Stat Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {config.statCards.map((cardConfig) => (
          <WidgetRenderer
            key={cardConfig.id}
            config={cardConfig}
            data={data}
            loading={loading}
            error={error}
            dataFilters={config.dataFilters}
          />
        ))}
      </div>

      {/* Charts Grid - Grouped by Row */}
      {renderChartsByRow(config.charts, data, loading, error, config.dataFilters)}

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-5 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-sm text-gray-700">Loading dashboard...</span>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Helper to get grid classes from grid position config
 */
function getGridClasses(position: any): string {
  const { colSpan = 1 } = position;

  // Map colSpan to Tailwind classes
  const spanClasses: Record<number, string> = {
    1: 'col-span-1',
    2: 'col-span-2',
    3: 'col-span-3',
  };

  return spanClasses[colSpan] || 'col-span-1';
}

/**
 * Render charts grouped by row
 */
function renderChartsByRow(
  charts: any[],
  data: DashboardData,
  loading: boolean,
  error: Error | null,
  dataFilters?: any
) {
  // Group charts by row
  const chartsByRow: Record<number, any[]> = {};

  charts.forEach((chart) => {
    const row = chart.gridPosition?.row || 1;
    if (!chartsByRow[row]) {
      chartsByRow[row] = [];
    }
    chartsByRow[row].push(chart);
  });

  // Sort rows
  const sortedRows = Object.keys(chartsByRow)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <>
      {sortedRows.map((rowNum) => {
        const rowCharts = chartsByRow[rowNum];

        // Calculate total colSpan for this row
        const totalColSpan = rowCharts.reduce(
          (sum, chart) => sum + (chart.gridPosition?.colSpan || 1),
          0
        );

        // Map totalColSpan to actual Tailwind classes
        const gridColsClass = {
          1: 'lg:grid-cols-1',
          2: 'lg:grid-cols-2',
          3: 'lg:grid-cols-3',
          4: 'lg:grid-cols-4',
        }[totalColSpan] || 'lg:grid-cols-2';

        return (
          <div
            key={`row-${rowNum}`}
            className={`grid grid-cols-1 ${gridColsClass} gap-6`}
          >
            {rowCharts.map((chartConfig) => {
              const gridClasses = getGridClasses(chartConfig.gridPosition);

              return (
                <div key={chartConfig.id} className={gridClasses}>
                  <WidgetRenderer
                    config={chartConfig}
                    data={data}
                    loading={loading}
                    error={error}
                    dataFilters={dataFilters}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
