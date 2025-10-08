import React, { useEffect } from 'react';
import { ShoppingBag, DollarSign, TrendingUp, CheckCircle } from 'lucide-react';
import { StatCard } from '../components/common/StatCard';
import { SalesTrendChart } from '../components/charts/SalesTrendChart';
import { OrderFunnelChart } from '../components/charts/OrderFunnelChart';
import { Card } from '../components/ui/Card';
import { useOrdersStore } from '../stores/ordersStore';

export const Dashboard: React.FC = () => {
  const { fetchOrders, orders } = useOrdersStore();

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
  const activeOrders = orders.filter((o) => o.status !== 'delivered').length;
  const deliveredToday = orders.filter((o) => o.status === 'delivered').length;

  const salesData = [
    { date: 'Mon', sales: 120 },
    { date: 'Tue', sales: 150 },
    { date: 'Wed', sales: 180 },
    { date: 'Thu', sales: 160 },
    { date: 'Fri', sales: 200 },
    { date: 'Sat', sales: 220 },
    { date: 'Sun', sales: 190 },
  ];

  const funnelData = [
    { status: 'New', count: 45 },
    { status: 'Confirmed', count: 38 },
    { status: 'Preparing', count: 32 },
    { status: 'Delivery', count: 28 },
    { status: 'Delivered', count: 25 },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Orders"
          value={totalOrders}
          icon={ShoppingBag}
          trend={12}
          iconColor="text-blue-600"
        />
        <StatCard
          title="Total Revenue"
          value={`$${totalRevenue}`}
          icon={DollarSign}
          trend={8}
          iconColor="text-green-600"
        />
        <StatCard
          title="Active Orders"
          value={activeOrders}
          icon={TrendingUp}
          trend={-3}
          iconColor="text-orange-600"
        />
        <StatCard
          title="Delivered Today"
          value={deliveredToday}
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
