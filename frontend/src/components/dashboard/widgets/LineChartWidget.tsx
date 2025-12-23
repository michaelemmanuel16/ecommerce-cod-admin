/**
 * Line Chart Widget
 * Displays time series data with optional moving average
 */

import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { LineChartConfig, WidgetProps } from '../../../config/types/dashboard';
import { formatTooltipValue } from '../../../utils/dashboard/formatters';
import { calculateMovingAverage } from '../../../utils/dashboard/trendCalculator';

interface LineChartWidgetProps extends WidgetProps {
  config: LineChartConfig;
}

export const LineChartWidget: React.FC<LineChartWidgetProps> = ({
  config,
  data,
  loading = false,
}) => {
  // Prepare chart data with moving average if enabled
  const chartData = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [];

    let processedData = [...data];

    // Add moving average if enabled
    if (config.config.showMovingAverage && config.config.yAxis.length > 0) {
      const primaryYAxis = config.config.yAxis[0];
      const values = data.map((item) => item[primaryYAxis] || 0);
      const maValues = calculateMovingAverage(
        values,
        config.config.movingAverageWindow || 7
      );

      processedData = data.map((item, index) => ({
        ...item,
        [`${primaryYAxis}_ma`]: maValues[index],
      }));
    }

    return processedData;
  }, [data, config.config]);

  // Get colors with defaults
  const colors = config.config.colors || ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

  // Handle empty state
  if (!loading && (!data || (Array.isArray(data) && data.length === 0))) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">{config.title}</h3>
        <div
          className="flex flex-col items-center justify-center bg-gray-50 rounded-lg"
          style={{ height: config.height }}
        >
          <svg
            className="w-16 h-16 text-gray-300 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <p className="text-gray-500 text-sm">No data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <h3 className="text-lg font-semibold mb-4">{config.title}</h3>

      {loading ? (
        <div
          className="bg-gray-100 animate-pulse rounded-lg"
          style={{ height: config.height }}
        />
      ) : (
        <ResponsiveContainer width="100%" height={config.height}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />

            <XAxis
              dataKey={config.config.xAxis}
              tick={{ fontSize: 12, fill: '#6B7280' }}
              tickLine={{ stroke: '#E5E7EB' }}
            />

            <YAxis
              tick={{ fontSize: 12, fill: '#6B7280' }}
              tickLine={{ stroke: '#E5E7EB' }}
              axisLine={{ stroke: '#E5E7EB' }}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
              formatter={(value: any, name: string) => {
                // Format tooltip value based on data type
                const formattedValue = typeof value === 'number'
                  ? formatTooltipValue(value, 'number')
                  : value;
                return [formattedValue, formatLegendName(name)];
              }}
            />

            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }}
              formatter={(value) => formatLegendName(value)}
            />

            {/* Render lines for each Y axis */}
            {config.config.yAxis.map((yKey, index) => (
              <Line
                key={yKey}
                type="monotone"
                dataKey={yKey}
                stroke={colors[index % colors.length]}
                strokeWidth={config.config.strokeWidth || 2}
                dot={config.config.showDots !== false ? { r: 4 } : false}
                activeDot={{ r: 6 }}
                fill={config.config.fill ? colors[index % colors.length] : undefined}
                fillOpacity={config.config.fill ? 0.1 : undefined}
              />
            ))}

            {/* Render moving average line if enabled */}
            {config.config.showMovingAverage && config.config.yAxis.length > 0 && (
              <Line
                type="monotone"
                dataKey={`${config.config.yAxis[0]}_ma`}
                stroke={colors[0]}
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
                name={`${config.config.yAxis[0]} (${config.config.movingAverageWindow || 7}d MA)`}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

/**
 * Helper to format legend names (remove underscores, capitalize)
 */
function formatLegendName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(' Ma', ' MA'); // Fix moving average label
}
