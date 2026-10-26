import React, { useState, useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { Button, Card, Skeleton, Tag } from '../../ui-v2';
import { BlockError } from '../../../pages/dashboard/blocks/Frame';
import { financialService, AccountLedgerResponse, LedgerLine } from '../../../services/financial.service';
import { formatCurrency, formatDate, todayYmd } from '../../../utils/format';
import { downloadBlob } from '../../../utils/downloadBlob';
import { useFinancialStore } from '../../../stores/financialStore';
import { GuardedButtonV2 } from '../GuardedButtonV2';
import { VoidJournalModal } from './VoidJournalModal';

interface AccountLedgerProps {
    accountId: number;
    /** From the chart of accounts: the ledger answer does not carry it. */
    accountType?: string;
    refreshKey?: number;
}

const TYPE_NAMES: Record<string, string> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue', expense: 'Expense' };

/** The ledger of one account (finance.html #ledBody): date, entry, description, debit, credit and the running balance. */
export const AccountLedger: React.FC<AccountLedgerProps> = ({ accountId, accountType, refreshKey = 0 }) => {
    const [data, setData] = useState<LedgerLine[]>([]);
    const [account, setAccount] = useState<AccountLedgerResponse['account'] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const { dateRange } = useFinancialStore();
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [voiding, setVoiding] = useState<{ id: number; entryNumber: string } | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const exportAbort = useRef<AbortController | null>(null);

    // Leaving the screen cancels a running export
    useEffect(() => () => exportAbort.current?.abort(), []);

    // Another account starts again at the first page
    useEffect(() => {
        setPage(1);
    }, [accountId]);

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
            setError(false);
        } catch (err) {
            setError(true);
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
            setNotice('The ledger could not be exported. Try again.');
            return;
        } finally {
            if (!abort.signal.aborted) setExporting(false);
        }
        setNotice(null);
    };

    if (error && !account) return <BlockError name="Account ledger" onRetry={fetchLedger} />;
    if (!account) return <div aria-busy="true" aria-label="Loading Account ledger"><Skeleton height={420} className="skelcard" /></div>;

    const kind = accountType ? TYPE_NAMES[accountType] : undefined;
    const money = (n: number) => (n > 0 ? formatCurrency(n) : '');
    return (
        <Card
            title={`${account.code} · ${account.name}`}
            aside={
                <span className="ctact">
                    {kind ? `${kind} account` : 'Account'}
                    <Button size="mini" onClick={handleExport} disabled={exporting}><Download />Export CSV</Button>
                </span>
            }
        >
            {notice && <p role="status" className="note">{notice}</p>}
            <div className={`tablewrap${loading ? ' finbusy' : ''}`}>
                <table className="dt" aria-label="Account ledger">
                    <thead>
                        <tr>
                            <th>Date</th><th>Entry</th><th>Description</th>
                            <th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th>
                            <th><span className="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((txn) => (
                            <tr key={txn.id}>
                                <td>{formatDate(txn.journalEntry.entryDate, 'd MMM yyyy')}</td>
                                <td><Tag>{txn.journalEntry.entryNumber}</Tag></td>
                                <td className="desc">{txn.description || txn.journalEntry.description}</td>
                                <td className="r num">{money(txn.debitAmount)}</td>
                                <td className="r num">{money(txn.creditAmount)}</td>
                                <td className="r num"><b>{formatCurrency(txn.runningBalance)}</b></td>
                                <td className="r">
                                    {txn.journalEntry.isVoided ? (
                                        <span className="ink3">Voided</span>
                                    ) : txn.journalEntry.voidableByHand ? (
                                        <GuardedButtonV2
                                            perm="voidJournal"
                                            size="mini"
                                            onClick={() => setVoiding({ id: txn.journalEntry.id, entryNumber: txn.journalEntry.entryNumber })}
                                        >
                                            Void
                                        </GuardedButtonV2>
                                    ) : null}
                                </td>
                            </tr>
                        ))}
                        {data.length === 0 && !loading && (
                            <tr><td colSpan={7} className="ledempty">No transactions found for this period.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            {totalPages > 1 && (
                <div className="ledfoot">
                    <span>Page {page} of {totalPages}</span>
                    <span className="sp">
                        <Button size="mini" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                        <Button size="mini" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                    </span>
                </div>
            )}
            <VoidJournalModal
                entry={voiding}
                onClose={() => setVoiding(null)}
                onVoided={() => { setVoiding(null); fetchLedger(); }}
            />
        </Card>
    );
};
