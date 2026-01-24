import React, { useState, useEffect } from 'react';
import { financialService } from '../../../services/financial.service';
import { formatCurrency, formatDate } from '../../../utils/format';
import { useFinancialStore } from '../../../stores/financialStore';

interface LedgerTransaction {
    id: number;
    accountId: number;
    debitAmount: number;
    creditAmount: number;
    runningBalance: number;
    description: string;
    createdAt: string;
    journalEntry: {
        entryNumber: string;
        entryDate: string;
        description: string;
        sourceType: string;
    };
}

interface AccountInfo {
    id: number;
    code: string;
    name: string;
    normalBalance: string;
    currentBalance: number;
}

interface AccountLedgerProps {
    accountId: number;
    onBack: () => void;
    refreshKey?: number;
}

export const AccountLedger: React.FC<AccountLedgerProps> = ({ accountId, onBack, refreshKey = 0 }) => {
    const [data, setData] = useState<LedgerTransaction[]>([]);
    const [account, setAccount] = useState<AccountInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { dateRange } = useFinancialStore();
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    useEffect(() => {
        fetchLedger();
    }, [accountId, dateRange, page, refreshKey]);

    const fetchLedger = async () => {
        try {
            setLoading(true);
            const { startDate, endDate } = dateRange;
            const res = await financialService.getAccountLedger(accountId, {
                startDate,
                endDate,
                page,
                limit: 20
            });
            setData(res.transactions);
            setAccount(res.account);
            setTotalPages(res.pagination.totalPages);
            setError(null);
        } catch (err) {
            setError('Failed to load ledger data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async () => {
        try {
            const { startDate, endDate } = dateRange;
            // For export, we still need the raw apiClient for blob response, 
            // but the financialService should ideally handle it.
            // Using financialService would require another method that returns blob.
            // For now, I'll just use the direct URL with the same token logic if I had access to apiClient.
            // Actually, financialService.exportAccountLedgerToCSV (wait, I didn't add that)
            // Let's use a simple approach for now or add it to financialService.

            // I'll add getAccountLedgerExport to financialService.
            const response = await financialService.getAccountLedgerExport(accountId, { startDate, endDate });

            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `ledger-${account?.code}-${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.error('Export failed', err);
            alert('Failed to export ledger');
        }
    };

    if (loading && page === 1) return <div className="p-8 text-center">Loading ledger...</div>;
    if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50 rounded-t-lg">
                <div className="flex items-center space-x-4">
                    <button
                        onClick={onBack}
                        className="p-1 hover:bg-gray-200 rounded-full transition-colors"
                    >
                        <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">
                            {account?.code} - {account?.name}
                        </h2>
                        <p className="text-sm text-gray-500">
                            Detailed transaction ledger and audit trail
                        </p>
                    </div>
                </div>
                <div className="flex items-center space-x-3">
                    <div className="text-right mr-4">
                        <span className="text-xs text-gray-500 block uppercase font-semibold">Current Balance</span>
                        <span className="text-lg font-bold text-indigo-700">{formatCurrency(account?.currentBalance || 0)}</span>
                    </div>
                    <button
                        onClick={handleExport}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                    >
                        <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Export CSV
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Debit</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Credit</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.map((txn) => (
                            <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                    {formatDate(txn.journalEntry.entryDate)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700">
                                        {txn.journalEntry.entryNumber}
                                    </span>
                                    <span className="ml-2 text-xs text-indigo-600 block">{txn.journalEntry.sourceType}</span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-900 max-w-md truncate">
                                    {txn.description || txn.journalEntry.description}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">
                                    {txn.debitAmount > 0 ? formatCurrency(txn.debitAmount) : '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">
                                    {txn.creditAmount > 0 ? formatCurrency(txn.creditAmount) : '-'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-bold">
                                    {formatCurrency(txn.runningBalance)}
                                </td>
                            </tr>
                        ))}
                        {data.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-10 text-center text-gray-500">
                                    No transactions found for this period.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="p-4 border-t border-gray-200 flex items-center justify-between">
                    <div className="text-sm text-gray-700">
                        Showing Page {page} of {totalPages}
                    </div>
                    <div className="flex space-x-2">
                        <button
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-50"
                        >
                            Previous
                        </button>
                        <button
                            disabled={page === totalPages}
                            onClick={() => setPage(p => p + 1)}
                            className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
