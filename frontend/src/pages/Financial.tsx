import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BadgePercent, BookOpen, Banknote, HandCoins, LayoutDashboard, Receipt, TrendingUp } from 'lucide-react';
import { useFinancialStore } from '../stores/financialStore';
import { Select, Tabs } from '../components/ui-v2';
import { GuardedButtonV2 } from '../components/financial/GuardedButtonV2';
import { AddExpenseModal } from '../components/financial/modals/AddExpenseModal';
import { DateRangePicker } from '../components/ui/DateRangePicker';
import { FinanceOverview } from './financial/overview/FinanceOverview';
import { AgentCollections } from './financial/AgentCollections';
import { AccountingAnalysis } from './financial/AccountingAnalysis';
import { RepCommissions } from './financial/RepCommissions';
import { OverviewProfitCards } from './financial/profit/OverviewProfitCards';
import { CashFlowPanel } from './financial/cash/CashFlowPanel';
import { ExportMenu } from './financial/cash/ExportMenu';
import { PartnerPayoutModal } from './deliveries/PartnerPayoutModal';
import { isMonthRange } from './financial/overview/model';
import { useFinanceRange } from './financial/profit/range';
import { useAging } from './financial/profit/blocks';
import { refreshBlocks } from './financial/profit/useBlock';
import { useTabCounts } from './financial/tabCounts';
import { monthName } from './dashboard/format';
import { rangePhrase } from './orders/urlState';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';
import { formatCurrency, todayYmd } from '../utils/format';

type TabId = 'overview' | 'agent-collections' | 'accounting-analysis' | 'rep-commissions' | 'cash-flow';
const TAB_PARAM = 'financial-tab';

/** "3PLs and agents owe you GH₵23,400." from the aging request the Agent collections tab shares. Nothing until it answers. */
function OwedLine() {
  const owed = useAging().data?.summary.totalOutstandingAmount;
  if (owed === undefined) return null;
  return <> {owed > 0 ? `3PLs and agents owe you ${formatCurrency(owed)}.` : '3PLs and agents owe you nothing.'}</>;
}

/** "Record payout" in the header: the partner payout modal, with the "Paid by" select it needs (the partners come from the aging request). */
function HeaderPayout({ onClose, onRecorded }: { onClose: () => void; onRecorded: () => void }) {
  const partners = useAging().data?.partners ?? [];
  const [chosen, setChosen] = useState(0);
  return (
    <PartnerPayoutModal
      partnerId={chosen}
      partnerName={partners.find((p) => p.agentId === chosen)?.name ?? 'This partner'}
      title="Record a payout from a partner"
      description="Money a delivery agent or 3PL paid you."
      lead={
        <Select label="Paid by" value={chosen || ''} onChange={(e) => setChosen(Number(e.target.value) || 0)}>
          <option value="">Choose a partner</option>
          {partners.map((p) => <option key={p.agentId} value={p.agentId}>{p.name}</option>)}
        </Select>
      }
      onClose={onClose}
      onRecorded={onRecorded}
    />
  );
}

export const Financial: React.FC = () => {
  // v2 tokens, so the page follows the light and dark theme
  useV2Page();
  const { dateRange, setDateRange } = useFinancialStore();
  const { can } = usePermissions();
  const canSeeReps = can('payouts', 'view');
  const range = useFinanceRange();
  const [params, setParams] = useSearchParams();
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  /** Bumped after an expense or a payout is saved: the open tab remounts, so a tab that keeps its figures in a store loads them again too. */
  const [saved, setSaved] = useState(0);
  /** Every figure on screen asks again (the 60 s cache would hand back the old ones), then the tab remounts. */
  const afterSave = () => {
    refreshBlocks();
    setSaved((n) => n + 1);
  };

  const handleDateRangeChange = (startDate: string | undefined, endDate: string | undefined) => {
    setDateRange(startDate, endDate);
  };

  const counts = useTabCounts(canSeeReps);
  const phrase = isMonthRange(range, todayYmd()) ? `for ${monthName(range.from)}` : rangePhrase(range, undefined, 'for');

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; count?: number; content: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard />, content: <div className="vstack"><FinanceOverview /><OverviewProfitCards /></div> },
    { id: 'agent-collections', label: 'Agent collections', icon: <HandCoins />, count: counts.collections, content: <AgentCollections /> },
    { id: 'accounting-analysis', label: 'Accounting', icon: <BookOpen />, content: <AccountingAnalysis /> },
    // F-914: the Rep commissions tab shows for roles that can view payouts
    ...(canSeeReps ? [{ id: 'rep-commissions' as const, label: 'Rep commissions', icon: <BadgePercent />, count: counts.reps, content: <RepCommissions /> }] : []),
    { id: 'cash-flow', label: 'Cash-flow forecast', icon: <TrendingUp />, content: <CashFlowPanel /> },
  ];

  // The open tab is kept in the address, so a reload or a shared link opens the same tab
  const wanted = params.get(TAB_PARAM);
  const active = tabs.find((t) => t.id === wanted) ?? tabs[0];
  const open = (id: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, id);
    setParams(next, { replace: true });
  };

  // A count of 0 shows no pill
  return (
    <section className="finance">
      <div className="head">
        <div>
          <h1>Finance</h1>
          <p>Cash and profit {phrase}.<OwedLine /></p>
        </div>
        <div className="hd-actions finhead">
          <GuardedButtonV2 perm="addExpense" onClick={() => setExpenseOpen(true)}><Receipt />Add expense</GuardedButtonV2>
          <GuardedButtonV2 perm="recordPayout" onClick={() => setPayoutOpen(true)}><Banknote />Record payout</GuardedButtonV2>
          <ExportMenu />
          <DateRangePicker
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            onChange={handleDateRangeChange}
            placeholder="Select date range"
          />
        </div>
      </div>

      <Tabs
        className="pgtabs" label="Finance" value={active.id} onChange={open}
        items={tabs.map((t) => ({ id: t.id, label: <>{t.icon}{t.label}</>, count: t.count || undefined }))}
      />

      <div role="tabpanel" aria-label={active.label} key={`${active.id}-${saved}`}>{active.content}</div>

      <AddExpenseModal isOpen={expenseOpen} onClose={() => setExpenseOpen(false)} onSaved={afterSave} />
      {payoutOpen && <HeaderPayout onClose={() => setPayoutOpen(false)} onRecorded={afterSave} />}
    </section>
  );
};
