import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface SalesTrendChartProps {
  data: { date: string; assigned: number; delivered: number }[];
}

export const SalesTrendChart: React.FC<SalesTrendChartProps> = ({ data }) => {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          name="Assigned Orders"
          dataKey="assigned"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          type="monotone"
          name="Delivered Orders"
          dataKey="delivered"
          stroke="#10b981"
          strokeWidth={2}
          dot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
