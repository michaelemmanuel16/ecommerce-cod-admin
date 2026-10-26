import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Modal, Tag } from '../../ui-v2';
import { financialService } from '../../../services/financial.service';
import { journalBalance } from '../../../utils/journalBalance';
import { formatCurrency, todayYmd } from '../../../utils/format';
import { GuardedButtonV2 } from '../GuardedButtonV2';

interface Account {
    id: number;
    code: string;
    name: string;
}

interface JournalEntryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface TransactionLine {
    accountId: string;
    debitAmount: string;
    creditAmount: string;
}

const emptyLines = (): TransactionLine[] => [
    { accountId: '', debitAmount: '', creditAmount: '' },
    { accountId: '', debitAmount: '', creditAmount: '' },
];

/** New journal entry (finance.html #jeModal): date, reference and description, the lines, and a Debit / Credit total with its state. */
export const JournalEntryModal: React.FC<JournalEntryModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [description, setDescription] = useState('');
    const [entryDate, setEntryDate] = useState(todayYmd());
    const [lines, setLines] = useState<TransactionLine[]>(emptyLines);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setDescription('');
        setEntryDate(todayYmd());
        setLines(emptyLines());
        setError(null);
        financialService.getAllGLAccounts({ isActive: true, limit: 200 }).then(data => setAccounts(data.accounts));
    }, [isOpen]);

    const handleLineChange = (index: number, field: keyof TransactionLine, value: string) => {
        const newLines = [...lines];
        newLines[index] = { ...newLines[index], [field]: value };

        if (field === 'debitAmount' && parseFloat(value) > 0) {
            newLines[index].creditAmount = '';
        } else if (field === 'creditAmount' && parseFloat(value) > 0) {
            newLines[index].debitAmount = '';
        }

        setLines(newLines);
    };

    const addLine = () => {
        setLines([...lines, { accountId: '', debitAmount: '', creditAmount: '' }]);
    };

    const removeLine = (index: number) => {
        if (lines.length > 2) {
            setLines(lines.filter((_, i) => i !== index));
        }
    };

    const balance = journalBalance(lines);
    const { debits: totalDebits, credits: totalCredits } = balance;
    const isEmpty = totalDebits === 0 && totalCredits === 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!balance.canPost) {
            setError('Debits and credits must be equal, with an account on at least two lines.');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            await financialService.recordJournalEntry({
                description,
                entryDate,
                transactions: lines
                    .filter(l => parseFloat(l.debitAmount) > 0 || parseFloat(l.creditAmount) > 0)
                    .map(l => ({
                        accountId: parseInt(l.accountId),
                        debitAmount: parseFloat(l.debitAmount) || 0,
                        creditAmount: parseFloat(l.creditAmount) || 0,
                        description
                    }))
            });
            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.message || 'Failed to create journal entry');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            wide
            open={isOpen}
            onClose={onClose}
            title="New journal entry"
            description="Debits and credits must be equal before you can post."
            footer={
                <>
                    <span className="fnote">Needs at least two lines.</span>
                    <div className="r2">
                        <Button onClick={onClose}>Cancel</Button>
                        <GuardedButtonV2 type="submit" form="journal-entry-form" perm="postJournal" variant="primary" disabled={loading || !balance.canPost}>
                            {loading ? 'Posting...' : 'Post entry'}
                        </GuardedButtonV2>
                    </div>
                </>
            }
        >
            <form id="journal-entry-form" className="jeform fform" onSubmit={handleSubmit}>
                <div className="row3">
                    <Input label="Date" type="date" required value={entryDate} onChange={e => setEntryDate(e.target.value)} />
                    <Input label="Reference" readOnly placeholder="Assigned when you post" />
                    <Input label="Description" type="text" required placeholder="For example, Logiswift payout 11 Oct" value={description} onChange={e => setDescription(e.target.value)} />
                </div>

                <div className="tablewrap">
                    <table className="dt jelines">
                        <thead>
                            <tr>
                                <th>Account</th>
                                <th className="r" style={{ width: 150 }}>Debit</th>
                                <th className="r" style={{ width: 150 }}>Credit</th>
                                <th style={{ width: 44 }}><span className="sr-only">Remove</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((line, index) => (
                                <tr key={index}>
                                    <td>
                                        <select className="jsel" aria-label="Account" value={line.accountId} onChange={e => handleLineChange(index, 'accountId', e.target.value)}>
                                            <option value="">Select account</option>
                                            {accounts.map(acc => (
                                                <option key={acc.id} value={acc.id}>{acc.code} {acc.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td>
                                        <input className="jin" type="number" min="0" step="0.01" placeholder="0.00" aria-label="Debit" value={line.debitAmount} onChange={e => handleLineChange(index, 'debitAmount', e.target.value)} />
                                    </td>
                                    <td>
                                        <input className="jin" type="number" min="0" step="0.01" placeholder="0.00" aria-label="Credit" value={line.creditAmount} onChange={e => handleLineChange(index, 'creditAmount', e.target.value)} />
                                    </td>
                                    <td>
                                        <span className="rowact">
                                            <Button size="icon-sm" className="dng" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => removeLine(index)}><Trash2 /></Button>
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="jerow">
                    <Button onClick={addLine}><Plus />Add line</Button>
                    <span className="tot num">Debit <b>{formatCurrency(totalDebits)}</b> · Credit <b>{formatCurrency(totalCredits)}</b></span>
                    {isEmpty ? (
                        <Tag data-testid="journal-state">Empty</Tag>
                    ) : balance.difference === 0 ? (
                        <Tag tone="ok" data-testid="journal-state">Balanced</Tag>
                    ) : (
                        <Tag tone="bad" data-testid="journal-state">Out of balance by {formatCurrency(balance.difference)}</Tag>
                    )}
                </div>

                {error && <p role="alert" className="jeerr">{error}</p>}
            </form>
        </Modal>
    );
};
