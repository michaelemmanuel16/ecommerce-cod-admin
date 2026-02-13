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
import { AreaDistribution } from '../../services/analytics.service';
import { formatCurrency } from '../../utils/format';

interface AreaDistributionChartProps {
  data: AreaDistribution[];
  title?: string;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
      <p className="text-sm font-medium text-gray-900">{item.area}</p>
      <p className="text-sm text-gray-600">Revenue: {formatCurrency(item.revenue)}</p>
      <p className="text-sm text-gray-600">Orders: {item.orderCount}</p>
    </div>
  );
};

export const AreaDistributionChart: React.FC<AreaDistributionChartProps> = ({
  data,
  title = 'Revenue by Delivery Area',
}) => {
  const chartData = data.map((d) => ({
    area: d.area || 'Unknown',
    revenue: d.revenue,
    orderCount: d.orderCount,
  }));

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        {chartData.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="area"
                tick={{ fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
};
