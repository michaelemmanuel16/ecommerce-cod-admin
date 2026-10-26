import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { GeneralLedgerTab } from '../../components/financial/gl/GeneralLedgerTab';
import { JournalEntryModal } from '../../components/financial/gl/JournalEntryModal';
import { GuardedButtonV2 } from '../../components/financial/GuardedButtonV2';
import { StatementsPanel } from './profit/StatementsPanel';
import { ProductProfitPanel } from './profit/ProductProfitPanel';
import { ExpenseManagementTab } from '../../components/financial/ExpenseManagementTab';

type Section = 'gl' | 'statements' | 'profitability' | 'expenses';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'gl', label: 'General ledger' },
  { id: 'statements', label: 'Statements' },
  { id: 'profitability', label: 'Profit by product' },
  { id: 'expenses', label: 'Expenses' },
];

/** The Accounting tab (finance.html #p-accounting): a section switch, "New journal entry" at the right, and the section. */
export const AccountingAnalysis: React.FC = () => {
  const [section, setSection] = useState<Section>('gl');
  const [isJournalModalOpen, setIsJournalModalOpen] = useState(false);
  // Changes after a journal entry is posted, so the chart of accounts and the ledger load again
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="fin">
      <div className="acctbar">
        <div className="seg" role="group" aria-label="Accounting section">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={s.id === section ? 'on' : undefined} aria-pressed={s.id === section} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <GuardedButtonV2 perm="postJournal" variant="primary" className="newje" onClick={() => setIsJournalModalOpen(true)}>
          <Plus />New journal entry
        </GuardedButtonV2>
      </div>

      {section === 'gl' && <GeneralLedgerTab refreshKey={refreshKey} />}
      {section === 'statements' && <StatementsPanel />}
      {section === 'profitability' && <ProductProfitPanel />}
      {section === 'expenses' && <ExpenseManagementTab />}

      <JournalEntryModal
        isOpen={isJournalModalOpen}
        onClose={() => setIsJournalModalOpen(false)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
};
