import React from 'react';
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

/**
 * Comparison Bar Chart Template
 * ------------------------------
 * Reusable bar chart component for comparing categories.
 *
 * Features:
 * - Single or grouped bars
 * - Stacked bars option
 * - Custom colors
 * - Formatted tooltips
 *
 * Usage:
 * <ComparisonBarChart
 *   data={repData}
 *   xDataKey="name"
 *   bars={[
 *     { dataKey: 'revenue', color: '#3b82f6', name: 'Revenue' },
 *     { dataKey: 'commission', color: '#10b981', name: 'Commission' }
 *   ]}
 * />
 */

interface BarConfig {
  dataKey: string;
  color: string;
  name: string;
}

interface ComparisonBarChartProps {
  data: any[];
  xDataKey: string;
  bars: BarConfig[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  stacked?: boolean;
  horizontal?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  formatYAxis?: (value: any) => string;
  formatTooltip?: (value: any) => string;
}

export const ComparisonBarChart: React.FC<ComparisonBarChartProps> = ({
  data,
  xDataKey,
  bars,
  height = 300,
  showGrid = true,
  showLegend = true,
  stacked = false,
  horizontal = false,
  xAxisLabel,
  yAxisLabel,
  formatYAxis,
  formatTooltip
}) => {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {formatTooltip ? formatTooltip(entry.value) : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}
        {horizontal ? (
          <>
            <XAxis
              type="number"
              tickFormatter={formatYAxis}
              tick={{ fill: '#6b7280', fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey={xDataKey}
              tick={{ fill: '#6b7280', fontSize: 12 }}
              width={100}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={xDataKey}
              label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined}
              tick={{ fill: '#6b7280', fontSize: 12 }}
            />
            <YAxis
              tickFormatter={formatYAxis}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined}
              tick={{ fill: '#6b7280', fontSize: 12 }}
            />
          </>
        )}
        <Tooltip content={<CustomTooltip />} />
        {showLegend && <Legend iconType="rect" wrapperStyle={{ paddingTop: '10px' }} />}
        {bars.map((bar, index) => (
          <Bar
            key={index}
            dataKey={bar.dataKey}
            fill={bar.color}
            name={bar.name}
            radius={[8, 8, 0, 0]}
            stackId={stacked ? 'stack' : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
};

export default ComparisonBarChart;
