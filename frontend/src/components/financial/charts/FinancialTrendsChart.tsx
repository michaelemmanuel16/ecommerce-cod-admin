import React from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { FinancialReport } from '../../../services/financial.service';

interface FinancialTrendsChartProps {
  data: FinancialReport[];
  height?: number;
  period?: 'daily' | 'monthly';
}

const CHART_COLORS = {
  revenue: '#10b981',
  expenses: '#ef4444',
  profit: '#3b82f6'
};

export const FinancialTrendsChart: React.FC<FinancialTrendsChartProps> = ({
  data,
  height = 350,
  period = 'daily'
}) => {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (period === 'monthly') {
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No trend data available for selected period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
        />
        <YAxis
          tickFormatter={formatCurrency}
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
        />
        <Tooltip
          formatter={(value: number) => formatCurrency(value)}
          labelFormatter={(label) => `Period: ${formatDate(label)}`}
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: '14px' }}
          iconType="rect"
        />
        <Bar
          dataKey="revenue"
          fill={CHART_COLORS.revenue}
          name="Revenue"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="expenses"
          fill={CHART_COLORS.expenses}
          name="Expenses"
          radius={[4, 4, 0, 0]}
        />
        <Line
          type="monotone"
          dataKey="profit"
          stroke={CHART_COLORS.profit}
          strokeWidth={3}
          dot={{ fill: CHART_COLORS.profit, r: 5 }}
          name="Profit"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};
