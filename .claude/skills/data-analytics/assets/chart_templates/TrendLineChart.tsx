import React from 'react';
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

/**
 * Trend Line Chart Template
 * --------------------------
 * Reusable line chart component for showing trends over time.
 *
 * Features:
 * - Multiple lines support
 * - Custom colors
 * - Formatted tooltips
 * - Responsive design
 *
 * Usage:
 * <TrendLineChart
 *   data={salesData}
 *   xDataKey="date"
 *   lines={[
 *     { dataKey: 'sales', color: '#3b82f6', name: 'Sales' },
 *     { dataKey: 'orders', color: '#10b981', name: 'Orders' }
 *   ]}
 * />
 */

interface LineConfig {
  dataKey: string;
  color: string;
  name: string;
}

interface TrendLineChartProps {
  data: any[];
  xDataKey: string;
  lines: LineConfig[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  formatYAxis?: (value: any) => string;
  formatTooltip?: (value: any) => string;
}

export const TrendLineChart: React.FC<TrendLineChartProps> = ({
  data,
  xDataKey,
  lines,
  height = 300,
  showGrid = true,
  showLegend = true,
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
      <LineChart data={data}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />}
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
        <Tooltip content={<CustomTooltip />} />
        {showLegend && <Legend iconType="line" wrapperStyle={{ paddingTop: '10px' }} />}
        {lines.map((line, index) => (
          <Line
            key={index}
            type="monotone"
            dataKey={line.dataKey}
            stroke={line.color}
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
            name={line.name}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
};

export default TrendLineChart;
