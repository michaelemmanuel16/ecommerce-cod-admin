import React, { useMemo } from 'react';
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
import { CODCollection } from '../../../services/financial.service';
import { formatCurrency } from '../../../utils/format';

interface CollectionsTimelineChartProps {
  collections: CODCollection[];
  height?: number;
}

const STATUS_COLORS = {
  pending: '#fbbf24',
  collected: '#3b82f6',
  deposited: '#10b981',
  reconciled: '#8b5cf6'
};

export const CollectionsTimelineChart: React.FC<CollectionsTimelineChartProps> = ({
  collections,
  height = 300
}) => {
  const chartData = useMemo(() => {
    if (!collections || collections.length === 0) return [];

    // Group collections by date and status
    const groupedData: Record<string, Record<string, number>> = {};

    collections.forEach((collection) => {
      const date = new Date(collection.createdAt).toISOString().split('T')[0];

      if (!groupedData[date]) {
        groupedData[date] = {
          pending: 0,
          collected: 0,
          deposited: 0,
          reconciled: 0
        };
      }

      groupedData[date][collection.status] =
        (groupedData[date][collection.status] || 0) + collection.amount;
    });

    // Convert to array and sort by date
    return Object.entries(groupedData)
      .map(([date, statuses]) => ({
        date,
        ...statuses
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-30); // Last 30 days
  }, [collections]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No collection data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          stroke="#6b7280"
          style={{ fontSize: '12px' }}
        />
        <YAxis
          tickFormatter={(value) => formatCurrency(value)}
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
          iconType="rect"
        />
        <Bar dataKey="pending" stackId="a" fill={STATUS_COLORS.pending} name="Pending" />
        <Bar dataKey="collected" stackId="a" fill={STATUS_COLORS.collected} name="Collected" />
        <Bar dataKey="deposited" stackId="a" fill={STATUS_COLORS.deposited} name="Deposited" />
        <Bar dataKey="reconciled" stackId="a" fill={STATUS_COLORS.reconciled} name="Reconciled" />
      </BarChart>
    </ResponsiveContainer>
  );
};
