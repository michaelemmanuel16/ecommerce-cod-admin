import React, { useEffect } from 'react';
import {
  TrendingUp,
  ShoppingCart,
  DollarSign,
  Users,
  Clock,
  Package,
  Target,
  BarChart3
} from 'lucide-react';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { Card } from '../components/ui/Card';
import { AnalyticsMetricsSkeleton, PerformanceListSkeleton } from '../components/ui/PageSkeletons';

export const Analytics: React.FC = () => {
  const {
    metrics,
    trends,
    repPerformance,
    agentPerformance,
    isLoading,
    fetchDashboardMetrics,
    fetchSalesTrends,
    fetchRepPerformance,
    fetchAgentPerformance
  } = useAnalyticsStore();

  useEffect(() => {
    const loadAnalyticsData = async () => {
      await Promise.all([
        fetchDashboardMetrics(),
        fetchSalesTrends('daily', 7),
        fetchRepPerformance(),
        fetchAgentPerformance()
      ]);
    };
    loadAnalyticsData();
  }, [fetchDashboardMetrics, fetchSalesTrends, fetchRepPerformance, fetchAgentPerformance]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics & Insights</h1>
        <p className="text-gray-600 mt-1">Track your business performance and key metrics</p>
      </div>

      {isLoading ? (
        <>
          <AnalyticsMetricsSkeleton />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <div className="p-6">
                  <div className="animate-pulse space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                    <div className="h-8 bg-gray-200 rounded w-1/3"></div>
                    <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <Card className="mb-6">
            <div className="p-6">
              <div className="animate-pulse space-y-4">
                <div className="h-6 bg-gray-200 rounded w-48"></div>
                <div className="h-64 bg-gray-200 rounded"></div>
              </div>
            </div>
          </Card>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <div className="p-6">
                <div className="h-6 bg-gray-200 rounded w-48 mb-4 animate-pulse"></div>
                <PerformanceListSkeleton />
              </div>
            </Card>
            <Card>
              <div className="p-6">
                <div className="h-6 bg-gray-200 rounded w-48 mb-4 animate-pulse"></div>
                <PerformanceListSkeleton />
              </div>
            </Card>
          </div>
        </>
      ) : (
        <>
          {/* Key Metrics Grid */}
          {metrics && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                <Card className="hover:shadow-lg transition-shadow">
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Total Orders</p>
                        <p className="text-3xl font-bold text-gray-900 mt-2">{metrics.totalOrders}</p>
                        <p className="text-xs text-gray-500 mt-1">Today: {metrics.todayOrders}</p>
                      </div>
                      <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <ShoppingCart className="w-6 h-6 text-blue-600" />
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="hover:shadow-lg transition-shadow">
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                        <p className="text-3xl font-bold text-gray-900 mt-2">
                          {formatCurrency(metrics.totalRevenue)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Today: {formatCurrency(metrics.todayRevenue)}
                        </p>
                      </div>
                      <div className="h-12 w-12 bg-green-100 rounded-full flex items-center justify-center">
                        <DollarSign className="w-6 h-6 text-green-600" />
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="hover:shadow-lg transition-shadow">
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Delivery Rate</p>
                        <p className="text-3xl font-bold text-gray-900 mt-2">
                          {metrics.deliveryRate.toFixed(1)}%
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {metrics.deliveredOrders} / {metrics.totalOrders}
                        </p>
                      </div>
                      <div className="h-12 w-12 bg-purple-100 rounded-full flex items-center justify-center">
                        <Target className="w-6 h-6 text-purple-600" />
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="hover:shadow-lg transition-shadow">
                  <div className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Active Agents</p>
                        <p className="text-3xl font-bold text-gray-900 mt-2">{metrics.activeAgents}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Avg Time: {metrics.avgDeliveryTime}h
                        </p>
                      </div>
                      <div className="h-12 w-12 bg-orange-100 rounded-full flex items-center justify-center">
                        <Users className="w-6 h-6 text-orange-600" />
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Secondary Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <Card>
                  <div className="p-6">
                    <div className="flex items-center mb-3">
                      <Package className="w-5 h-5 text-yellow-600 mr-2" />
                      <h3 className="font-semibold text-gray-900">Pending Orders</h3>
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{metrics.pendingOrders}</p>
                    <p className="text-xs text-gray-500 mt-1">Awaiting processing</p>
                  </div>
                </Card>

                <Card>
                  <div className="p-6">
                    <div className="flex items-center mb-3">
                      <TrendingUp className="w-5 h-5 text-green-600 mr-2" />
                      <h3 className="font-semibold text-gray-900">Delivered</h3>
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{metrics.deliveredOrders}</p>
                    <p className="text-xs text-gray-500 mt-1">Successfully completed</p>
                  </div>
                </Card>

                <Card>
                  <div className="p-6">
                    <div className="flex items-center mb-3">
                      <Clock className="w-5 h-5 text-blue-600 mr-2" />
                      <h3 className="font-semibold text-gray-900">Avg Delivery Time</h3>
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{metrics.avgDeliveryTime}h</p>
                    <p className="text-xs text-gray-500 mt-1">From order to delivery</p>
                  </div>
                </Card>
              </div>
            </>
          )}

          {/* Sales Trends */}
          {trends.length > 0 && (
            <Card className="mb-6">
              <div className="p-6">
                <div className="flex items-center mb-6">
                  <BarChart3 className="w-5 h-5 text-blue-600 mr-2" />
                  <h3 className="text-lg font-semibold text-gray-900">Sales Trends (Last 7 Days)</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Orders</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delivered</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Conversion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {trends.map((trend) => (
                        <tr key={trend.date} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {new Date(trend.date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900">{trend.orders}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{trend.delivered}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                            {formatCurrency(trend.revenue)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              trend.conversionRate >= 70
                                ? 'bg-green-100 text-green-800'
                                : trend.conversionRate >= 50
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {trend.conversionRate.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          )}

          {/* Performance Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Rep Performance */}
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Customer Rep Performance</h3>
                {repPerformance.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No data available</p>
                ) : (
                  <div className="space-y-3">
                    {repPerformance.slice(0, 5).map((rep) => (
                      <div key={rep.userId} className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-gray-900">{rep.userName}</h4>
                          <span className="text-sm font-semibold text-blue-600">
                            {rep.successRate.toFixed(1)}%
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-gray-500">Assigned</p>
                            <p className="font-semibold text-gray-900">{rep.totalAssigned}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Completed</p>
                            <p className="font-semibold text-green-600">{rep.completed}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Pending</p>
                            <p className="font-semibold text-yellow-600">{rep.pending}</p>
                          </div>
                        </div>
                        {rep.revenue !== undefined && (
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <p className="text-xs text-gray-500">Revenue Generated</p>
                            <p className="text-sm font-semibold text-gray-900">{formatCurrency(rep.revenue)}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Agent Performance */}
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Delivery Agent Performance</h3>
                {agentPerformance.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No data available</p>
                ) : (
                  <div className="space-y-3">
                    {agentPerformance.slice(0, 5).map((agent) => (
                      <div key={agent.userId} className="p-4 border border-gray-200 rounded-lg hover:border-green-300 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-gray-900">{agent.userName}</h4>
                          <span className="text-sm font-semibold text-green-600">
                            {agent.successRate.toFixed(1)}%
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-gray-500">Assigned</p>
                            <p className="font-semibold text-gray-900">{agent.totalAssigned}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Delivered</p>
                            <p className="font-semibold text-green-600">{agent.completed}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Failed</p>
                            <p className="font-semibold text-red-600">{agent.failed || 0}</p>
                          </div>
                        </div>
                        {agent.onTimeRate !== undefined && (
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <p className="text-xs text-gray-500">On-Time Delivery</p>
                            <p className="text-sm font-semibold text-gray-900">{agent.onTimeRate.toFixed(1)}%</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
