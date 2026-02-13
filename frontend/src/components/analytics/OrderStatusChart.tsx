import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card } from '../ui/Card';
import { ConversionFunnelStep } from '../../services/analytics.service';

interface OrderStatusChartProps {
  data: ConversionFunnelStep[];
  title?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending_confirmation: '#f59e0b',
  confirmed: '#3b82f6',
  preparing: '#8b5cf6',
  ready_for_pickup: '#06b6d4',
  out_for_delivery: '#f97316',
  delivered: '#10b981',
  cancelled: '#ef4444',
  returned: '#ec4899',
  failed_delivery: '#dc2626',
};

const STATUS_LABELS: Record<string, string> = {
  pending_confirmation: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready_for_pickup: 'Ready',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
  failed_delivery: 'Failed',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
      <p className="text-sm font-medium text-gray-900">{STATUS_LABELS[name] || name}</p>
      <p className="text-sm text-gray-600">{value} orders</p>
    </div>
  );
};

export const OrderStatusChart: React.FC<OrderStatusChartProps> = ({
  data,
  title = 'Order Status Distribution',
}) => {
  const chartData = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      name: d.status,
      value: d.count,
    }));

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        {chartData.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={110}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={STATUS_COLORS[entry.name] || '#6b7280'}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value: string) => (
                  <span className="text-xs text-gray-600">
                    {STATUS_LABELS[value] || value}
                  </span>
                )}
              />
              <text
                x="50%"
                y="47%"
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-2xl font-bold"
                fill="#111827"
              >
                {total}
              </text>
              <text
                x="50%"
                y="55%"
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-xs"
                fill="#6b7280"
              >
                Total
              </text>
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};
