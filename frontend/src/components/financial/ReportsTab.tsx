import React, { useEffect, useState, useMemo } from 'react';
import { Download, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { useFinancialStore } from '../../stores/financialStore';
import { FinancialKPICard } from './cards/FinancialKPICard';
import { FinancialTrendsChart } from './charts/FinancialTrendsChart';
import { Card } from '../ui/Card';
import { formatCurrency } from '../../utils/format';

type PeriodType = 'daily' | 'monthly';

export const ReportsTab: React.FC = () => {
  const {
    summary,
    reports,
    expenseBreakdown,
    profitMargins,
    dateRange,
    loadingStates,
    fetchSummary,
    fetchReports,
    fetchExpenseBreakdown,
    fetchProfitMargins
  } = useFinancialStore();

  const [period, setPeriod] = useState<PeriodType>('daily');

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([
        fetchSummary(dateRange.startDate, dateRange.endDate),
        fetchReports(period, dateRange.startDate, dateRange.endDate),
        fetchExpenseBreakdown(dateRange.startDate, dateRange.endDate),
        fetchProfitMargins(dateRange.startDate, dateRange.endDate)
      ]);
    };
    loadData();
  }, [period, dateRange.startDate, dateRange.endDate]);

  // Calculate P&L Statement
  const plStatement = useMemo(() => {
    if (!summary) return null;

    const cogs = expenseBreakdown.find(e => e.category === 'COGS')?.totalAmount || 0;
    const deliveryFees = expenseBreakdown.find(e => e.category === 'Delivery Fees' || e.category === 'Delivery')?.totalAmount || 0;
    const marketing = expenseBreakdown.find(e => e.category === 'Marketing')?.totalAmount || 0;
    const operations = expenseBreakdown.find(e => e.category === 'Operations')?.totalAmount || 0;
    const salaries = expenseBreakdown.find(e => e.category === 'Salaries')?.totalAmount || 0;
    const utilities = expenseBreakdown.find(e => e.category === 'Utilities')?.totalAmount || 0;
    const other = expenseBreakdown.find(e => e.category === 'Other')?.totalAmount || 0;

    const grossProfit = summary.totalRevenue - cogs;
    const operatingExpenses = deliveryFees + marketing + operations + salaries + utilities + other;
    const netProfit = grossProfit - operatingExpenses;

    return {
      revenue: summary.totalRevenue,
      cogs,
      grossProfit,
      grossMargin: summary.totalRevenue > 0 ? (grossProfit / summary.totalRevenue) * 100 : 0,
      operatingExpenses: {
        deliveryFees,
        marketing,
        operations,
        salaries,
        utilities,
        other,
        total: operatingExpenses
      },
      netProfit,
      netMargin: summary.totalRevenue > 0 ? (netProfit / summary.totalRevenue) * 100 : 0
    };
  }, [summary, expenseBreakdown]);

  const handleExportPDF = () => {
    alert('PDF export functionality to be implemented');
  };

  const handleExportExcel = () => {
    alert('Excel export functionality to be implemented');
  };

  const handleExportCSV = () => {
    if (!plStatement) return;

    const csvContent = [
      'Profit & Loss Statement',
      `Period: ${dateRange.startDate || 'All time'} to ${dateRange.endDate || 'Present'}`,
      '',
      'Item,Amount',
      `Revenue,${plStatement.revenue}`,
      `Cost of Goods Sold (COGS),${plStatement.cogs}`,
      `Gross Profit,${plStatement.grossProfit}`,
      `Gross Margin,${plStatement.grossMargin.toFixed(2)}%`,
      '',
      'Operating Expenses:',
      `Delivery Fees,${plStatement.operatingExpenses.deliveryFees}`,
      `Marketing,${plStatement.operatingExpenses.marketing}`,
      `Operations,${plStatement.operatingExpenses.operations}`,
      `Salaries,${plStatement.operatingExpenses.salaries}`,
      `Utilities,${plStatement.operatingExpenses.utilities}`,
      `Other,${plStatement.operatingExpenses.other}`,
      `Total Operating Expenses,${plStatement.operatingExpenses.total}`,
      '',
      `Net Profit,${plStatement.netProfit}`,
      `Net Margin,${plStatement.netMargin.toFixed(2)}%`
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pl-statement-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loadingStates.summary || loadingStates.reports) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
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
      {/* Profitability Analysis Cards */}
      {profitMargins && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FinancialKPICard
            title="Gross Profit"
            value={profitMargins.grossProfit}
            icon={DollarSign}
            iconColor="text-green-600"
            iconBgColor="bg-green-100"
            subtitle="Current period"
          />

          <FinancialKPICard
            title="Profit Margin"
            value={`${profitMargins.profitMargin.toFixed(1)}%`}
            icon={profitMargins.profitMargin >= 0 ? TrendingUp : TrendingDown}
            iconColor={profitMargins.profitMargin >= 0 ? 'text-blue-600' : 'text-red-600'}
            iconBgColor={profitMargins.profitMargin >= 0 ? 'bg-blue-100' : 'bg-red-100'}
            subtitle="Of total revenue"
          />

          <FinancialKPICard
            title="Total Cost"
            value={profitMargins.totalCost}
            icon={TrendingDown}
            iconColor="text-red-600"
            iconBgColor="bg-red-100"
            subtitle="COGS + Expenses"
          />
        </div>
      )}

      {/* Financial Trends Chart */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Financial Trends</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPeriod('daily')}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${period === 'daily'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                Daily
              </button>
              <button
                onClick={() => setPeriod('monthly')}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${period === 'monthly'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                Monthly
              </button>
            </div>
          </div>
          <FinancialTrendsChart data={reports} period={period} height={300} />
        </div>
      </Card>

      {/* P&L Statement */}
      {plStatement && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Profit & Loss Statement</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportPDF}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  PDF
                </button>
                <button
                  onClick={handleExportExcel}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Excel
                </button>
                <button
                  onClick={handleExportCSV}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  CSV
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {/* Revenue Section */}
              <div className="border-b pb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-gray-900">Revenue</span>
                  <span className="font-bold text-green-600">{formatCurrency(plStatement.revenue)}</span>
                </div>
              </div>

              {/* COGS Section */}
              <div className="border-b pb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-gray-900">Cost of Goods Sold (COGS)</span>
                  <span className="font-bold text-red-600">({formatCurrency(plStatement.cogs)})</span>
                </div>
              </div>

              {/* Gross Profit */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-gray-900">Gross Profit</span>
                  <span className="font-bold text-blue-600">{formatCurrency(plStatement.grossProfit)}</span>
                </div>
                <div className="text-sm text-gray-600">
                  Gross Margin: {plStatement.grossMargin.toFixed(1)}%
                </div>
              </div>

              {/* Operating Expenses */}
              <div className="border-b pb-4">
                <div className="font-semibold text-gray-900 mb-3">Operating Expenses:</div>
                <div className="space-y-2 ml-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Delivery Fees</span>
                    <span className="text-gray-900">({formatCurrency(plStatement.operatingExpenses.deliveryFees)})</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Marketing</span>
                    <span className="text-gray-900">({formatCurrency(plStatement.operatingExpenses.marketing)})</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Operations</span>
                    <span className="text-gray-900">({formatCurrency(plStatement.operatingExpenses.operations)})</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Salaries</span>
                    <span className="text-gray-900">({formatCurrency(plStatement.operatingExpenses.salaries)})</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Utilities</span>
                    <span className="text-gray-900">({formatCurrency(plStatement.operatingExpenses.utilities)})</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Other</span>
                    <span className="text-gray-900">({formatCurrency(plStatement.operatingExpenses.other)})</span>
                  </div>
                  <div className="flex justify-between font-semibold pt-2 border-t">
                    <span className="text-gray-900">Total Operating Expenses</span>
                    <span className="text-red-600">({formatCurrency(plStatement.operatingExpenses.total)})</span>
                  </div>
                </div>
              </div>

              {/* Net Profit */}
              <div className={`p-4 rounded-lg ${plStatement.netProfit >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-gray-900">Net Profit</span>
                  <span className={`font-bold text-2xl ${plStatement.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(plStatement.netProfit)}
                  </span>
                </div>
                <div className="text-sm text-gray-600">
                  Net Margin: {plStatement.netMargin.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
