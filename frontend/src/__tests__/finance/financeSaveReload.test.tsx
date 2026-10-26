/**
 * M5 UI fixes: after an expense or a payout is saved the Finance figures load again (the 60 s block cache used to hand back
 * the old ones), the subtitle follows the range ("for October"), and a tab count of 0 shows no pill.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Financial } from '../../pages/Financial';
import { clearBlockCache, useBlock } from '../../pages/financial/profit/useBlock';
import { useFinancialStore } from '../../stores/financialStore';

const svc = vi.hoisted(() => ({ aging: vi.fn(), deposits: vi.fn(), repsOwed: vi.fn(), figure: vi.fn() }));
vi.mock('../../services/collections.service', async (orig) => ({
  ...(await orig<typeof import('../../services/collections.service')>()),
  collectionsService: { aging: svc.aging, deposits: svc.deposits },
}));
vi.mock('../../services/payouts.service', () => ({ payoutsService: { repsOwed: svc.repsOwed } }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true, user: { role: 'super_admin' } }) }));
vi.mock('../../components/ui/DateRangePicker', () => ({ DateRangePicker: () => null }));
vi.mock('../../pages/financial/cash/ExportMenu', () => ({ ExportMenu: () => null }));
vi.mock('../../pages/financial/profit/OverviewProfitCards', () => ({ OverviewProfitCards: () => null }));
vi.mock('../../pages/financial/AgentCollections', () => ({ AgentCollections: () => null }));
vi.mock('../../pages/financial/AccountingAnalysis', () => ({ AccountingAnalysis: () => null }));
vi.mock('../../pages/financial/RepCommissions', () => ({ RepCommissions: () => null }));
vi.mock('../../pages/financial/cash/CashFlowPanel', () => ({ CashFlowPanel: () => null }));
// The Overview tab stands in with one block of its own, the way the real cards read theirs
vi.mock('../../pages/financial/overview/FinanceOverview', () => ({
  FinanceOverview: function Figure() {
    const b = useBlock('figure', () => svc.figure());
    return <p>figure {String(b.data ?? '')}</p>;
  },
}));
vi.mock('../../components/financial/modals/AddExpenseModal', () => ({
  AddExpenseModal: ({ isOpen, onSaved }: { isOpen: boolean; onSaved?: () => void }) => (isOpen ? <button onClick={onSaved}>save the expense</button> : null),
}));
vi.mock('../../pages/deliveries/PartnerPayoutModal', () => ({
  PartnerPayoutModal: ({ lead, partnerId, onRecorded }: { lead: React.ReactNode; partnerId: number; onRecorded: () => void }) => (
    <div>{lead}<span>chosen {partnerId}</span><button onClick={onRecorded}>save the payout</button></div>
  ),
}));

const aging = (owed: number) => ({
  summary: { totalOutstandingAmount: owed },
  partners: [{ agentId: 7, name: 'Kofi Appiah' }, { agentId: 8, name: 'Logiswift' }],
});
const open = () => render(<MemoryRouter><Financial /></MemoryRouter>);

beforeEach(() => {
  clearBlockCache();
  Object.values(svc).forEach((m) => m.mockReset());
  svc.figure.mockResolvedValue('figure');
  svc.deposits.mockResolvedValue([]);
  svc.repsOwed.mockResolvedValue({ totals: { repsOwed: 2 } });
  useFinancialStore.setState({ dateRange: { startDate: '2026-10-01', endDate: '2026-10-31' } });
});

describe('Finance after a save (M5 UI fix 1)', () => {
  it('an expense saved from the header makes the figures and the owed line load again', async () => {
    svc.figure.mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    svc.aging.mockResolvedValueOnce(aging(100)).mockResolvedValueOnce(aging(250));
    open();
    expect(await screen.findByText('figure old')).toBeInTheDocument();
    expect(await screen.findByText(/owe you .*100/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Add expense/ }));
    await userEvent.click(screen.getByRole('button', { name: 'save the expense' }));

    expect(await screen.findByText('figure new')).toBeInTheDocument();
    expect(await screen.findByText(/owe you .*250/)).toBeInTheDocument();
    expect(svc.figure).toHaveBeenCalledTimes(2);
    expect(svc.aging).toHaveBeenCalledTimes(2); // the subtitle and the tab share one call each time
  });

  it('a payout saved from the header does the same, and its "Paid by" choices are the aging partners', async () => {
    svc.figure.mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    svc.aging.mockResolvedValue(aging(100));
    open();
    await screen.findByText('figure old');
    await userEvent.click(screen.getByRole('button', { name: /Record payout/ }));
    const paidBy = await screen.findByLabelText('Paid by');
    expect([...paidBy.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose a partner', 'Kofi Appiah', 'Logiswift']);
    await userEvent.selectOptions(paidBy, 'Logiswift');
    expect(screen.getByText('chosen 8')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'save the payout' }));
    expect(await screen.findByText('figure new')).toBeInTheDocument();
  });
});

describe('Finance header (M5 UI fixes 22, V7, V8)', () => {
  it('says "for October" for a whole calendar month and for the month to date, and spells out any other range', async () => {
    svc.aging.mockResolvedValue(aging(0));
    const { unmount } = open();
    expect(await screen.findByText(/Cash and profit for October\./)).toBeInTheDocument();
    expect(await screen.findByText(/3PLs and agents owe you nothing\./)).toBeInTheDocument();
    unmount();

    useFinancialStore.setState({ dateRange: { startDate: '2026-10-03', endDate: '2026-10-09' } });
    open();
    expect(await screen.findByText(/Cash and profit from 3 Oct to 9 Oct\./)).toBeInTheDocument();
  });

  it('a month to date (first of the month to today) also reads "for <month>"', async () => {
    svc.aging.mockResolvedValue(aging(0));
    const today = new Date();
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    useFinancialStore.setState({ dateRange: { startDate: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), endDate: `${ymd(today)}T12:00:00.000Z` } });
    open();
    const month = today.toLocaleString('en-GB', { month: 'long' });
    expect(await screen.findByText(new RegExp(`Cash and profit for ${month}\\.`))).toBeInTheDocument();
  });

  it('shows the count pill only when the count is above 0', async () => {
    svc.aging.mockResolvedValue(aging(0));
    svc.repsOwed.mockResolvedValue({ totals: { repsOwed: 0 } });
    svc.deposits.mockResolvedValue([{ id: 1, status: 'pending' }, { id: 2, status: 'verified' }]);
    open();
    await waitFor(() => expect(screen.getByRole('tab', { name: /Agent collections/ })).toHaveTextContent('Agent collections1'));
    await waitFor(() => expect(svc.repsOwed).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: /Rep commissions/ })).toHaveTextContent(/^Rep commissions$/);
  });
});
