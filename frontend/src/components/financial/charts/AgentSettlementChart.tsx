import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { AgentCashHolding } from '../../../services/financial.service';

interface AgentSettlementChartProps {
  data: AgentCashHolding[];
  height?: number;
}

export const AgentSettlementChart: React.FC<AgentSettlementChartProps> = ({
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
        No agent settlement data available
      </div>
    );
  }

  const chartData = data
    .slice(0, 10) // Top 10 agents
    .map((holding) => ({
      name: `${holding.agent.firstName} ${holding.agent.lastName}`,
      amount: holding.totalCollected,
      orders: holding.orderCount
    }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={chartData}
        layout="horizontal"
        margin={{ top: 10, right: 30, left: 100, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          type="number"
          tickFormatter={formatCurrency}
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
        />
        <YAxis
          type="category"
          dataKey="name"
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
          width={90}
        />
        <Tooltip
          formatter={(value: number, name: string, props: any) => {
            if (name === 'amount') {
              return [formatCurrency(value), 'Cash Held'];
            }
            return [value, 'Orders'];
          }}
          labelFormatter={(label) => `Agent: ${label}`}
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
          dataKey="amount"
          fill="#3b82f6"
          name="Cash Held"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};
