import React, { useEffect, useState } from 'react';
import { Users, DollarSign, Activity, AlertTriangle } from 'lucide-react';
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
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/common/StatCard';
import { usePlatformStore } from '../stores/platformStore';

type Period = '30d' | '90d' | '1y';

const PERIODS: { label: string; value: Period }[] = [
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: '1y', value: '1y' },
];

export const PlatformDashboard: React.FC = () => {
  const { metrics, trends, fetchMetrics, fetchTrends, isLoading } = usePlatformStore();
  const [period, setPeriod] = useState<Period>('30d');

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    fetchTrends(period);
  }, [fetchTrends, period]);

  const formatUSD = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const chartData = trends.map(t => ({
    date: t.date,
    totalTenants: t.totalTenants,
    newTenants: t.newTenants,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Platform Dashboard</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Tenants"
          value={isLoading ? '...' : (metrics?.totalTenants ?? 0)}
          icon={Users}
          iconColor="text-blue-600"
        />
        <StatCard
          title="MRR"
          value={isLoading ? '...' : formatUSD(metrics?.mrr ?? 0)}
          icon={DollarSign}
          iconColor="text-green-600"
        />
        <StatCard
          title="Active Users"
          value={isLoading ? '...' : (metrics?.activeUsers ?? 0)}
          icon={Activity}
          iconColor="text-purple-600"
        />
        <StatCard
          title="Suspended Tenants"
          value={isLoading ? '...' : (metrics?.suspendedTenants ?? 0)}
          icon={AlertTriangle}
          iconColor="text-red-600"
        />
      </div>

      {/* Trends Chart */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Tenant Growth</h3>
          <div className="flex gap-2">
            {PERIODS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setPeriod(value)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  period === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip
                formatter={(value: number, name: string) =>
                  name === 'totalTenants' ? [value, 'Total Tenants'] : [value, 'New Tenants']
                }
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="totalTenants"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                name="totalTenants"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="newTenants"
                stroke="#7c3aed"
                strokeWidth={2}
                dot={false}
                name="newTenants"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
};
