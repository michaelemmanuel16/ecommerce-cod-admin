import React, { useEffect, useMemo } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useAnalyticsStore } from '../../stores/analyticsStore';
import { DeliveryFunnelChart } from '../../components/analytics/DeliveryFunnelChart';
import { Card } from '../../components/ui/Card';
import { OrderStatus } from '../../types';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';

interface DeliveryOperationsTabProps {
  startDate?: string;
  endDate?: string;
}

const FAILURE_COLORS: Record<string, string> = {
  cancelled: '#ef4444',
  returned: '#ec4899',
  failed_delivery: '#dc2626',
};

export const DeliveryOperationsTab: React.FC<DeliveryOperationsTabProps> = ({
  startDate,
  endDate,
}) => {
  const {
    trends,
    ordersByStatus,
    agentPerformance,
    fetchSalesTrends,
    fetchOrdersByStatus,
    fetchAgentPerformance,
  } = useAnalyticsStore();

  useEffect(() => {
    fetchSalesTrends('daily', undefined, startDate, endDate);
    fetchOrdersByStatus(startDate, endDate);
    fetchAgentPerformance(startDate, endDate);
  }, [startDate, endDate, fetchSalesTrends, fetchOrdersByStatus, fetchAgentPerformance]);

  // Delivery rate trend from daily data
  const deliveryRateTrend = useMemo(
    () =>
      trends.map((t) => ({
        date: t.date,
        rate: t.orders > 0 ? (t.delivered / t.orders) * 100 : 0,
      })),
    [trends]
  );

  // Failed/cancelled breakdown
  const failureData = useMemo(
    () =>
      ordersByStatus
        .filter((d) => ['cancelled', 'returned', 'failed_delivery'].includes(d.status))
        .map((d) => ({
          name: ORDER_STATUS_LABELS[d.status as OrderStatus] || d.status,
          count: d.count,
          status: d.status,
        })),
    [ordersByStatus]
  );

  // Sort agents by delivery success rate desc
  const sortedAgents = useMemo(
    () => [...agentPerformance].sort((a, b) => (b.deliverySuccessRate ?? -1) - (a.deliverySuccessRate ?? -1)),
    [agentPerformance]
  );

  return (
    <div className="space-y-6">
      {/* Delivery Rate Trend + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Delivery Rate Trend</h3>
            {deliveryRateTrend.length === 0 ? (
              <p className="text-gray-500 text-center py-12">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={deliveryRateTrend}>
                  <defs>
                    <linearGradient id="colorDeliveryRate" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    }
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => `${v}%`}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value.toFixed(1)}%`, 'Delivery Rate']}
                    labelFormatter={(label) =>
                      new Date(label).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="rate"
                    stroke="#10b981"
                    fill="url(#colorDeliveryRate)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <DeliveryFunnelChart data={ordersByStatus} title="Order Pipeline" />
      </div>

      {/* Failed/Cancelled Breakdown + Agent Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Failed & Cancelled Orders
            </h3>
            {failureData.length === 0 ? (
              <p className="text-gray-500 text-center py-12">No failures recorded</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={failureData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {failureData.map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={FAILURE_COLORS[entry.status] || '#6b7280'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Performance Ranking</h3>
            {sortedAgents.length === 0 ? (
              <p className="text-gray-500 text-center py-12">No data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Agent
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Delivered
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Failed
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Delivery success rate
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedAgents.map((agent) => (
                      <tr key={agent.userId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">
                          {agent.userName}
                        </td>
                        <td className="px-3 py-2 text-sm text-green-600">{agent.completed}</td>
                        <td className="px-3 py-2 text-sm text-red-600">{agent.failed || 0}</td>
                        <td className="px-3 py-2 text-sm">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              agent.deliverySuccessRate == null
                                ? 'bg-gray-100 text-gray-600'
                                : agent.deliverySuccessRate >= 80
                                  ? 'bg-green-100 text-green-800'
                                  : agent.deliverySuccessRate >= 60
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {agent.deliverySuccessRate == null ? 'n/a' : `${agent.deliverySuccessRate.toFixed(1)}%`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
