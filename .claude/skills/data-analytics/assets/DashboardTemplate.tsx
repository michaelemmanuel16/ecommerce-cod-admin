import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';

/**
 * Dashboard Template
 * ------------------
 * Reusable template for creating analytics dashboards.
 *
 * Features:
 * - Responsive grid layout
 * - Loading states with skeletons
 * - Error handling
 * - Metric cards with icons and trends
 * - Chart containers
 *
 * Usage:
 * 1. Copy this template to your pages directory
 * 2. Replace DashboardTemplate with your dashboard name
 * 3. Update the metrics and charts with your data
 * 4. Customize the layout and styling as needed
 */

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'stable';
  };
  subtitle?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, icon, trend, subtitle }) => {
  const getTrendColor = () => {
    if (!trend) return 'text-gray-600';
    return trend.direction === 'up' ? 'text-green-600' : trend.direction === 'down' ? 'text-red-600' : 'text-gray-600';
  };

  const getTrendIcon = () => {
    if (!trend) return null;
    return trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
            {trend && (
              <p className={`text-sm mt-2 ${getTrendColor()}`}>
                <span className="font-semibold">{getTrendIcon()} {Math.abs(trend.value)}%</span>
                {subtitle && <span className="text-gray-500 ml-1">{subtitle}</span>}
              </p>
            )}
          </div>
          <div className="text-blue-500 text-4xl">{icon}</div>
        </div>
      </div>
    </Card>
  );
};

interface DashboardTemplateProps {
  // Add your props here
}

export const DashboardTemplate: React.FC<DashboardTemplateProps> = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // TODO: Replace with your data fetching logic
      // Example:
      // const response = await analyticsService.getDashboardData();
      // setData(response);

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      setData({
        metrics: {
          total: 1234,
          growth: 12.5,
          average: 567,
          trend: 'up'
        },
        chartData: [
          { date: '2024-01', value: 100 },
          { date: '2024-02', value: 150 },
          { date: '2024-03', value: 200 }
        ]
      });
    } catch (err) {
      setError('Failed to load dashboard data');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={loadData}
            className="mt-2 text-sm text-red-600 hover:text-red-700 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        {/* Header Skeleton */}
        <div className="mb-6">
          <div className="h-8 bg-gray-200 rounded w-64 animate-pulse"></div>
          <div className="h-4 bg-gray-200 rounded w-96 mt-2 animate-pulse"></div>
        </div>

        {/* Metrics Grid Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <div className="p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-24 mb-3"></div>
                <div className="h-8 bg-gray-200 rounded w-32 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-20"></div>
              </div>
            </Card>
          ))}
        </div>

        {/* Chart Skeleton */}
        <Card>
          <div className="p-6">
            <div className="h-6 bg-gray-200 rounded w-48 mb-4 animate-pulse"></div>
            <div className="h-64 bg-gray-200 rounded animate-pulse"></div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard Title</h1>
        <p className="text-gray-600 mt-1">Dashboard description and key insights</p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <MetricCard
          title="Total Orders"
          value={data?.metrics?.total || 0}
          icon={<span>📦</span>}
          trend={{
            value: data?.metrics?.growth || 0,
            direction: data?.metrics?.trend || 'stable'
          }}
          subtitle="vs last period"
        />

        <MetricCard
          title="Average Value"
          value={`$${data?.metrics?.average || 0}`}
          icon={<span>💰</span>}
        />

        {/* Add more metric cards as needed */}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Chart 1 */}
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Chart Title 1</h3>
            <div className="h-64 flex items-center justify-center text-gray-400">
              {/* TODO: Add your chart component here */}
              {/* Example: <LineChart data={data.chartData} /> */}
              <p>Chart placeholder - Replace with your Recharts component</p>
            </div>
          </div>
        </Card>

        {/* Chart 2 */}
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Chart Title 2</h3>
            <div className="h-64 flex items-center justify-center text-gray-400">
              {/* TODO: Add your chart component here */}
              <p>Chart placeholder - Replace with your Recharts component</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Full Width Chart */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Full Width Chart</h3>
            <div className="flex gap-2">
              {/* TODO: Add filter buttons or date range picker */}
              <button className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
                Last 7 Days
              </button>
              <button className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                Last 30 Days
              </button>
            </div>
          </div>
          <div className="h-80 flex items-center justify-center text-gray-400">
            {/* TODO: Add your chart component here */}
            <p>Large chart placeholder - Replace with your Recharts component</p>
          </div>
        </div>
      </Card>

      {/* Data Table Section (Optional) */}
      <Card className="mt-6">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Detailed Data</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Column 1
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Column 2
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Column 3
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {/* TODO: Map your data here */}
                <tr>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">Data 1</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">Data 2</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">Data 3</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default DashboardTemplate;
