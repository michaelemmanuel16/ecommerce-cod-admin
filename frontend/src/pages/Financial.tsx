import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BadgePercent, BookOpen, Banknote, HandCoins, LayoutDashboard, Receipt, TrendingUp } from 'lucide-react';
import { useFinancialStore } from '../stores/financialStore';
import { Tabs } from '../components/ui-v2';
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
import { asDay } from './financial/overview/model';
import { useFinanceRange } from './financial/profit/range';
import { useBlock } from './financial/profit/useBlock';
import { useTabCounts } from './financial/tabCounts';
import { rangePhrase } from './orders/urlState';
import { collectionsService } from '../services/collections.service';
import { deliveryPartnersService } from '../services/delivery-partners.service';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';
import { formatCurrency } from '../utils/format';

type TabId = 'overview' | 'agent-collections' | 'accounting-analysis' | 'rep-commissions' | 'cash-flow';
const TAB_PARAM = 'financial-tab';

/** "Record payout" in the header: the partner modal with a "Paid by" select. The partner list is asked for when the modal opens. */
function HeaderPayout({ onClose, onRecorded }: { onClose: () => void; onRecorded: () => void }) {
  const range = useFinanceRange();
  const from = asDay(range.from);
  const to = asDay(range.to);
  const partners = useBlock(`finance-partners|${from}|${to}`, () => deliveryPartnersService.list({ from, to }, 'all'));
  const choices = useMemo(() => (partners.data?.rows ?? []).map((r) => ({ id: r.partnerId, name: r.name })), [partners.data]);
  return <PartnerPayoutModal partners={choices} onClose={onClose} onRecorded={onRecorded} />;
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
  /** Bumped after an expense or a payout is saved: the tab remounts and reloads its figures. */
  const [saved, setSaved] = useState(0);

  const handleDateRangeChange = (startDate: string | undefined, endDate: string | undefined) => {
    setDateRange(startDate, endDate);
  };

  const counts = useTabCounts(canSeeReps);
  // The same aging request as the Agent collections tab: one call feeds the subtitle and the tab
  const aging = useBlock('collections:aging', collectionsService.aging);
  const owed = aging.data?.summary.totalOutstandingAmount;
  const subtitle = `Cash and profit ${rangePhrase({ from: asDay(range.from), to: asDay(range.to) }).replace(/^in /, 'for ')}.${owed !== undefined ? (owed > 0 ? ` 3PLs and agents owe you ${formatCurrency(owed)}.` : ' 3PLs and agents owe you nothing.') : ''}`;

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; count?: number; content: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard />, content: <><FinanceOverview /><div className="mt-4"><OverviewProfitCards /></div></> },
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

  return (
    <section className="finance">
      <div className="head">
        <div>
          <h1>Finance</h1>
          <p>{subtitle}</p>
        </div>
        <div className="hd-actions finhead">
          <GuardedButtonV2 perm="addExpense" onClick={() => setExpenseOpen(true)}><Receipt />Add expense</GuardedButtonV2>
          <GuardedButtonV2 perm="recordPayout" onClick={() => setPayoutOpen(true)}><Banknote />Record payout</GuardedButtonV2>
          <ExportMenu />
          <div className="legacy-light">
            <DateRangePicker
              startDate={dateRange.startDate}
              endDate={dateRange.endDate}
              onChange={handleDateRangeChange}
              placeholder="Select date range"
            />
          </div>
        </div>
      </div>

      <Tabs
        className="pgtabs" label="Finance" value={active.id} onChange={open}
        items={tabs.map((t) => ({ id: t.id, label: <>{t.icon}{t.label}</>, count: t.count }))}
      />

      <div role="tabpanel" aria-label={active.label} key={`${active.id}-${saved}`}>{active.content}</div>

      <AddExpenseModal isOpen={expenseOpen} onClose={() => setExpenseOpen(false)} onSaved={() => setSaved((n) => n + 1)} />
      {payoutOpen && <HeaderPayout onClose={() => setPayoutOpen(false)} onRecorded={() => { aging.retry(); setSaved((n) => n + 1); }} />}
    </section>
  );
};
