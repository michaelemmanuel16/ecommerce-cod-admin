import React, { useEffect } from 'react';
import { Card, Skeleton, Tag } from '../../ui-v2';
import { BlockError } from '../../../pages/dashboard/blocks/Frame';
import { useBlock } from '../../../pages/financial/profit/useBlock';
import { financialService } from '../../../services/financial.service';
import { formatCurrency } from '../../../utils/format';
import { useFinancialStore } from '../../../stores/financialStore';

interface Account {
    id: number;
    code: string;
    name: string;
    accountType: string;
    currentBalance: number;
    isActive: boolean;
}

interface AccountsListProps {
    selectedId: number | null;
    onSelectAccount: (account: { id: number; accountType: string }) => void;
    refreshKey?: number;
}

/** Group titles of the chart of accounts, in the order the books read (finance.html #coa). */
const GROUPS: Array<[string, string]> = [['asset', 'Assets'], ['liability', 'Liabilities'], ['equity', 'Equity'], ['revenue', 'Revenue'], ['expense', 'Expenses']];

/** The chart of accounts card: live codes and balances grouped by type, the trial balance line, and a pick that opens the ledger. */
export const AccountsList: React.FC<AccountsListProps> = ({ selectedId, onSelectAccount, refreshKey = 0 }) => {
    const { dateRange } = useFinancialStore();
    // Both answers are cached, so coming back to General ledger does not ask again; a posted entry (refreshKey) does
    const chart = useBlock(`gl:accounts|${refreshKey}`, () => financialService.getAllGLAccounts({ limit: 200 }));
    const trialBalance = useBlock(`gl:trial|${dateRange.endDate ?? ''}|${refreshKey}`, () => financialService.getTrialBalance({ endDate: dateRange.endDate }));
    const accounts: Account[] | undefined = chart.data?.accounts;
    const trial = trialBalance.status === 'failed' ? undefined : trialBalance.data;

    // The first account opens its ledger, so the ledger card is never empty
    useEffect(() => {
        if (selectedId === null && accounts && accounts.length > 0) onSelectAccount(accounts[0]);
    }, [accounts, selectedId, onSelectAccount]);

    if (chart.status === 'failed' && !accounts) return <BlockError name="Chart of accounts" onRetry={chart.retry} />;
    if (!accounts) {
        return <div aria-busy="true" aria-label="Loading Chart of accounts"><Skeleton height={420} className="skelcard" /></div>;
    }

    return (
        <Card title="Chart of accounts" aside="Pick an account">
            <div className="coa">
                {accounts.length === 0 && <p className="note">No accounts yet.</p>}
                {GROUPS.map(([type, title]) => {
                    const rows = accounts.filter((a) => a.accountType === type);
                    if (rows.length === 0) return null;
                    return (
                        <React.Fragment key={type}>
                            <div className="coa-grp">{title}</div>
                            {rows.map((a) => (
                                <button key={a.id} type="button" className={`coa-row${a.id === selectedId ? ' on' : ''}`} aria-pressed={a.id === selectedId} onClick={() => onSelectAccount(a)}>
                                    <span className="code">{a.code}</span>
                                    {a.name}
                                    {!a.isActive && <Tag>Inactive</Tag>}
                                    <b>{formatCurrency(a.currentBalance)}</b>
                                </button>
                            ))}
                        </React.Fragment>
                    );
                })}
            </div>
            {trial && (
                <p className="note" data-testid="trial-balance">
                    Trial balance: debits <b className="num ink">{formatCurrency(trial.totalDebits)}</b>, credits <b className="num ink">{formatCurrency(trial.totalCredits)}</b>.{' '}
                    <Tag tone={trial.balanced ? 'ok' : 'bad'}>{trial.balanced ? 'Balanced' : 'Out of balance'}</Tag>
                </p>
            )}
        </Card>
    );
};
