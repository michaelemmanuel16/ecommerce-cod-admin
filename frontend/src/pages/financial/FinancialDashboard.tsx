import React, { useEffect } from 'react';
import { DollarSign, TrendingUp, TrendingDown, Receipt, Clock, Wallet, Truck, ArrowRight, Download } from 'lucide-react';
import { useFinancialStore } from '../../stores/financialStore';
import { FinancialKPICard } from '../../components/financial/cards/FinancialKPICard';
import { RevenueExpenseTrendChart } from '../../components/financial/charts/RevenueExpenseTrendChart';
import { CashFlowForecastChart } from '../../components/financial/charts/CashFlowForecastChart';
import { Card } from '../../components/ui/Card';
import { formatCurrency } from '../../utils/format';

export const FinancialDashboard: React.FC = () => {
  const {
    summary,
    reports,
    pipelineRevenue,
    cashFlowReport,
    dateRange,
    loadingStates,
    fetchSummary,
    fetchReports,
    fetchPipelineRevenue,
    fetchCashFlowReport,
    downloadCashFlowCSV
  } = useFinancialStore();

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([
        fetchSummary(dateRange.startDate, dateRange.endDate),
        fetchReports('daily', dateRange.startDate, dateRange.endDate),
        fetchPipelineRevenue(dateRange.startDate, dateRange.endDate),
        fetchCashFlowReport()
      ]);
    };
    loadData();
  }, [dateRange.startDate, dateRange.endDate]);

  const kpis = cashFlowReport?.kpis;
  const forecast = cashFlowReport?.forecast || [];

  if (loadingStates.summary || loadingStates.reports) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {[...Array(5)].map((_, i) => (
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
    <div className="space-y-12">
      {/* Section 1: Core Financial Health */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Core Financial Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
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
            title="Outstanding Receivables"
            value={(summary as any)?.outstandingReceivables || 0}
            icon={Clock}
            iconColor="text-orange-600"
            iconBgColor="bg-orange-100"
            subtitle="Delivered, awaiting collection"
          />

          <FinancialKPICard
            title="Total Expenses"
            value={summary?.totalExpenses || 0}
            icon={TrendingDown}
            iconColor="text-red-600"
            iconBgColor="bg-red-100"
          />

          <FinancialKPICard
            title="Pipeline Revenue"
            value={pipelineRevenue?.totalExpected || 0}
            icon={Receipt}
            iconColor="text-purple-600"
            iconBgColor="bg-purple-100"
            subtitle="Active orders (not yet delivered)"
          />
        </div>
      </div>

      {/* Section 2: Performance Trends */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Performance Trends</h2>
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Revenue & Expense Trends
            </h3>
            <RevenueExpenseTrendChart data={reports} height={300} />
          </div>
        </Card>
      </div>

      {/* Section 3: Liquidity & Cash Forecasting */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Liquidity & Cash Forecasting</h2>

        {/* Cash Position Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-green-50">
                  <Wallet className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Cash Available Now</p>
                  <h4 className="text-xl font-bold text-gray-900">
                    {formatCurrency((kpis as any)?.cashAvailableNow || 0)}
                  </h4>
                </div>
              </div>
              <p className="text-[10px] text-gray-400">Liquid cash (bank + agents)</p>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-yellow-50">
                  <Truck className="w-5 h-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">In-Transit Orders</p>
                  <h4 className="text-xl font-bold text-gray-900">
                    {formatCurrency(kpis?.cashExpected || 0)}
                  </h4>
                </div>
              </div>
              <p className="text-[10px] text-gray-400">Out for delivery</p>
            </div>
          </Card>

          <Card className="ring-2 ring-blue-500 ring-offset-2">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-blue-50">
                  <ArrowRight className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cash Pipeline</p>
                  <h4 className="text-xl font-bold text-blue-700">
                    {formatCurrency((kpis as any)?.totalCashPipeline || 0)}
                  </h4>
                </div>
              </div>
              <p className="text-[10px] text-gray-400">Available + expected collections</p>
            </div>
          </Card>
        </div>

        {/* 30-Day Cash Flow Forecast */}
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">30-Day Cash Flow Forecast</h3>
                <p className="text-sm text-gray-500">Based on last 30 days average collections and expenses</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={downloadCashFlowCSV}
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
      </div>
    </div>
  );
};
