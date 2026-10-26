import React, { useState } from 'react';
import { financialService } from '../../../services/financial.service';

interface VoidJournalModalProps {
    entry: { id: number; entryNumber: string } | null;
    onClose: () => void;
    onVoided: () => void;
}

/** Asks for the reason, then reverses a hand-made entry (F-920). The server refuses an automatic posting with a message that says where to undo it. */
export const VoidJournalModal: React.FC<VoidJournalModalProps> = ({ entry, onClose, onVoided }) => {
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!entry) return null;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await financialService.voidJournalEntry(entry.id, reason.trim());
            setReason('');
            onVoided();
        } catch (err: any) {
            setError(err.response?.data?.message || err.response?.data?.error || 'Failed to void the entry');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="Void journal entry">
            <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose}></div>
            <form onSubmit={submit} className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Void {entry.entryNumber}</h3>
                <p className="text-sm text-gray-600">A reversing entry is posted. The original stays in the ledger, marked as voided.</p>
                <div>
                    <label htmlFor="void-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                    <textarea id="void-reason" required minLength={3} maxLength={500} rows={3} value={reason}
                        onChange={(e) => setReason(e.target.value)} className="w-full border border-gray-300 rounded-md p-2" />
                </div>
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button type="submit" disabled={busy || reason.trim().length < 3} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                        {busy ? 'Voiding...' : 'Void entry'}
                    </button>
                </div>
            </form>
        </div>
    );
};
