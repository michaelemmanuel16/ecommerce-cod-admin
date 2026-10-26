import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Financial } from '../../pages/Financial';

let canView = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: (r: string, a: string) => (r === 'payouts' && a === 'view' ? canView : true) }) }));
vi.mock('../../pages/financial/overview/FinanceOverview', () => ({ FinanceOverview: () => <div>overview</div> }));
vi.mock('../../pages/financial/AgentCollections', () => ({ AgentCollections: () => <div>collections</div> }));
vi.mock('../../pages/financial/AccountingAnalysis', () => ({ AccountingAnalysis: () => <div>accounting</div> }));
vi.mock('../../pages/financial/RepCommissions', () => ({ RepCommissions: () => <div>rep commissions content</div> }));
vi.mock('../../pages/financial/profit/OverviewProfitCards', () => ({ OverviewProfitCards: () => <div>overview profit cards</div> }));
vi.mock('../../pages/financial/cash/CashFlowPanel', () => ({ CashFlowPanel: () => <div>cash flow</div> }));
vi.mock('../../pages/financial/cash/ExportMenu', () => ({ ExportMenu: () => null }));
vi.mock('../../pages/financial/tabCounts', () => ({ useTabCounts: () => ({ collections: 4, reps: 2 }) }));
vi.mock('../../services/collections.service', () => ({
  collectionsService: { aging: () => Promise.resolve({ summary: { totalOutstandingAmount: 23400 }, partners: [] }) },
}));
vi.mock('../../components/financial/modals/AddExpenseModal', () => ({ AddExpenseModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>add expense modal</div> : null) }));
vi.mock('../../pages/deliveries/PartnerPayoutModal', () => ({ PartnerPayoutModal: () => <div>payout modal</div> }));
vi.mock('../../services/delivery-partners.service', () => ({ deliveryPartnersService: { list: () => Promise.resolve({ rows: [] }) } }));
vi.mock('../../components/ui/DateRangePicker', () => ({ DateRangePicker: () => null }));

beforeEach(() => {
  canView = true;
});

const open = () => render(<MemoryRouter><Financial /></MemoryRouter>);

describe('Finance tabs (M5-T38)', () => {
  it('shows the Rep commissions tab to a role with payouts:view', () => {
    open();
    expect(screen.getByRole('tab', { name: /Rep commissions/ })).toBeInTheDocument();
  });

  it('hides it from a role without payouts:view', () => {
    canView = false;
    open();
    expect(screen.queryByRole('tab', { name: /Rep commissions/ })).not.toBeInTheDocument();
  });

  it('lists the five tabs in the mockup order, with the counts on Agent collections and Rep commissions', () => {
    open();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Agent collections4', 'Accounting', 'Rep commissions2', 'Cash-flow forecast']);
  });

  it('opens a tab on click and keeps it in the address', async () => {
    open();
    expect(screen.getByText('overview')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Accounting/ }));
    expect(screen.getByText('accounting')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Accounting/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('the header has Add expense, Record payout and Export, and the subtitle says what partners owe', async () => {
    open();
    expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument();
    expect(await screen.findByText(/3PLs and agents owe you .*23,400/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add expense/ }));
    expect(screen.getByText('add expense modal')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Record payout/ }));
    expect(await screen.findByText('payout modal')).toBeInTheDocument();
  });
});
