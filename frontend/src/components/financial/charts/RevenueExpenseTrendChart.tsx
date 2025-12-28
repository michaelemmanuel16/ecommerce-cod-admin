import React from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { FinancialReport } from '../../../services/financial.service';

interface RevenueExpenseTrendChartProps {
  data: FinancialReport[];
  height?: number;
}

const CHART_COLORS = {
  revenue: '#10b981',
  expenses: '#ef4444',
  profit: '#3b82f6'
};

export const RevenueExpenseTrendChart: React.FC<RevenueExpenseTrendChartProps> = ({
  data,
  height = 300
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
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.revenue} stopOpacity={0.8} />
            <stop offset="95%" stopColor={CHART_COLORS.revenue} stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.expenses} stopOpacity={0.8} />
            <stop offset="95%" stopColor={CHART_COLORS.expenses} stopOpacity={0.1} />
          </linearGradient>
        </defs>
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
          labelFormatter={(label) => `Date: ${formatDate(label)}`}
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: '14px' }}
          iconType="circle"
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke={CHART_COLORS.revenue}
          fillOpacity={1}
          fill="url(#colorRevenue)"
          name="Revenue"
        />
        <Area
          type="monotone"
          dataKey="expenses"
          stroke={CHART_COLORS.expenses}
          fillOpacity={1}
          fill="url(#colorExpenses)"
          name="Expenses"
        />
        <Line
          type="monotone"
          dataKey="profit"
          stroke={CHART_COLORS.profit}
          strokeWidth={2}
          dot={{ fill: CHART_COLORS.profit, r: 4 }}
          name="Profit"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};
