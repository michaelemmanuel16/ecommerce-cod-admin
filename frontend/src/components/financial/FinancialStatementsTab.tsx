import React, { useState, useEffect } from 'react';
import { useFinancialStore } from '../../stores/financialStore';
import { Card } from '../ui/Card';
import { formatCurrency } from '../../utils/format';
import { FileText, Download, Calendar, RefreshCw, Layers, PieChart } from 'lucide-react';
import { Tabs } from '../ui/Tabs';

export const FinancialStatementsTab: React.FC = () => {
    const [activeStatement, setActiveStatement] = useState<'balance-sheet' | 'profit-loss'>('profit-loss');
    const {
        balanceSheet,
        profitLoss,
        loadingStates,
        dateRange,
        fetchBalanceSheet,
        fetchProfitLoss
    } = useFinancialStore();

    useEffect(() => {
        if (activeStatement === 'balance-sheet') {
            fetchBalanceSheet(dateRange.endDate);
        } else {
            fetchProfitLoss(dateRange.startDate || new Date(new Date().getFullYear(), 0, 1).toISOString(), dateRange.endDate || new Date().toISOString());
        }
    }, [activeStatement, dateRange.startDate, dateRange.endDate]);

    const renderAccountRow = (name: string, balance: number, isSubtotal: boolean = false) => (
        <div key={name} className={`flex justify-between py-2 ${isSubtotal ? 'font-bold border-t border-gray-200 mt-1' : 'text-gray-700'}`}>
            <span>{name}</span>
            <span className={balance < 0 ? 'text-red-600' : ''}>{formatCurrency(balance)}</span>
        </div>
    );

    const renderBalanceSheet = () => {
        if (!balanceSheet) return null;

        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                        <Layers className="w-5 h-5 mr-2 text-blue-600" />
                        Assets
                    </h3>
                    <div className="space-y-1">
                        {balanceSheet.assets.accounts.map(acc => renderAccountRow(acc.name, acc.balance))}
                        {renderAccountRow('Total Assets', balanceSheet.assets.total, true)}
                    </div>
                </Card>

                <div className="space-y-6">
                    <Card className="p-6">
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                            <PieChart className="w-5 h-5 mr-2 text-purple-600" />
                            Liabilities & Equity
                        </h3>

                        <div className="mb-6">
                            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Liabilities</h4>
                            <div className="space-y-1">
                                {balanceSheet.liabilities.accounts.map(acc => renderAccountRow(acc.name, acc.balance))}
                                {renderAccountRow('Total Liabilities', balanceSheet.liabilities.total, true)}
                            </div>
                        </div>

                        <div>
                            <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Equity</h4>
                            <div className="space-y-1">
                                {balanceSheet.equity.accounts.map(acc => renderAccountRow(acc.name, acc.balance))}
                                {renderAccountRow('Retained Earnings', balanceSheet.equity.retainedEarnings)}
                                {renderAccountRow('Total Equity', balanceSheet.equity.total, true)}
                            </div>
                        </div>

                        <div className="mt-8 pt-4 border-t-2 border-gray-900">
                            {renderAccountRow('Total Liabilities & Equity', balanceSheet.totalLiabilitiesAndEquity, true)}
                        </div>
                    </Card>

                    {!balanceSheet.isBalanced && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                            Warning: The balance sheet is currently out of balance. Please check your GL entries.
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderProfitLoss = () => {
        if (!profitLoss) return null;

        return (
            <div className="space-y-6">
                <Card className="p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                        <FileText className="w-5 h-5 mr-2 text-green-600" />
                        Net Income
                    </h3>

                    <div className="mb-6">
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Revenue</h4>
                        <div className="space-y-1">
                            {profitLoss.revenue.accounts.map(acc => renderAccountRow(acc.name, acc.balance))}
                            {renderAccountRow('Total Revenue', profitLoss.revenue.total, true)}
                        </div>
                    </div>

                    <div className="mb-6">
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Cost of Goods Sold</h4>
                        <div className="space-y-1">
                            {profitLoss.cogs.accounts.map(acc => renderAccountRow(acc.name, acc.balance))}
                            {renderAccountRow('Total COGS', profitLoss.cogs.total, true)}
                        </div>
                    </div>

                    <div className="mb-8 p-4 bg-gray-50 rounded-lg">
                        {renderAccountRow('Gross Profit', profitLoss.grossProfit, true)}
                        <div className="flex justify-between text-sm text-gray-600 mt-1">
                            <span>Gross Margin</span>
                            <span>{profitLoss.grossMarginPercentage.toFixed(1)}%</span>
                        </div>
                    </div>

                    <div className="mb-6">
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Operating Expenses</h4>
                        <div className="space-y-1">
                            {profitLoss.expenses.accounts.map(acc => renderAccountRow(acc.name, acc.balance))}
                            {renderAccountRow('Total Operating Expenses', profitLoss.expenses.total, true)}
                        </div>
                    </div>

                    <div className="mt-8 pt-4 border-t-2 border-gray-900">
                        {renderAccountRow('Net Income', profitLoss.netIncome, true)}
                        <div className="flex justify-between text-sm text-gray-600 mt-1">
                            <span>Net Margin</span>
                            <span>{profitLoss.netMarginPercentage.toFixed(1)}%</span>
                        </div>
                    </div>
                </Card>
            </div>
        );
    };

    const statementTabs = [
        { id: 'profit-loss', label: 'Profit & Loss (P&L)', icon: FileText },
        { id: 'balance-sheet', label: 'Balance Sheet', icon: Layers },
    ];

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                <div className="flex space-x-2">
                    {statementTabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveStatement(tab.id as any)}
                            className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeStatement === tab.id
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                }`}
                        >
                            <tab.icon className="w-4 h-4 mr-2" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="flex space-x-3">
                    <button
                        className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        onClick={() => activeStatement === 'balance-sheet' ? fetchBalanceSheet(dateRange.endDate) : fetchProfitLoss(dateRange.startDate!, dateRange.endDate!)}
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${loadingStates.statements ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                    <button className="flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700">
                        <Download className="w-4 h-4 mr-2" />
                        Export PDF
                    </button>
                </div>
            </div>

            {loadingStates.statements ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            ) : (
                activeStatement === 'balance-sheet' ? renderBalanceSheet() : renderProfitLoss()
            )}
        </div>
    );
};
