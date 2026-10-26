/**
 * M5 lane C: the Accounting tab as the v2 mockup (finance.html #p-accounting): the section switch, the chart of accounts beside
 * the ledger, the New journal entry button, and the By category bars of Expenses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '../utils/test-utils';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';

vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true, user: { role: 'super_admin' } }) }));

const svc = vi.hoisted(() => ({
  getAllGLAccounts: vi.fn(),
  getAccountLedger: vi.fn(),
  getTrialBalance: vi.fn(),
  getExpenseCategories: vi.fn(),
}));
vi.mock('../../services/financial.service', async (orig) => ({
  ...(await orig<typeof import('../../services/financial.service')>()),
  financialService: svc,
}));
vi.mock('../../pages/financial/profit/StatementsPanel', () => ({ StatementsPanel: () => <div>statements panel</div> }));
vi.mock('../../pages/financial/profit/ProductProfitPanel', () => ({ ProductProfitPanel: () => <div>product panel</div> }));

const storeState = vi.hoisted(() => ({
  expenses: [] as any[],
  expensesTotal: 0,
  expenseBreakdown: [] as any[],
  pagination: { expenses: { page: 1, pages: 1, total: 0 } },
  dateRange: {},
  loadingStates: { expenses: false },
  fetchExpenses: vi.fn(),
  fetchExpenseBreakdown: vi.fn(),
  deleteExpense: vi.fn(),
}));
vi.mock('../../stores/financialStore', () => ({ useFinancialStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(storeState) : storeState), { getState: () => storeState }) }));

import { AccountingAnalysis } from '../../pages/financial/AccountingAnalysis';
import { ExpenseManagementTab } from '../../components/financial/ExpenseManagementTab';

const ACCOUNTS = [
  { id: 1, code: '1010', name: 'Cash at bank and MoMo', accountType: 'asset', currentBalance: 41900, isActive: true },
  { id: 2, code: '2020', name: 'Commissions payable', accountType: 'liability', currentBalance: 2168, isActive: true },
  { id: 3, code: '4010', name: 'Product Sales Revenue', accountType: 'revenue', currentBalance: 92000, isActive: true },
  { id: 4, code: '5080', name: 'Meta ad spend', accountType: 'expense', currentBalance: 76200, isActive: true },
];
const line = (id: number, entry: string, debit: number, credit: number, balance: number) => ({
  id, accountId: 1, debitAmount: debit, creditAmount: credit, runningBalance: balance, description: `line ${id}`, createdAt: '2026-10-05',
  journalEntry: { id: 100 + id, entryNumber: entry, entryDate: '2026-10-05', description: 'd', sourceType: 'manual', isVoided: false, voidableByHand: true },
});

beforeEach(() => {
  vi.clearAllMocks();
  clearBlockCache();
  svc.getAllGLAccounts.mockResolvedValue({ accounts: ACCOUNTS, pagination: { pages: 1, total: 4 } });
  svc.getTrialBalance.mockResolvedValue({ totalDebits: '120000.00', totalCredits: '120000.00', difference: '0.00', balanced: true });
  svc.getAccountLedger.mockResolvedValue({
    account: { id: 1, code: '1010', name: 'Cash at bank and MoMo', normalBalance: 'debit', currentBalance: 41900, isActive: true },
    transactions: [line(1, 'JE-1', 500, 0, 500), line(2, 'JE-2', 0, 200, 300)], pagination: { pages: 1 },
  });
  svc.getExpenseCategories.mockResolvedValue({ categories: ['Packaging'], paidFrom: ['momo'], closedBefore: null, closedNotice: '', receipt: { maxBytes: 1, mimeTypes: [] } });
});

describe('Accounting tab', () => {
  it('has the four sections as a switch and New journal entry in the toolbar, no banner', async () => {
    render(<AccountingAnalysis />);
    const group = screen.getByRole('group', { name: 'Accounting section' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['General ledger', 'Statements', 'Profit by product', 'Expenses']);
    expect(screen.getByRole('button', { name: /New journal entry/ })).toBeInTheDocument();
    expect(screen.queryByText('General Ledger Control')).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'Statements' }));
    expect(screen.getByText('statements panel')).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'Profit by product' }));
    expect(screen.getByText('product panel')).toBeInTheDocument();
  });

  it('shows the chart of accounts grouped by type with live balances, the trial balance, and opens the first ledger', async () => {
    render(<AccountingAnalysis />);
    expect(await screen.findByText('Assets')).toBeInTheDocument();
    expect([...document.querySelectorAll('.coa-grp')].map((g) => g.textContent)).toEqual(['Assets', 'Liabilities', 'Revenue', 'Expenses']);
    const row = screen.getByRole('button', { name: /1010 Cash at bank and MoMo/ });
    expect(row).toHaveTextContent('41,900');
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTestId('trial-balance')).toHaveTextContent('Balanced');
    await waitFor(() => expect(svc.getAccountLedger).toHaveBeenCalledWith(1, expect.objectContaining({ page: 1 })));
    const ledger = await screen.findByRole('table', { name: 'Account ledger' });
    expect([...ledger.querySelectorAll('thead th')].slice(0, 6).map((h) => h.textContent)).toEqual(['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance']);
    expect(screen.getByText('1010 · Cash at bank and MoMo')).toBeInTheDocument();
    expect(screen.getByText('Asset account')).toBeInTheDocument();
  });

  it('picking another account opens its ledger', async () => {
    render(<AccountingAnalysis />);
    fireEvent.click(await screen.findByRole('button', { name: /5080 Meta ad spend/ }));
    await waitFor(() => expect(svc.getAccountLedger).toHaveBeenCalledWith(4, expect.anything()));
  });

  it('one pick makes one ledger request, and coming back to General ledger does not ask for the chart again (M5 UI fix 7)', async () => {
    render(<AccountingAnalysis />);
    fireEvent.click(await screen.findByRole('button', { name: /5080 Meta ad spend/ }));
    await waitFor(() => expect(svc.getAccountLedger).toHaveBeenCalledWith(4, expect.anything()));
    await screen.findByRole('table', { name: 'Account ledger' });
    expect(svc.getAccountLedger.mock.calls.filter((c) => c[0] === 4)).toHaveLength(1);
    expect(svc.getAccountLedger.mock.calls[0][1]).toEqual(expect.objectContaining({ page: 1 }));

    const group = screen.getByRole('group', { name: 'Accounting section' });
    fireEvent.click(within(group).getByRole('button', { name: 'Statements' }));
    fireEvent.click(within(group).getByRole('button', { name: 'General ledger' }));
    await screen.findByTestId('trial-balance');
    expect(svc.getAllGLAccounts).toHaveBeenCalledTimes(1);
    expect(svc.getTrialBalance).toHaveBeenCalledTimes(1);
  });

  it('asks for the whole chart in one request, within what the endpoint allows (M5 UI fix V1)', async () => {
    render(<AccountingAnalysis />);
    await screen.findByText('Assets');
    expect(svc.getAllGLAccounts).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });

  it('the journal entry dialog starts empty each time it opens, with the compact account and amount fields (M5 UI fix 16)', async () => {
    render(<AccountingAnalysis />);
    fireEvent.click(screen.getByRole('button', { name: /New journal entry/ }));
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('xl');
    expect(within(dialog).getAllByLabelText('Account')[0]).toHaveClass('psel');
    expect(within(dialog).getAllByLabelText('Debit')[0]).toHaveClass('tcell');
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Logiswift payout' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /New journal entry/ }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Description')).toHaveValue('');
  });

  it('New journal entry opens the modal with Reference, Empty and Post entry', async () => {
    render(<AccountingAnalysis />);
    fireEvent.click(screen.getByRole('button', { name: /New journal entry/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Debits and credits must be equal before you can post.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Reference')).toHaveAttribute('readonly');
    expect(within(dialog).getByTestId('journal-state')).toHaveTextContent('Empty');
    expect(within(dialog).getByRole('button', { name: 'Post entry' })).toBeDisabled();
    expect(within(dialog).getByText('Needs at least two lines.')).toBeInTheDocument();
  });
});

describe('Expenses section', () => {
  const row = (id: string, category: string, amount: number) => ({ id, category, amount, description: `${category} spend`, expenseDate: '2026-10-05', paidFrom: 'momo', source: 'manual', locked: false });
  beforeEach(() => {
    storeState.expenses = [row('1', 'Transport', 180), row('2', 'Packaging', 620)];
    storeState.expensesTotal = 800;
    storeState.expenseBreakdown = [{ category: 'Transport', totalAmount: 180, count: 1 }, { category: 'Packaging', totalAmount: 620, count: 1 }];
    storeState.pagination = { expenses: { page: 1, pages: 1, total: 2 } };
  });

  it('puts the Expenses table beside By category bars, biggest first, with the total in the card title', () => {
    render(<ExpenseManagementTab />);
    const table = screen.getByRole('table', { name: 'Expenses' });
    expect([...table.querySelectorAll('thead th')].map((h) => h.textContent)).toEqual(['Date', 'Category', 'Description', 'Paid from', 'Amount', 'Actions']);
    const bars = screen.getAllByRole('button', { pressed: false }).filter((b) => b.classList.contains('bar-row'));
    expect(bars.map((b) => b.querySelector('span')?.textContent)).toEqual(['Packaging', 'Transport']);
    expect(bars[0].querySelector('.track i')).toHaveStyle({ width: '100%' });
    expect(screen.getByText('By category').closest('.card')).toHaveTextContent('800');
    expect(screen.getByTestId('expense-total')).toHaveTextContent('2 expenses · Total');
  });

  it('writes the card title range as days even when the store holds an end-of-day instant (M5 UI fix V2)', () => {
    storeState.dateRange = { startDate: '2026-10-01', endDate: '2026-10-17T12:00:00.000Z' } as typeof storeState.dateRange;
    render(<ExpenseManagementTab />);
    expect(screen.getByText('Expenses', { selector: 'h3' }).closest('.ct')).toHaveTextContent('1–17 Oct 2026');
    storeState.dateRange = {};
  });

  it('a bar filters the list by its category, and again clears it', () => {
    render(<ExpenseManagementTab />);
    const bar = screen.getAllByRole('button').find((b) => b.classList.contains('bar-row') && b.textContent?.startsWith('Packaging'))!;
    fireEvent.click(bar);
    expect(storeState.fetchExpenses).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'Packaging' }));
    fireEvent.click(bar);
    expect(storeState.fetchExpenses).toHaveBeenLastCalledWith(expect.objectContaining({ category: undefined }));
  });

  it('delete asks first, then deletes and reloads', async () => {
    storeState.deleteExpense.mockResolvedValue(undefined);
    render(<ExpenseManagementTab />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete expense' })[0]);
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Delete 1 expense?');
    expect(storeState.deleteExpense).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(storeState.deleteExpense).toHaveBeenCalledWith('1'));
  });
});
