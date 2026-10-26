import React, { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
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

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!entry) return;
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
        <Modal closeOnEscape isOpen={!!entry} onClose={onClose} title={`Void ${entry?.entryNumber ?? ''}`} size="sm">
            <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-gray-600">A reversing entry is posted. The original stays in the ledger, marked as voided.</p>
                <div>
                    <label htmlFor="void-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                    <textarea id="void-reason" required minLength={3} maxLength={500} rows={3} value={reason}
                        onChange={(e) => setReason(e.target.value)} className="w-full border border-gray-300 rounded-md p-2" />
                </div>
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 3}>{busy ? 'Voiding...' : 'Void entry'}</Button>
                </div>
            </form>
        </Modal>
    );
};
