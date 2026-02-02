import React, { useState, useEffect } from 'react';
import { financialService } from '../../../services/financial.service';

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
    description: string;
}

export const JournalEntryModal: React.FC<JournalEntryModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [description, setDescription] = useState('');
    const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
    const [lines, setLines] = useState<TransactionLine[]>([
        { accountId: '', debitAmount: '0', creditAmount: '0', description: '' },
        { accountId: '', debitAmount: '0', creditAmount: '0', description: '' }
    ]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            financialService.getAllGLAccounts({ isActive: true }).then(data => setAccounts(data.accounts));
        }
    }, [isOpen]);

    const handleLineChange = (index: number, field: keyof TransactionLine, value: string) => {
        const newLines = [...lines];
        newLines[index] = { ...newLines[index], [field]: value };

        if (field === 'debitAmount' && parseFloat(value) > 0) {
            newLines[index].creditAmount = '0';
        } else if (field === 'creditAmount' && parseFloat(value) > 0) {
            newLines[index].debitAmount = '0';
        }

        setLines(newLines);
    };

    const addLine = () => {
        setLines([...lines, { accountId: '', debitAmount: '0', creditAmount: '0', description: '' }]);
    };

    const removeLine = (index: number) => {
        if (lines.length > 2) {
            setLines(lines.filter((_, i) => i !== index));
        }
    };

    const totalDebits = lines.reduce((sum, line) => sum + (parseFloat(line.debitAmount) || 0), 0);
    const totalCredits = lines.reduce((sum, line) => sum + (parseFloat(line.creditAmount) || 0), 0);
    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.001 && totalDebits > 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isBalanced) {
            setError('Journal entry must be balanced (Total Debits = Total Credits)');
            return;
        }

        setLoading(true);
        try {
            await financialService.recordJournalEntry({
                description,
                entryDate,
                transactions: lines.map(l => ({
                    accountId: parseInt(l.accountId),
                    debitAmount: parseFloat(l.debitAmount),
                    creditAmount: parseFloat(l.creditAmount),
                    description: l.description || description
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h3 className="text-xl font-bold text-gray-900">New Journal Entry</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-2 gap-6 mb-8">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Entry Date</label>
                            <input
                                type="date"
                                required
                                className="w-full border border-gray-300 rounded-md p-2 focus:ring-indigo-500"
                                value={entryDate}
                                onChange={e => setEntryDate(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Main Description</label>
                            <input
                                type="text"
                                required
                                placeholder="e.g. Monthly interest adjustment"
                                className="w-full border border-gray-300 rounded-md p-2 focus:ring-indigo-500"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="mb-4">
                        <h4 className="text-md font-semibold text-gray-800 mb-2">Transaction Lines</h4>
                        <div className="space-y-3">
                            {lines.map((line, index) => (
                                <div key={index} className="flex gap-3 items-start p-3 bg-gray-50 rounded-lg">
                                    <div className="flex-1">
                                        <select
                                            required
                                            className="w-full text-sm border border-gray-300 rounded-md p-2"
                                            value={line.accountId}
                                            onChange={e => handleLineChange(index, 'accountId', e.target.value)}
                                        >
                                            <option value="">Select Account</option>
                                            {accounts.map(acc => (
                                                <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="w-32">
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="w-full text-sm border border-gray-300 rounded-md p-2 text-right"
                                            placeholder="Debit"
                                            value={line.debitAmount}
                                            onChange={e => handleLineChange(index, 'debitAmount', e.target.value)}
                                        />
                                    </div>
                                    <div className="w-32">
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="w-full text-sm border border-gray-300 rounded-md p-2 text-right"
                                            placeholder="Credit"
                                            value={line.creditAmount}
                                            onChange={e => handleLineChange(index, 'creditAmount', e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <input
                                            type="text"
                                            className="w-full text-sm border border-gray-300 rounded-md p-2"
                                            placeholder="Line description (optional)"
                                            value={line.description}
                                            onChange={e => handleLineChange(index, 'description', e.target.value)}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeLine(index)}
                                        className="mt-2 text-red-400 hover:text-red-600"
                                    >
                                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={addLine}
                            className="mt-4 text-indigo-600 hover:text-indigo-900 text-sm font-semibold flex items-center"
                        >
                            <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add Transaction Line
                        </button>
                    </div>

                    <div className="mt-8 border-t border-gray-200 pt-4 flex justify-end">
                        <div className="grid grid-cols-2 gap-x-8 text-right bg-gray-50 px-6 py-4 rounded-xl">
                            <span className="text-gray-500 font-medium">Total Debits:</span>
                            <span className="font-bold text-gray-900">${totalDebits.toFixed(2)}</span>
                            <span className="text-gray-500 font-medium">Total Credits:</span>
                            <span className="font-bold text-gray-900">${totalCredits.toFixed(2)}</span>
                            <div className="col-span-2 border-t border-gray-200 mt-2 pt-2">
                                <span className={`text-sm font-bold ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
                                    {isBalanced ? '✓ Balanced' : `⚠ Out of balance: $${Math.abs(totalDebits - totalCredits).toFixed(2)}`}
                                </span>
                            </div>
                        </div>
                    </div>

                    {error && <p className="mt-4 text-red-600 text-center text-sm font-semibold">{error}</p>}

                    <div className="mt-8 flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !isBalanced}
                            className="px-8 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-all font-bold"
                        >
                            {loading ? 'Posting...' : 'Post Journal Entry'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
