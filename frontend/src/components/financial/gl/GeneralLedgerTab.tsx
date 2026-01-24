import React, { useState } from 'react';
import { AccountsList } from './AccountsList';
import { AccountLedger } from './AccountLedger';
import { JournalEntryModal } from './JournalEntryModal';

export const GeneralLedgerTab: React.FC = () => {
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
    const [isJournalModalOpen, setIsJournalModalOpen] = useState(false);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                <div>
                    <h3 className="text-lg font-bold text-indigo-900">General Ledger Control</h3>
                    <p className="text-sm text-indigo-700">
                        View full audit trails and perform manual accounting adjustments.
                    </p>
                </div>
                <button
                    onClick={() => setIsJournalModalOpen(true)}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
                >
                    <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="12 4v16m8-8H4" />
                    </svg>
                    Record Journal Entry
                </button>
            </div>

            {!selectedAccountId ? (
                <AccountsList onSelectAccount={setSelectedAccountId} />
            ) : (
                <AccountLedger
                    accountId={selectedAccountId}
                    onBack={() => setSelectedAccountId(null)}
                />
            )}

            <JournalEntryModal
                isOpen={isJournalModalOpen}
                onClose={() => setIsJournalModalOpen(false)}
                onSuccess={() => {
                    // Re-fetch logic would go here if we were using a centralized store for GL
                    // For now, the components handle their own state on mount
                    window.location.reload(); // Simple way to refresh all balances for now
                }}
            />
        </div>
    );
};
