import React, { useState, useEffect, useRef } from 'react';
import { financialService, AccountLedgerResponse, LedgerLine } from '../../../services/financial.service';
import { formatCurrency, formatDate, todayYmd } from '../../../utils/format';
import { downloadBlob } from '../../../utils/downloadBlob';
import { useFinancialStore } from '../../../stores/financialStore';
import { GuardedButton } from '../GuardedButton';
import { VoidJournalModal } from './VoidJournalModal';


interface AccountLedgerProps {
    accountId: number;
    onBack: () => void;
    refreshKey?: number;
}

export const AccountLedger: React.FC<AccountLedgerProps> = ({ accountId, onBack, refreshKey = 0 }) => {
    const [data, setData] = useState<LedgerLine[]>([]);
    const [account, setAccount] = useState<AccountLedgerResponse['account'] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { dateRange } = useFinancialStore();
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [voiding, setVoiding] = useState<{ id: number; entryNumber: string } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const exportAbort = useRef<AbortController | null>(null);

    // Leaving the screen cancels a running export
    useEffect(() => () => exportAbort.current?.abort(), []);

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
            setTotalPages(res.pagination.pages);
            setError(null);
        } catch (err) {
            setError('Failed to load ledger data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async () => {
        const abort = new AbortController();
        exportAbort.current = abort;
        setExporting(true);
        try {
            const { startDate, endDate } = dateRange;
            const { blob, filename } = await financialService.exportAccountLedger(accountId, { startDate, endDate }, {
                signal: abort.signal,
                onQueued: () => setNotice('This ledger is large. The file is being prepared; it downloads when ready.'),
            });
            downloadBlob(blob, filename ?? `ledger-${account?.code}-${todayYmd()}.csv`);
        } catch (err) {
            if (abort.signal.aborted) return; // the user left the screen
            console.error('Export failed', err);
            alert('Failed to export ledger');
        } finally {
            setNotice(null);
            if (!abort.signal.aborted) setExporting(false);
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
                            {account && account.isActive === false && (
                                <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-200 text-gray-600 align-middle">Inactive</span>
                            )}
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
                        disabled={exporting}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Export CSV
                    </button>
                </div>
            </div>

            {notice && <p role="status" className="px-4 py-2 text-sm text-indigo-700 bg-indigo-50">{notice}</p>}

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Debit</th>
                            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Credit</th>
                            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance</th>
                            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Entry</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.map((txn) => (
                            <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-600">
                                    {formatDate(txn.journalEntry.entryDate)}
                                </td>
                                <td className="px-3 py-4 max-w-[10rem]">
                                    <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700 break-all">
                                        {txn.journalEntry.entryNumber}
                                    </span>
                                    <span className="text-xs text-indigo-600 block mt-1">{txn.journalEntry.sourceType}</span>
                                </td>
                                <td className="px-3 py-4 text-sm text-gray-900 min-w-[10rem] whitespace-normal break-words">
                                    {txn.description || txn.journalEntry.description}
                                </td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">
                                    {txn.debitAmount > 0 ? formatCurrency(txn.debitAmount) : '-'}
                                </td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-medium">
                                    {txn.creditAmount > 0 ? formatCurrency(txn.creditAmount) : '-'}
                                </td>
                                <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-gray-900 font-bold">
                                    {formatCurrency(txn.runningBalance)}
                                </td>
                                <td className="px-3 py-4 whitespace-nowrap text-right text-sm">
                                    {txn.journalEntry.isVoided ? (
                                        <span className="text-xs text-gray-500">Voided</span>
                                    ) : txn.journalEntry.voidableByHand ? (
                                        <GuardedButton
                                            perm="voidJournal"
                                            variant="ghost"
                                            size="sm"
                                            className="text-red-600 hover:text-red-800"
                                            onClick={() => setVoiding({ id: txn.journalEntry.id, entryNumber: txn.journalEntry.entryNumber })}
                                        >
                                            Void
                                        </GuardedButton>
                                    ) : null}
                                </td>
                            </tr>
                        ))}
                        {data.length === 0 && (
                            <tr>
                                <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
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
            <VoidJournalModal
                entry={voiding}
                onClose={() => setVoiding(null)}
                onVoided={() => { setVoiding(null); fetchLedger(); }}
            />
        </div>
    );
};
