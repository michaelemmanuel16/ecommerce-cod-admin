import React, { useEffect } from 'react';
import { Users, DollarSign, Clock, AlertTriangle } from 'lucide-react';
import { useFinancialStore } from '../../stores/financialStore';
import { FinancialKPICard } from './cards/FinancialKPICard';
import { AgentSettlementChart } from './charts/AgentSettlementChart';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { CollectionActionModal } from './modals/CollectionActionModal';
import { formatCurrency } from '../../utils/format';

export const AgentReconciliationTab: React.FC = () => {
  const {
    agentCashHoldings,
    loadingStates,
    fetchAgentCashHoldings
  } = useFinancialStore();

  const [selectedAgent, setSelectedAgent] = React.useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    fetchAgentCashHoldings();
  }, []);

  const totalCashHeld = agentCashHoldings.reduce((sum, h) => sum + h.totalCollected, 0);
  const overdueAgents = agentCashHoldings.filter(h => {
    const daysSinceOldest = Math.floor(
      (Date.now() - new Date(h.oldestCollectionDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceOldest > 7;
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getDaysSince = (dateStr: string) => {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  };

  const getStatusColor = (daysSince: number) => {
    if (daysSince > 7) return 'text-red-600 bg-red-50';
    if (daysSince > 3) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  if (loadingStates.agents) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="p-6">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <FinancialKPICard
          title="Agents with Cash"
          value={agentCashHoldings.length.toString()}
          icon={Users}
          iconColor="text-blue-600"
          iconBgColor="bg-blue-100"
          subtitle="Currently holding cash"
        />

        <FinancialKPICard
          title="Total Cash Held"
          value={totalCashHeld}
          icon={DollarSign}
          iconColor="text-green-600"
          iconBgColor="bg-green-100"
        />

        <FinancialKPICard
          title="Overdue Settlements"
          value={overdueAgents.length.toString()}
          icon={AlertTriangle}
          iconColor="text-red-600"
          iconBgColor="bg-red-100"
          subtitle="> 7 days old"
        />

        <FinancialKPICard
          title="Total Orders"
          value={agentCashHoldings.reduce((sum, h) => sum + h.orderCount, 0).toString()}
          icon={Clock}
          iconColor="text-purple-600"
          iconBgColor="bg-purple-100"
          subtitle="Pending settlement"
        />
      </div>

      {/* Agent Settlement Chart */}
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Top Agents by Cash Held
          </h3>
          <AgentSettlementChart data={agentCashHoldings} height={300} />
        </div>
      </Card>

      {/* Agent Accountability Table */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Agent Accountability</h3>
          </div>

          <div className="overflow-x-auto">
            {agentCashHoldings.length === 0 ? (
              <p className="text-center text-gray-500 py-8">
                No agents currently holding cash
              </p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Agent
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Orders
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Cash Held
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Oldest Collection
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {agentCashHoldings.map((holding) => {
                    const daysSince = getDaysSince(holding.oldestCollectionDate);
                    return (
                      <tr key={holding.agent.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {holding.agent.firstName} {holding.agent.lastName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {holding.agent.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {holding.orderCount}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                          {formatCurrency(holding.totalCollected)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDate(holding.oldestCollectionDate)}
                          <span className="text-xs text-gray-400 ml-1">
                            ({daysSince} {daysSince === 1 ? 'day' : 'days'} ago)
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                              daysSince
                            )}`}
                          >
                            {daysSince > 7 ? 'Overdue' : daysSince > 3 ? 'Due Soon' : 'On Time'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => setSelectedAgent({
                              id: holding.agent.id,
                              name: `${holding.agent.firstName} ${holding.agent.lastName}`
                            })}
                          >
                            Manage
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Card>

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
