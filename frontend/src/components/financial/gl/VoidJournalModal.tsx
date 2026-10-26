import React, { useState } from 'react';
import { Button, Modal } from '../../ui-v2';
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
        <Modal
            open={!!entry}
            onClose={onClose}
            title={`Void ${entry?.entryNumber ?? ''}`}
            description="A reversing entry is posted. The original stays in the ledger, marked as voided."
            footer={
                <>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button type="submit" form="void-journal-form" variant="danger" disabled={busy || reason.trim().length < 3}>{busy ? 'Voiding...' : 'Void entry'}</Button>
                </>
            }
        >
            <form id="void-journal-form" onSubmit={submit} className="fform">
                <div className="fl">
                    <label htmlFor="void-reason">Reason</label>
                    <textarea id="void-reason" required minLength={3} maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                {error && <p role="alert" className="err">{error}</p>}
            </form>
        </Modal>
    );
};
