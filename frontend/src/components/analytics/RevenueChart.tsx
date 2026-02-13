import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card } from '../ui/Card';
import { SalesTrend } from '../../services/analytics.service';
import { formatCurrency } from '../../utils/format';

interface RevenueChartProps {
  data: SalesTrend[];
  title?: string;
  showOrders?: boolean;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
      <p className="text-sm font-medium text-gray-900 mb-1">
        {new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {entry.name === 'Revenue' ? formatCurrency(entry.value) : entry.value}
        </p>
      ))}
    </div>
  );
};

export const RevenueChart: React.FC<RevenueChartProps> = ({
  data,
  title = 'Revenue & Orders Trend',
  showOrders = true,
}) => {
  const chartData = data.map((d) => ({
    date: d.date,
    Revenue: d.revenue,
    Orders: d.orders,
  }));

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        {chartData.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }
              />
              <YAxis
                yAxisId="revenue"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              {showOrders && (
                <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 12 }} />
              )}
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Area
                yAxisId="revenue"
                type="monotone"
                dataKey="Revenue"
                stroke="#3b82f6"
                fill="url(#colorRevenue)"
                strokeWidth={2}
              />
              {showOrders && (
                <Area
                  yAxisId="orders"
                  type="monotone"
                  dataKey="Orders"
                  stroke="#10b981"
                  fill="url(#colorOrders)"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};
