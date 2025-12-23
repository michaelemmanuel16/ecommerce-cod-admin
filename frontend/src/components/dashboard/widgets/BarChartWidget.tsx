/**
 * Bar Chart Widget
 * Displays vertical or horizontal bar charts
 */

import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChartConfig, WidgetProps } from '../../../config/types/dashboard';
import { formatTooltipValue } from '../../../utils/dashboard/formatters';

interface BarChartWidgetProps extends WidgetProps {
  config: BarChartConfig;
}

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B'];

export const BarChartWidget: React.FC<BarChartWidgetProps> = ({
  config,
  data,
  loading = false,
}) => {
  // Sort and limit data if maxBars is set
  const chartData = useMemo(() => {
    if (!Array.isArray(data)) return [];

    let processedData = [...data];

    // Limit to maxBars if specified
    if (config.config.maxBars) {
      processedData = processedData.slice(0, config.config.maxBars);
    }

    return processedData;
  }, [data, config.config.maxBars]);

  const colors = config.config.colors || DEFAULT_COLORS;
  const yAxisKeys = Array.isArray(config.config.yAxis)
    ? config.config.yAxis
    : [config.config.yAxis];

  // Handle empty state
  if (!loading && chartData.length === 0) {
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

  const isHorizontal = config.config.orientation === 'horizontal';

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
          <BarChart
            data={chartData}
            layout={isHorizontal ? 'vertical' : 'horizontal'}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#E5E7EB"
              horizontal={!isHorizontal}
            />

            {isHorizontal ? (
              <>
                <XAxis
                  type="number"
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  tickFormatter={(value) => formatTooltipValue(value, config.config.format)}
                />
                <YAxis
                  type="category"
                  dataKey={config.config.xAxis}
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  width={120}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey={config.config.xAxis}
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#6B7280' }}
                  tickFormatter={(value) => formatTooltipValue(value, config.config.format)}
                />
              </>
            )}

            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
              formatter={(value: any) => formatTooltipValue(value, config.config.format)}
            />

            {yAxisKeys.length > 1 && (
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }}
              />
            )}

            {/* Render bars for each Y axis */}
            {yAxisKeys.map((yKey, index) => (
              <Bar
                key={yKey}
                dataKey={yKey}
                fill={colors[index % colors.length]}
                radius={isHorizontal ? [0, 8, 8, 0] : [8, 8, 0, 0]}
                stackId={config.config.stacked ? 'stack' : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};
