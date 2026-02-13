import React, { useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Phone, Calendar, TrendingUp, PieChart } from 'lucide-react';
import { useAnalyticsStore } from '../../stores/analyticsStore';
import { useCallsStore } from '../../stores/callsStore';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/format';

interface TeamPerformanceTabProps {
  startDate?: string;
  endDate?: string;
}

export const TeamPerformanceTab: React.FC<TeamPerformanceTabProps> = ({
  startDate,
  endDate,
}) => {
  const {
    repPerformance,
    agentPerformance,
    fetchRepPerformance,
    fetchAgentPerformance,
  } = useAnalyticsStore();

  const { stats, fetchCallStats } = useCallsStore();

  useEffect(() => {
    fetchRepPerformance(startDate, endDate);
    fetchAgentPerformance(startDate, endDate);
    fetchCallStats({ startDate, endDate });
  }, [startDate, endDate, fetchRepPerformance, fetchAgentPerformance, fetchCallStats]);

  const sortedReps = [...repPerformance].sort((a, b) => b.successRate - a.successRate);
  const sortedAgents = [...agentPerformance].sort((a, b) => b.successRate - a.successRate);

  const callOutcomesData = [
    {
      name: 'Confirmed',
      value: stats.reduce((sum, s) => sum + s.outcomeBreakdown.confirmed, 0),
      fill: '#10b981',
    },
    {
      name: 'Rescheduled',
      value: stats.reduce((sum, s) => sum + s.outcomeBreakdown.rescheduled, 0),
      fill: '#3b82f6',
    },
    {
      name: 'No Answer',
      value: stats.reduce((sum, s) => sum + s.outcomeBreakdown.no_answer, 0),
      fill: '#f59e0b',
    },
    {
      name: 'Cancelled',
      value: stats.reduce((sum, s) => sum + s.outcomeBreakdown.cancelled, 0),
      fill: '#ef4444',
    },
    {
      name: 'Other',
      value: stats.reduce((sum, s) => sum + s.outcomeBreakdown.other, 0),
      fill: '#6b7280',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Performance Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rep Performance */}
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Sales Rep Performance</h3>
            {sortedReps.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rep</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Assigned</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedReps.map((rep) => (
                      <tr key={rep.userId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">{rep.userName}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{rep.totalAssigned}</td>
                        <td className="px-3 py-2 text-sm text-green-600">{rep.completed}</td>
                        <td className="px-3 py-2 text-sm">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            rep.successRate >= 80 ? 'bg-green-100 text-green-800' :
                            rep.successRate >= 60 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {rep.successRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-900">
                          {rep.revenue !== undefined ? formatCurrency(rep.revenue) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* Agent Performance */}
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Delivery Agent Performance</h3>
            {sortedAgents.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No data available</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Agent</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Assigned</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Delivered</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Failed</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedAgents.map((agent) => (
                      <tr key={agent.userId} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">{agent.userName}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{agent.totalAssigned}</td>
                        <td className="px-3 py-2 text-sm text-green-600">{agent.completed}</td>
                        <td className="px-3 py-2 text-sm text-red-600">{agent.failed || 0}</td>
                        <td className="px-3 py-2 text-sm">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            agent.successRate >= 80 ? 'bg-green-100 text-green-800' :
                            agent.successRate >= 60 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {agent.successRate.toFixed(1)}%
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

      {/* Call Tracking Section */}
      <h2 className="text-xl font-bold text-gray-900">Call Tracking</h2>

      {/* Call Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Today</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {stats.reduce((sum, s) => sum + s.todayCalls, 0)}
                </p>
              </div>
              <Phone className="w-8 h-8 text-blue-500" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">This Week</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {stats.reduce((sum, s) => sum + s.weekCalls, 0)}
                </p>
              </div>
              <Calendar className="w-8 h-8 text-green-500" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">This Month</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {stats.reduce((sum, s) => sum + s.monthCalls, 0)}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-purple-500" />
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg per Day</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {stats.length > 0
                    ? (stats.reduce((sum, s) => sum + s.avgCallsPerDay, 0) / stats.length).toFixed(1)
                    : '0.0'}
                </p>
              </div>
              <PieChart className="w-8 h-8 text-orange-500" />
            </div>
          </div>
        </Card>
      </div>

      {/* Call Outcomes Chart + Rep Call Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">Call Outcomes</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={callOutcomesData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">Rep Call Performance</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rep</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Today</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Week</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg/Day</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confirmed</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {stats.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-center text-gray-500">
                        No call data available
                      </td>
                    </tr>
                  ) : (
                    stats.map((stat) => (
                      <tr key={stat.repId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                          {stat.repName}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {stat.todayCalls}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {stat.weekCalls}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {stat.monthCalls}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {stat.avgCallsPerDay.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-green-600 font-medium">
                          {stat.outcomeBreakdown.confirmed}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
