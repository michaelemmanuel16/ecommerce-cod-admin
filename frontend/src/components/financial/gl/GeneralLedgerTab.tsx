import React, { useState } from 'react';
import { AccountsList } from './AccountsList';
import { AccountLedger } from './AccountLedger';

interface GeneralLedgerTabProps {
    /** Changes after a journal entry is posted or voided, so the chart and the ledger load again. */
    refreshKey?: number;
}

/** General ledger (finance.html #a-gl): the chart of accounts beside the ledger of the picked account. */
export const GeneralLedgerTab: React.FC<GeneralLedgerTabProps> = ({ refreshKey = 0 }) => {
    const [selected, setSelected] = useState<{ id: number; accountType: string } | null>(null);

    return (
        <div className="grid glgrid">
            <AccountsList selectedId={selected?.id ?? null} onSelectAccount={setSelected} refreshKey={refreshKey} />
            {/* keyed by account: a pick starts a fresh ledger on page 1, so it makes one request */}
            {selected && <AccountLedger key={selected.id} accountId={selected.id} accountType={selected.accountType} refreshKey={refreshKey} />}
        </div>
    );
};
