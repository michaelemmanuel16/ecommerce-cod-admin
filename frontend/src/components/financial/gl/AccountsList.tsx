import React, { useState, useEffect, useCallback } from 'react';
import { financialService } from '../../../services/financial.service';
import { formatCurrency } from '../../../utils/format';
import { useFinancialStore } from '../../../stores/financialStore';

interface Account {
    id: number;
    code: string;
    name: string;
    accountType: string;
    normalBalance: 'debit' | 'credit';
    currentBalance: number;
    isActive: boolean;
    periodActivity: { debits: number; credits: number } | null;
}

interface AccountsListProps {
    onSelectAccount: (accountId: number) => void;
    refreshKey?: number;
}

export const AccountsList: React.FC<AccountsListProps> = ({ onSelectAccount, refreshKey = 0 }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const { dateRange } = useFinancialStore();

    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 });

    const fetchAccounts = useCallback(async () => {
        try {
            if (accounts.length > 0) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }
            const data = await financialService.getAllGLAccounts({
                page: pagination.page,
                limit: pagination.limit,
                startDate: dateRange.startDate,
                endDate: dateRange.endDate
            });
            setAccounts(data.accounts);
            setPagination(prev => ({ ...prev, total: data.pagination.total, pages: data.pagination.pages }));
            setError(null);
        } catch (err: any) {
            setError('Failed to load chart of accounts');
            console.error(err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [pagination.page, pagination.limit, dateRange.startDate, dateRange.endDate]);

    useEffect(() => {
        fetchAccounts();
    }, [fetchAccounts, refreshKey]);

    const filteredAccounts = accounts.filter(
        acc =>
            acc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            acc.code.includes(searchTerm)
    );

    const getAccountTypeBadge = (type: string) => {
        const colors: Record<string, string> = {
            asset: 'bg-blue-100 text-blue-800',
            liability: 'bg-red-100 text-red-800',
            equity: 'bg-purple-100 text-purple-800',
            revenue: 'bg-green-100 text-green-800',
            expense: 'bg-orange-100 text-orange-800'
        };
        return (
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[type] || 'bg-gray-100 text-gray-800'}`}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
            </span>
        );
    };

    // Only show absolute loading state on initial mount with no data
    if (loading && accounts.length === 0) {
        return (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
                <p className="text-gray-600 font-medium">Loading Chart of Accounts...</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Chart of Accounts</h2>
                    <div className="flex items-center space-x-4">
                        {refreshing && (
                            <span className="text-xs text-gray-500 animate-pulse flex items-center">
                                <svg className="animate-spin h-3 w-3 mr-1 text-indigo-500" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Refreshing...
                            </span>
                        )}
                        <button
                            onClick={fetchAccounts}
                            disabled={refreshing || loading}
                            className={`text-sm font-semibold transition-colors ${refreshing || loading
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-indigo-600 hover:text-indigo-900'
                                }`}
                        >
                            Refresh
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-md flex items-center justify-between">
                        <p className="text-sm text-red-700 font-medium">{error}</p>
                        <button
                            onClick={fetchAccounts}
                            className="text-xs font-bold text-red-700 underline hover:no-underline"
                        >
                            Try Again
                        </button>
                    </div>
                )}

                <div className="relative">
                    <input
                        type="text"
                        placeholder="Search accounts by name or code..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                </div>
            </div>

            <div className={`overflow-x-auto transition-opacity duration-200 ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Current Balance</th>
                            {dateRange.startDate && (
                                <th className="px-6 py-3 text-right text-xs font-medium text-indigo-500 uppercase tracking-wider">Period Activity</th>
                            )}
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredAccounts.map((account) => {
                            const activity = account.periodActivity;
                            const netChange = activity ? activity.debits - activity.credits : 0;
                            return (
                                <tr key={account.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">{account.code}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{account.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">{getAccountTypeBadge(account.accountType)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                                        {formatCurrency(account.currentBalance)}
                                    </td>
                                    {dateRange.startDate && (
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold">
                                            {activity && (activity.debits > 0 || activity.credits > 0) ? (
                                                <span className={netChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                    {netChange >= 0 ? '+' : ''}{formatCurrency(netChange)}
                                                    <span className="block text-xs font-normal text-gray-400">
                                                        DR {formatCurrency(activity.debits)} / CR {formatCurrency(activity.credits)}
                                                    </span>
                                                </span>
                                            ) : (
                                                <span className="text-gray-300">—</span>
                                            )}
                                        </td>
                                    )}
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => onSelectAccount(account.id)}
                                            className="text-indigo-600 hover:text-indigo-900"
                                        >
                                            View Ledger
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredAccounts.length === 0 && !loading && (
                            <tr>
                                <td colSpan={dateRange.startDate ? 6 : 5} className="px-6 py-10 text-center text-gray-500 font-medium">
                                    No accounts found matching your search.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {pagination.pages > 1 && (
                <div className="p-4 border-t border-gray-200 flex items-center justify-between bg-gray-50 rounded-b-lg">
                    <div className="text-sm text-gray-700">
                        Showing page <span className="font-semibold">{pagination.page}</span> of <span className="font-semibold">{pagination.pages}</span> ({pagination.total} total accounts)
                    </div>
                    <div className="flex space-x-2">
                        <button
                            onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                            disabled={pagination.page === 1 || loading}
                            className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Previous
                        </button>
                        <button
                            onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.pages, prev.page + 1) }))}
                            disabled={pagination.page === pagination.pages || loading}
                            className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
