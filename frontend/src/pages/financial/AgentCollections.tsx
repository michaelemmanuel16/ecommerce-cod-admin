import React, { useEffect, useState, useMemo } from 'react';
import { Users, DollarSign, AlertTriangle, Clock, BarChart3, Download, Filter, Mail, Eye, ChevronUp, ChevronDown } from 'lucide-react';
import { useFinancialStore } from '../../stores/financialStore';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/format';
import { financialService } from '../../services/financial.service';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import toast from 'react-hot-toast';
import { CollectionActionModal } from '../../components/financial/modals/CollectionActionModal';

export const AgentCollections: React.FC = () => {
  const {
    agentAging,
    loadingStates,
    fetchAgentAging
  } = useFinancialStore();

  const [filterOverdue, setFilterOverdue] = useState(false);
  const [sortField, setSortField] = useState<string>('totalBalance');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Selection state for reconciliation
  const [selectedAgent, setSelectedAgent] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    fetchAgentAging();
  }, []);

  const handleExport = async () => {
    try {
      await financialService.downloadAgentAgingCSV();
      toast.success('Agent collections report exported');
    } catch (error) {
      toast.error('Failed to export report');
    }
  };

  const filteredAndSortedBuckets = useMemo(() => {
    if (!agentAging) return [];

    let result = [...agentAging.buckets];

    if (filterOverdue) {
      result = result.filter(b => b.bucket_4_7 > 0 || b.bucket_8_plus > 0);
    }

    result.sort((a: any, b: any) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'name') {
        valA = `${a.agent.firstName} ${a.agent.lastName}`;
        valB = `${b.agent.firstName} ${b.agent.lastName}`;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [agentAging, filterOverdue, sortField, sortOrder]);

  const chartData = useMemo(() => {
    if (!agentAging?.summary?.bucketTotals) return [];
    const { bucketTotals } = agentAging.summary;
    return [
      { name: '0-3 Days', value: Number(bucketTotals.bucket_0_1) + Number(bucketTotals.bucket_2_3), color: '#22c55e' },
      { name: '4-7 Days', value: Number(bucketTotals.bucket_4_7), color: '#f97316' },
      { name: '8+ Days', value: Number(bucketTotals.bucket_8_plus), color: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [agentAging]);

  if (loadingStates.agents || !agentAging) {
    return (
      <div className="flex flex-col items-center justify-center py-24 bg-white rounded-lg border border-gray-100 shadow-sm">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        <p className="mt-4 text-gray-500 font-medium">Loading agent collections data...</p>
      </div>
    );
  }

  const { summary } = agentAging;

  return (
    <div className="space-y-6">
      {/* KPI Cards - 6 agent-specific metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <Card className="border-l-4 border-blue-500">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Agents Holding Cash</span>
              <div className="p-1.5 bg-blue-50 rounded-lg">
                <Users className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{summary.totalAgentsWithBalance}</div>
          </div>
        </Card>

        <Card className="border-l-4 border-green-500">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Cash Held</span>
              <div className="p-1.5 bg-green-50 rounded-lg">
                <DollarSign className="w-4 h-4 text-green-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(summary.totalOutstandingAmount)}</div>
          </div>
        </Card>

        <Card className="border-l-4 border-red-500">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Overdue Settlements</span>
              <div className="p-1.5 bg-red-50 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-red-600">{summary.overdueAgentsCount}</div>
            <div className="text-xs text-gray-500 mt-1">&gt;7 days</div>
          </div>
        </Card>

        <Card className="border-l-4 border-primary-500">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Outstanding AR</span>
              <div className="p-1.5 bg-primary-50 rounded-lg">
                <BarChart3 className="w-4 h-4 text-primary-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(summary.totalOutstandingAmount)}</div>
          </div>
        </Card>

        <Card className="border-l-4 border-red-500">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Critical (8+ Days)</span>
              <div className="p-1.5 bg-red-50 rounded-lg">
                <Clock className="w-4 h-4 text-red-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(summary.criticalOverdueAmount)}</div>
          </div>
        </Card>

        <Card className="border-l-4 border-orange-500">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Warning (4-7 Days)</span>
              <div className="p-1.5 bg-orange-50 rounded-lg">
                <Clock className="w-4 h-4 text-orange-600" />
              </div>
            </div>
            <div className="text-2xl font-bold text-orange-600">{formatCurrency(summary.warningOverdueAmount)}</div>
          </div>
        </Card>
      </div>

      {/* Exposure Distribution Chart & Agent Table */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Exposure Distribution Chart */}
        <Card className="lg:col-span-1 p-0 flex flex-col">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Exposure Distribution</h3>
          </div>
          <div className="h-64 mt-4 mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="px-6 py-4 mt-auto border-t border-gray-100 bg-gray-50/30 text-[11px] text-gray-500 italic">
            Values represent the total amount held in each bucket across all agents.
          </div>
        </Card>

        {/* Unified Agent Table */}
        <Card className="lg:col-span-3 p-0">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <div className="flex items-center space-x-3">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Agent Aging & Collections</h3>
              <div className="h-4 w-px bg-gray-200" />
              <div className="flex items-center bg-white border border-gray-200 rounded-md px-2 py-1">
                <Filter className="w-3.5 h-3.5 text-gray-400 mr-2" />
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                    checked={filterOverdue}
                    onChange={(e) => setFilterOverdue(e.target.checked)}
                  />
                  <span className="ml-2 text-xs font-medium text-gray-700 select-none">Show Overdue Only</span>
                </label>
              </div>
            </div>
            <button
              onClick={handleExport}
              className="flex items-center px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-900 transition-colors group" onClick={() => { setSortField('name'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                    <div className="flex items-center">
                      Agent
                      {sortField === 'name' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 ml-1 text-primary-600" /> : <ChevronDown className="w-3 h-3 ml-1 text-primary-600" />
                      ) : (
                        <Users className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-900 transition-colors group" onClick={() => { setSortField('totalBalance'); setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                    <div className="flex items-center">
                      Balance
                      {sortField === 'totalBalance' ? (
                        sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 ml-1 text-primary-600" /> : <ChevronDown className="w-3 h-3 ml-1 text-primary-600" />
                      ) : (
                        <BarChart3 className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">0-3 Days</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">4-7 Days</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">8+ Days</th>
                  <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filteredAndSortedBuckets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400 italic text-sm">
                      No aging data found matching filters
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedBuckets.map((bucket: any) => (
                    <tr key={bucket.agentId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-8 w-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center text-white text-xs font-bold">
                            {bucket.agent.firstName.charAt(0)}{bucket.agent.lastName.charAt(0)}
                          </div>
                          <div className="ml-3">
                            <div className="text-sm font-medium text-gray-900">{bucket.agent.firstName} {bucket.agent.lastName}</div>
                            <div className="text-xs text-gray-500">{bucket.agent.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-gray-900">{formatCurrency(bucket.totalBalance)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          {formatCurrency(Number(bucket.bucket_0_1) + Number(bucket.bucket_2_3))}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          {formatCurrency(bucket.bucket_4_7)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          {formatCurrency(bucket.bucket_8_plus)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            className="text-gray-400 hover:text-blue-600 transition-colors"
                            title="Send reminder"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                            onClick={() => setSelectedAgent({
                              id: bucket.agentId,
                              name: `${bucket.agent.firstName} ${bucket.agent.lastName}`
                            })}
                          >
                            <Eye className="w-4 h-4 mr-1 text-gray-400" />
                            Verify Collections
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Collection Action Modal */}
      {selectedAgent && (
        <CollectionActionModal
          isOpen={!!selectedAgent}
          onClose={() => setSelectedAgent(null)}
          agentId={selectedAgent.id}
          agentName={selectedAgent.name}
        />
      )}
    </div>
  );
};
