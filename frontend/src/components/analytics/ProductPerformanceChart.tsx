import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card } from '../ui/Card';
import { ProductPerformance } from '../../services/analytics.service';
import { formatCurrency } from '../../utils/format';

interface ProductPerformanceChartProps {
  data: ProductPerformance[];
  title?: string;
  limit?: number;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
      <p className="text-sm font-medium text-gray-900">{item.name}</p>
      <p className="text-sm text-gray-600">Revenue: {formatCurrency(item.revenue)}</p>
      <p className="text-sm text-gray-600">Units Sold: {item.unitsSold}</p>
      <p className="text-sm text-gray-600">Orders: {item.orderCount}</p>
    </div>
  );
};

export const ProductPerformanceChart: React.FC<ProductPerformanceChartProps> = ({
  data,
  title = 'Top Products by Revenue',
  limit = 10,
}) => {
  const chartData = data.slice(0, limit).map((p) => ({
    name: p.productName.length > 20 ? p.productName.substring(0, 20) + '...' : p.productName,
    revenue: p.revenue,
    unitsSold: p.unitsSold,
    orderCount: p.orderCount,
  }));

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        {chartData.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 40)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 12 }}
                width={130}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};
