import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ExpenseCategory } from '../../../services/financial.service';

interface ExpenseBreakdownChartProps {
  data: ExpenseCategory[];
  height?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  COGS: '#f59e0b',
  'Delivery Fees': '#06b6d4',
  'Delivery': '#06b6d4',
  Marketing: '#ec4899',
  Operations: '#6366f1',
  Salaries: '#8b5cf6',
  Utilities: '#10b981',
  Other: '#6b7280'
};

const getColorForCategory = (category: string): string => {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
};

export const ExpenseBreakdownChart: React.FC<ExpenseBreakdownChartProps> = ({
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

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No expense data available
      </div>
    );
  }

  const chartData = data.map((item) => ({
    name: item.category,
    value: item.totalAmount,
    count: item.count
  }));

  const totalExpenses = data.reduce((sum, item) => sum + item.totalAmount, 0);

  const renderLabel = (entry: any) => {
    const percentage = ((entry.value / totalExpenses) * 100).toFixed(1);
    return `${entry.name} (${percentage}%)`;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={true}
          label={renderLabel}
          outerRadius={100}
          fill="#8884d8"
          dataKey="value"
        >
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getColorForCategory(entry.name)} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string, props: any) => [
            `${formatCurrency(value)} (${props.payload.count} items)`,
            name
          ]}
          contentStyle={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px'
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          wrapperStyle={{ fontSize: '12px' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};
