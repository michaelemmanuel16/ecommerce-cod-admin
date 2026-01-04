import React, { useEffect } from 'react';
import { ShoppingBag, DollarSign, TrendingUp, CheckCircle } from 'lucide-react';
import { StatCard } from '../components/common/StatCard';
import { SalesTrendChart } from '../components/charts/SalesTrendChart';
import { OrderFunnelChart } from '../components/charts/OrderFunnelChart';
import { Card } from '../components/ui/Card';
import { useAnalyticsStore } from '../stores/analyticsStore';

export const Dashboard: React.FC = () => {
  const {
    metrics,
    trends,
    conversionFunnel,
    fetchDashboardMetrics,
    fetchSalesTrends,
    fetchConversionFunnel,
    isLoading
  } = useAnalyticsStore();

  useEffect(() => {
    // Fetch all dashboard data in parallel
    Promise.all([
      fetchDashboardMetrics(),
      fetchSalesTrends('daily', 7),
      fetchConversionFunnel()
    ]);
  }, [fetchDashboardMetrics, fetchSalesTrends, fetchConversionFunnel]);

  // Use server-side computed metrics
  const totalOrders = metrics?.totalOrders ?? 0;
  const totalRevenue = metrics?.totalRevenue ?? 0;
  const pendingOrders = metrics?.pendingOrders ?? 0;
  const deliveredOrders = metrics?.deliveredOrders ?? 0;

  // Transform trends data for chart
  const salesData = trends.length > 0
    ? trends.map(t => ({ date: t.date.split('-').pop() || t.date, sales: t.orders }))
    : [
      { date: 'Mon', sales: 0 },
      { date: 'Tue', sales: 0 },
      { date: 'Wed', sales: 0 },
      { date: 'Thu', sales: 0 },
      { date: 'Fri', sales: 0 },
      { date: 'Sat', sales: 0 },
      { date: 'Sun', sales: 0 },
    ];

  // Transform funnel data for chart
  const funnelData = conversionFunnel.length > 0
    ? conversionFunnel.map(f => ({ status: f.status, count: f.count }))
    : [
      { status: 'New', count: 0 },
      { status: 'Confirmed', count: 0 },
      { status: 'Preparing', count: 0 },
      { status: 'Delivery', count: 0 },
      { status: 'Delivered', count: 0 },
    ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Orders"
          value={isLoading ? '...' : totalOrders}
          icon={ShoppingBag}
          trend={12}
          iconColor="text-blue-600"
        />
        <StatCard
          title="Total Revenue"
          value={isLoading ? '...' : `$${totalRevenue.toFixed(2)}`}
          icon={DollarSign}
          trend={8}
          iconColor="text-green-600"
        />
        <StatCard
          title="Pending Orders"
          value={isLoading ? '...' : pendingOrders}
          icon={TrendingUp}
          trend={-3}
          iconColor="text-orange-600"
        />
        <StatCard
          title="Delivered Orders"
          value={isLoading ? '...' : deliveredOrders}
          icon={CheckCircle}
          trend={15}
          iconColor="text-purple-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-lg font-semibold mb-4">Sales Trend</h3>
          <SalesTrendChart data={salesData} />
        </Card>
        <Card>
          <h3 className="text-lg font-semibold mb-4">Order Funnel</h3>
          <OrderFunnelChart data={funnelData} />
        </Card>
      </div>
    </div>
  );
};

