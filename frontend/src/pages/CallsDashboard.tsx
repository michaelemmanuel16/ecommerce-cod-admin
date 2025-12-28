import React, { useEffect } from 'react';
import { useCallsStore } from '../stores/callsStore';
import { Card } from '../components/ui/Card';
import { Phone, TrendingUp, Calendar, PieChart } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

export const CallsDashboard: React.FC = () => {
  const { stats, fetchCallStats, isLoading } = useCallsStore();

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    await fetchCallStats();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Calculate totals across all reps
  const totalCallsToday = stats.reduce((sum, s) => sum + s.todayCalls, 0);
  const totalCallsWeek = stats.reduce((sum, s) => sum + s.weekCalls, 0);
  const totalCallsMonth = stats.reduce((sum, s) => sum + s.monthCalls, 0);
  const avgCallsPerDay = stats.length > 0
    ? stats.reduce((sum, s) => sum + s.avgCallsPerDay, 0) / stats.length
    : 0;

  // Prepare data for outcome chart
  const outcomeTotals = stats.reduce((acc, s) => ({
    confirmed: acc.confirmed + s.outcomeBreakdown.confirmed,
    rescheduled: acc.rescheduled + s.outcomeBreakdown.rescheduled,
    no_answer: acc.no_answer + s.outcomeBreakdown.no_answer,
    cancelled: acc.cancelled + s.outcomeBreakdown.cancelled,
    other: acc.other + s.outcomeBreakdown.other
  }), { confirmed: 0, rescheduled: 0, no_answer: 0, cancelled: 0, other: 0 });

  const outcomeChartData = [
    { name: 'Confirmed', value: outcomeTotals.confirmed, fill: '#10b981' },
    { name: 'Rescheduled', value: outcomeTotals.rescheduled, fill: '#3b82f6' },
    { name: 'No Answer', value: outcomeTotals.no_answer, fill: '#f59e0b' },
    { name: 'Cancelled', value: outcomeTotals.cancelled, fill: '#ef4444' },
    { name: 'Other', value: outcomeTotals.other, fill: '#6b7280' }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Call Tracking Dashboard</h1>
        <p className="text-gray-600 mt-1">Monitor sales rep call activity and performance</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Today</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{totalCallsToday}</p>
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
                <p className="text-2xl font-bold text-gray-900 mt-1">{totalCallsWeek}</p>
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
                <p className="text-2xl font-bold text-gray-900 mt-1">{totalCallsMonth}</p>
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
                  {avgCallsPerDay.toFixed(1)}
                </p>
              </div>
              <PieChart className="w-8 h-8 text-orange-500" />
            </div>
          </div>
        </Card>
      </div>

      {/* Outcome Breakdown Chart */}
      <Card>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Call Outcomes</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={outcomeChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Rep Performance Table */}
      <Card>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Rep Performance</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rep Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Today</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Week</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg/Day</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confirmed</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">No Answer</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stats.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                      No call data available
                    </td>
                  </tr>
                ) : (
                  stats.map((stat) => (
                    <tr key={stat.repId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {stat.repName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {stat.todayCalls}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {stat.weekCalls}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {stat.monthCalls}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {stat.avgCallsPerDay.toFixed(1)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">
                        {stat.outcomeBreakdown.confirmed}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-orange-600">
                        {stat.outcomeBreakdown.no_answer}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {/* Activity Timeline */}
      {stats.length > 0 && stats[0].timeline && (
        <Card>
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">Activity Timeline (Last 30 Days)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={stats[0].timeline}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis />
                <Tooltip labelFormatter={(value) => new Date(value).toLocaleDateString()} />
                <Area type="monotone" dataKey="calls" stroke="#3b82f6" fill="#93c5fd" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
};
