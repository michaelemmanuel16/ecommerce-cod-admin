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
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{config.title}</h1>
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
                @media (max-width: 768px) {
                  .dashboard-date-picker .date-range-popover {
                    position: fixed;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    top: auto;
                    max-height: 85vh;
                    border-radius: 1rem 1rem 0 0;
                    flex-direction: column;
                    overflow-y: auto;
                  }
                  .dashboard-date-picker .date-range-presets {
                    width: 100%;
                    border-right: none;
                    border-bottom: 1px solid #e5e7eb;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.25rem;
                    padding: 0.75rem;
                    position: sticky;
                    top: 0;
                    background: white;
                    z-index: 1;
                  }
                  .dashboard-date-picker .date-range-preset-btn {
                    width: auto;
                    padding: 0.375rem 0.75rem;
                    font-size: 0.75rem;
                    border: 1px solid #e5e7eb;
                    border-radius: 999px;
                  }
                  .dashboard-date-picker .date-range-preset-btn.active {
                    border-color: #2563eb;
                  }
                  .dashboard-date-picker .calendars-row {
                    flex-direction: column;
                    gap: 0;
                    align-items: center;
                  }
                  .dashboard-date-picker .calendar-grid-container {
                    width: auto;
                  }
                  .dashboard-date-picker .date-range-calendars {
                    padding: 0.5rem;
                  }
                  .dashboard-date-picker .date-range-actions {
                    position: sticky;
                    bottom: 0;
                    background: white;
                    padding: 0.75rem;
                    margin-top: 0;
                    border-top: 1px solid #e5e7eb;
                  }
                  .dashboard-date-picker .date-range-backdrop {
                    background: rgba(0,0,0,0.4);
                  }
                }
              `}</style>
              <div className="dashboard-date-picker">
                <DateRangePicker
                  startDate={dateRange?.startDate}
                  endDate={dateRange?.endDate}
                  onChange={(start, end) => {
                    if (start && end) {
                      onDateRangeChange({
                        startDate: start,
                        endDate: end,
                      });
                    } else {
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
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
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
  // Handle undefined/null position with default values
  const { colSpan = 1 } = position || {};

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
