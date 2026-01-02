import React, { useEffect } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Wallet, Receipt, Clock } from 'lucide-react';
import { useFinancialStore } from '../../stores/financialStore';
import { FinancialKPICard } from './cards/FinancialKPICard';
import { RevenueExpenseTrendChart } from './charts/RevenueExpenseTrendChart';
import { ExpenseBreakdownChart } from './charts/ExpenseBreakdownChart';
import { Card } from '../ui/Card';

export const OverviewTab: React.FC = () => {
  const {
    summary,
    reports,
    expenseBreakdown,
    pipelineRevenue,
    agentCashHoldings,
    dateRange,
    loadingStates,
    fetchSummary,
    fetchReports,
    fetchExpenseBreakdown,
    fetchPipelineRevenue,
    fetchAgentCashHoldings
  } = useFinancialStore();

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([
        fetchSummary(dateRange.startDate, dateRange.endDate),
        fetchReports('daily', dateRange.startDate, dateRange.endDate),
        fetchExpenseBreakdown(dateRange.startDate, dateRange.endDate),
        fetchPipelineRevenue(dateRange.startDate, dateRange.endDate),
        fetchAgentCashHoldings()
      ]);
    };
    loadData();
  }, [dateRange.startDate, dateRange.endDate]);

  const totalAgentCash = agentCashHoldings.reduce((sum, holding) => sum + holding.totalCollected, 0);
  const avgOrderValue = reports.length > 0
    ? reports.reduce((sum, r) => sum + r.revenue, 0) / Math.max(reports.reduce((sum, r) => sum + r.orders, 0), 1)
    : 0;

  if (loadingStates.summary || loadingStates.reports) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
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
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <FinancialKPICard
          title="Total Revenue"
          value={summary?.totalRevenue || 0}
          icon={DollarSign}
          iconColor="text-green-600"
          iconBgColor="bg-green-100"
        />

        <FinancialKPICard
          title="Net Profit"
          value={summary?.profit || 0}
          icon={TrendingUp}
          iconColor={summary && summary.profit >= 0 ? 'text-blue-600' : 'text-red-600'}
          iconBgColor={summary && summary.profit >= 0 ? 'bg-blue-100' : 'bg-red-100'}
          subtitle={`Margin: ${summary?.profitMargin.toFixed(1) || 0}%`}
        />

        <FinancialKPICard
          title="Outstanding COD"
          value={summary?.codPending || 0}
          icon={Clock}
          iconColor="text-yellow-600"
          iconBgColor="bg-yellow-100"
          subtitle="Pending collection"
        />

        <FinancialKPICard
          title="Total Expenses"
          value={summary?.totalExpenses || 0}
          icon={TrendingDown}
          iconColor="text-red-600"
          iconBgColor="bg-red-100"
        />

        <FinancialKPICard
          title="Expected Revenue"
          value={pipelineRevenue?.totalExpected || 0}
          icon={Receipt}
          iconColor="text-purple-600"
          iconBgColor="bg-purple-100"
          subtitle="From active orders"
        />

        <FinancialKPICard
          title="Cash in Hand"
          value={totalAgentCash}
          icon={Wallet}
          iconColor="text-cyan-600"
          iconBgColor="bg-cyan-100"
          subtitle={`${agentCashHoldings.length} agents holding cash`}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Revenue & Expense Trends
            </h3>
            <RevenueExpenseTrendChart data={reports} height={300} />
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Expense Breakdown
            </h3>
            <ExpenseBreakdownChart data={expenseBreakdown} height={300} />
          </div>
        </Card>
      </div>

      {/* Quick Stats Bar */}
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-gray-600">Total Orders</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {reports.reduce((sum, r) => sum + r.orders, 0)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Average Order Value</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  minimumFractionDigits: 0
                }).format(avgOrderValue)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Expense Categories</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {expenseBreakdown.length}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Agents with Cash</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {agentCashHoldings.length}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};
