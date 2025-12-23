/**
 * Donut Chart Widget
 * Displays proportional data in a donut/pie chart
 */

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { DonutChartConfig, WidgetProps } from '../../../config/types/dashboard';
import { ORDER_STATUS_CONFIG } from '../../../utils/constants';
import { OrderStatus } from '../../../types';

interface DonutChartWidgetProps extends WidgetProps {
  config: DonutChartConfig;
}

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

// Status color mapping (matching Orders page status badge colors exactly)
const STATUS_COLORS: Record<OrderStatus, string> = {
  pending_confirmation: '#EAB308', // yellow-500
  confirmed: '#3B82F6', // blue-500
  preparing: '#A855F7', // purple-500
  ready_for_pickup: '#06B6D4', // cyan-500
  out_for_delivery: '#6366F1', // indigo-500
  delivered: '#22C55E', // green-500
  cancelled: '#EF4444', // red-500
  returned: '#F97316', // orange-500
  failed_delivery: '#DC2626', // red-600
};

export const DonutChartWidget: React.FC<DonutChartWidgetProps> = ({
  config,
  data,
  loading = false,
}) => {
  // Prepare chart data with proper labels and colors
  let chartData = Array.isArray(data) ? data : [];

  // Transform status labels if data uses order statuses
  chartData = chartData.map((item: any) => {
    const statusKey = item[config.config.nameKey] as string;
    // Check if this is an order status
    if (statusKey && ORDER_STATUS_CONFIG[statusKey as OrderStatus]) {
      return {
        ...item,
        [config.config.nameKey]: ORDER_STATUS_CONFIG[statusKey as OrderStatus].label,
        _originalStatus: statusKey, // Keep original for color mapping
      };
    }
    return item;
  });

  // Generate colors based on status or use defaults
  const colors = chartData.map((item: any, index: number) => {
    if (item._originalStatus && STATUS_COLORS[item._originalStatus as OrderStatus]) {
      return STATUS_COLORS[item._originalStatus as OrderStatus];
    }
    return config.config.colors?.[index] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  });

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
              d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
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
          <PieChart>
            <Pie
              data={chartData}
              dataKey={config.config.valueKey}
              nameKey={config.config.nameKey}
              cx="50%"
              cy="50%"
              innerRadius={config.config.innerRadius || 0}
              outerRadius="80%"
              paddingAngle={2}
              label={config.config.showLabels !== false}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>

            <Tooltip
              contentStyle={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
            />

            {config.config.showLegend !== false && (
              <Legend
                verticalAlign="bottom"
                height={36}
                wrapperStyle={{ fontSize: '12px' }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};
