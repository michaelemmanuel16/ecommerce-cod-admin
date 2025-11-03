import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

/**
 * Distribution Pie Chart Template
 * --------------------------------
 * Reusable pie/donut chart component for showing proportions.
 *
 * Features:
 * - Pie or donut style
 * - Custom colors
 * - Percentage labels
 * - Interactive legend
 *
 * Usage:
 * <DistributionPieChart
 *   data={statusData}
 *   nameKey="status"
 *   valueKey="count"
 *   colors={['#3b82f6', '#10b981', '#f59e0b', '#ef4444']}
 *   donut={true}
 * />
 */

const DEFAULT_COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Orange
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#f97316', // Amber
];

interface DistributionPieChartProps {
  data: any[];
  nameKey: string;
  valueKey: string;
  colors?: string[];
  height?: number;
  donut?: boolean;
  showLegend?: boolean;
  showLabels?: boolean;
  formatValue?: (value: any) => string;
}

export const DistributionPieChart: React.FC<DistributionPieChartProps> = ({
  data,
  nameKey,
  valueKey,
  colors = DEFAULT_COLORS,
  height = 300,
  donut = false,
  showLegend = true,
  showLabels = true,
  formatValue
}) => {
  // Calculate total for percentages
  const total = data.reduce((sum, item) => sum + item[valueKey], 0);

  const renderLabel = (entry: any) => {
    if (!showLabels) return '';
    const percent = ((entry[valueKey] / total) * 100).toFixed(1);
    return `${percent}%`;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const percent = ((data.value / total) * 100).toFixed(1);
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900">{data.name}</p>
          <p style={{ color: data.payload.fill }} className="text-sm mt-1">
            Value: {formatValue ? formatValue(data.value) : data.value}
          </p>
          <p className="text-sm text-gray-600">
            {percent}% of total
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomLegend = ({ payload }: any) => {
    return (
      <ul className="flex flex-wrap justify-center gap-4 mt-4">
        {payload.map((entry: any, index: number) => {
          const percent = ((entry.payload[valueKey] / total) * 100).toFixed(1);
          return (
            <li key={index} className="flex items-center gap-2 text-sm">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-gray-700">
                {entry.value}: <span className="font-semibold">{percent}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={renderLabel}
          outerRadius={donut ? 100 : 120}
          innerRadius={donut ? 60 : 0}
          fill="#8884d8"
          dataKey={valueKey}
          nameKey={nameKey}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        {showLegend && <Legend content={<CustomLegend />} />}
      </PieChart>
    </ResponsiveContainer>
  );
};

export default DistributionPieChart;
