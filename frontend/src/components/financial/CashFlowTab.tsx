import React, { useEffect } from 'react';
import { useFinancialStore } from '../../stores/financialStore';
import { CashFlowForecastChart } from './charts/CashFlowForecastChart';
import { Card } from '../ui/Card';
import {
  Wallet,
  Truck,
  UserCheck,
  TrendingUp,
  Download,
  Mail,
  AlertCircle,
  ArrowRight
} from 'lucide-react';
import { formatCurrency } from '../../utils/format';

export const CashFlowTab: React.FC = () => {
  const {
    cashFlowReport,
    loadingStates,
    fetchCashFlowReport,
    downloadCashFlowCSV
  } = useFinancialStore();

  useEffect(() => {
    fetchCashFlowReport();
  }, [fetchCashFlowReport]);

  const handleDownloadCSV = () => {
    downloadCashFlowCSV();
  };

  if (loadingStates.cashFlow && !cashFlowReport) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="p-4">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
              </div>
            </Card>
          ))}
        </div>
        <Card className="animate-pulse h-[400px]">
          <div className="p-6 h-full bg-gray-50 rounded-lg"></div>
        </Card>
      </div>
    );
  }

  const kpis = cashFlowReport?.kpis;
  const forecast = cashFlowReport?.forecast || [];
  const agentBreakdown = cashFlowReport?.agentBreakdown || [];

  return (
    <div className="space-y-6">
      {/* KPI Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="Cash in Hand"
          value={kpis?.cashInHand || 0}
          icon={<Wallet className="w-5 h-5 text-blue-600" />}
          description="Collected by agents"
        />
        <KPICard
          title="Cash in Transit"
          value={kpis?.cashInTransit || 0}
          icon={<Truck className="w-5 h-5 text-yellow-600" />}
          description="Delivered, not collected"
        />
        <KPICard
          title="AR Agents"
          value={kpis?.arAgents || 0}
          icon={<UserCheck className="w-5 h-5 text-purple-600" />}
          description="Pending agent clearance"
        />
        <KPICard
          title="Cash Expected"
          value={kpis?.cashExpected || 0}
          icon={<ArrowRight className="w-5 h-5 text-green-600" />}
          description="Out for delivery"
        />
        <KPICard
          title="Total Position"
          value={kpis?.totalCashPosition || 0}
          icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
          description="Consolidated liquidity"
          highlight
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Forecast Chart */}
        <Card className="lg:col-span-2">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">30-Day Cash Flow Forecast</h3>
                <p className="text-sm text-gray-500">Based on last 30 days average collections and expenses</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleDownloadCSV}
                  className="p-2 text-gray-400 hover:text-blue-600 border border-gray-200 rounded-lg hover:border-blue-100 transition-colors"
                  title="Export CSV"
                >
                  <Download className="w-5 h-5" />
                </button>
              </div>
            </div>
            <CashFlowForecastChart data={forecast} height={350} />
          </div>
        </Card>

        {/* Agent Breakdown */}
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Agent Cash Holdings</h3>
            <div className="space-y-4">
              {agentBreakdown.length === 0 ? (
                <div className="text-center py-8">
                  <UserCheck className="w-12 h-12 text-gray-200 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">No agent holdings recorded</p>
                </div>
              ) : (
                agentBreakdown.slice(0, 8).map((agentData) => (
                  <div key={agentData.agent.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {agentData.agent.firstName} {agentData.agent.lastName}
                      </p>
                      <p className="text-xs text-gray-500">{agentData.orderCount} orders</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">
                        {formatCurrency(agentData.totalCollected)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        Oldest: {new Date(agentData.oldestCollectionDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
              {agentBreakdown.length > 8 && (
                <button className="w-full py-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
                  View All {agentBreakdown.length} Agents
                </button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
        <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Forecast projections assume delivery/expense rates remain consistent with the previous 30-day average.
          Actual results may vary based on delivery success rates and seasonal trends.
        </p>
      </div>
    </div>
  );
};

interface KPICardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  description: string;
  highlight?: boolean;
}

const KPICard: React.FC<KPICardProps> = ({ title, value, icon, description, highlight }) => (
  <Card className={`${highlight ? 'ring-2 ring-emerald-500 ring-offset-2' : ''}`}>
    <div className="p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-lg ${highlight ? 'bg-emerald-50' : 'bg-gray-50'}`}>
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{title}</p>
          <h4 className={`text-xl font-bold ${highlight ? 'text-emerald-700' : 'text-gray-900'}`}>
            {formatCurrency(value)}
          </h4>
        </div>
      </div>
      <p className="text-[10px] text-gray-400">{description}</p>
    </div>
  </Card>
);
