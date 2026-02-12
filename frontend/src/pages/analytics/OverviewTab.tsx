import React, { useEffect } from 'react';
import { ShoppingCart, DollarSign, Target, TrendingUp } from 'lucide-react';
import { useAnalyticsStore } from '../../stores/analyticsStore';
import { MetricCard } from '../../components/analytics/MetricCard';
import { RevenueChart } from '../../components/analytics/RevenueChart';
import { OrderStatusChart } from '../../components/analytics/OrderStatusChart';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/format';

interface OverviewTabProps {
  startDate?: string;
  endDate?: string;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ startDate, endDate }) => {
  const {
    metrics,
    trends,
    ordersByStatus,
    repPerformance,
    agentPerformance,
    fetchDashboardMetrics,
    fetchSalesTrends,
    fetchOrdersByStatus,
    fetchRepPerformance,
    fetchAgentPerformance,
  } = useAnalyticsStore();

  useEffect(() => {
    fetchDashboardMetrics(startDate, endDate);
    fetchSalesTrends('daily', undefined, startDate, endDate);
    fetchOrdersByStatus(startDate, endDate);
    fetchRepPerformance(startDate, endDate);
    fetchAgentPerformance(startDate, endDate);
  }, [startDate, endDate, fetchDashboardMetrics, fetchSalesTrends, fetchOrdersByStatus, fetchRepPerformance, fetchAgentPerformance]);

  const avgOrderValue =
    metrics && metrics.totalOrders > 0
      ? metrics.totalRevenue / metrics.totalOrders
      : 0;

  const topRep = repPerformance.length > 0
    ? [...repPerformance].sort((a, b) => b.successRate - a.successRate)[0]
    : null;

  const topAgent = agentPerformance.length > 0
    ? [...agentPerformance].sort((a, b) => b.successRate - a.successRate)[0]
    : null;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Total Orders"
            value={metrics.totalOrders}
            subtitle={`Today: ${metrics.todayOrders}`}
            icon={ShoppingCart}
            iconColor="text-blue-600"
            iconBgColor="bg-blue-100"
          />
          <MetricCard
            title="Total Revenue"
            value={formatCurrency(metrics.totalRevenue)}
            subtitle={`Today: ${formatCurrency(metrics.todayRevenue)}`}
            icon={DollarSign}
            iconColor="text-green-600"
            iconBgColor="bg-green-100"
          />
          <MetricCard
            title="Delivery Rate"
            value={`${metrics.deliveryRate.toFixed(1)}%`}
            subtitle={`${metrics.deliveredOrders} / ${metrics.totalOrders}`}
            icon={Target}
            iconColor="text-purple-600"
            iconBgColor="bg-purple-100"
          />
          <MetricCard
            title="Avg Order Value"
            value={formatCurrency(avgOrderValue)}
            subtitle={`Pending: ${metrics.pendingOrders}`}
            icon={TrendingUp}
            iconColor="text-orange-600"
            iconBgColor="bg-orange-100"
          />
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart data={trends} title="Revenue & Orders Trend" />
        </div>
        <OrderStatusChart data={ordersByStatus} />
      </div>

      {/* Top Performers */}
      {(topRep || topAgent) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {topRep && (
            <Card>
              <div className="p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Top Sales Rep</h3>
                <p className="text-lg font-bold text-gray-900">{topRep.userName}</p>
                <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Success Rate</p>
                    <p className="font-semibold text-blue-600">{topRep.successRate.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Assigned</p>
                    <p className="font-semibold text-gray-900">{topRep.totalAssigned}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Completed</p>
                    <p className="font-semibold text-green-600">{topRep.completed}</p>
                  </div>
                </div>
              </div>
            </Card>
          )}
          {topAgent && (
            <Card>
              <div className="p-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Top Delivery Agent</h3>
                <p className="text-lg font-bold text-gray-900">{topAgent.userName}</p>
                <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Success Rate</p>
                    <p className="font-semibold text-green-600">{topAgent.successRate.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Delivered</p>
                    <p className="font-semibold text-gray-900">{topAgent.completed}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Failed</p>
                    <p className="font-semibold text-red-600">{topAgent.failed || 0}</p>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
