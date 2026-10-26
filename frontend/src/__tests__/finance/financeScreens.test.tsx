import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../utils/test-utils';

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (resource: string, action: string) => perms.granted.has(`${resource}:${action}`) }),
}));

const svc = vi.hoisted(() => ({
  getAllGLAccounts: vi.fn(),
  getAccountLedger: vi.fn(),
  recordJournalEntry: vi.fn(),
  getExpenseCategories: vi.fn(),
  uploadReceipt: vi.fn(),
}));
vi.mock('../../services/financial.service', async (orig) => ({
  ...(await orig<typeof import('../../services/financial.service')>()),
  financialService: svc,
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const storeState = vi.hoisted(() => ({
  expenses: [] as any[],
  expensesTotal: 0,
  expenseBreakdown: [] as any[],
  pagination: { expenses: { page: 1, totalPages: 1, total: 0 } },
  dateRange: {},
  loadingStates: { expenses: false },
  fetchExpenses: vi.fn(),
  fetchExpenseBreakdown: vi.fn(),
  deleteExpense: vi.fn(),
  recordExpense: vi.fn(),
  updateExpense: vi.fn(),
}));
vi.mock('../../stores/financialStore', () => ({ useFinancialStore: () => storeState }));

import { JournalEntryModal } from '../../components/financial/gl/JournalEntryModal';
import { AccountLedger } from '../../components/financial/gl/AccountLedger';
import { ExpenseManagementTab } from '../../components/financial/ExpenseManagementTab';
import { AddExpenseModal } from '../../components/financial/modals/AddExpenseModal';
import { GuardedButton } from '../../components/financial/GuardedButton';

const ALL = ['financial:create', 'expenses:edit', 'expenses:delete', 'journal:post', 'journal:void'];
const RULES = {
  categories: ['Packaging', 'Transport', 'Other'], paidFrom: ['momo', 'bank', 'cash'],
  closedBefore: '2026-10-01', closedNotice: 'This month is closed; the P&L changes',
  receipt: { maxBytes: 15 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
};
/** The disabled button's reason shows in a tooltip on hover. */
const hoverReason = (button: HTMLElement, reason: string) => {
  // The reason is always there for screen readers (one hidden copy); hovering the wrapper adds the visible tooltip.
  expect(screen.getAllByText(reason)).toHaveLength(1);
  fireEvent.mouseEnter(button.closest('div.relative') as HTMLElement);
  expect(screen.getAllByText(reason)).toHaveLength(2);
};

/** A v2 guarded button: aria-disabled (it keeps focus), and its reason in a tooltip that shows on hover. */
const inertWithReason = (button: HTMLElement, reason: string) => {
  expect(button).toHaveAttribute('aria-disabled', 'true');
  const wrap = button.closest('.tip') as HTMLElement;
  const bubble = wrap.querySelector('[role="tooltip"]') as HTMLElement;
  expect(bubble).toHaveTextContent(reason);
  expect(bubble).toHaveAttribute('hidden');
  fireEvent.mouseEnter(wrap);
  expect(bubble).not.toHaveAttribute('hidden');
};

beforeEach(() => {
  vi.clearAllMocks();
  perms.granted = new Set(ALL);
  svc.getAllGLAccounts.mockResolvedValue({ accounts: [{ id: 1, code: '1010', name: 'Cash at bank and MoMo' }, { id: 2, code: '3010', name: "Owner's Equity" }] });
  svc.getExpenseCategories.mockResolvedValue(RULES);
});

describe('GuardedButton without the permission', () => {
  it('is disabled, shows the reason on hover of its wrapper and on keyboard focus, and describes itself to screen readers', () => {
    perms.granted = new Set();
    render(<GuardedButton perm="postJournal">Record Journal Entry</GuardedButton>);
    const button = screen.getByRole('button', { name: 'Record Journal Entry' });
    expect(button).toBeDisabled();
    expect(button.className).toContain('pointer-events-none'); // so the hover reaches the wrapper in a real browser
    const reason = 'You do not have permission to post journal entries.';
    const wrapper = button.closest('div.relative') as HTMLElement;
    expect(screen.getAllByText(reason)).toHaveLength(1);
    fireEvent.mouseEnter(wrapper);
    expect(screen.getAllByText(reason)).toHaveLength(2);
    fireEvent.mouseLeave(wrapper);
    expect(screen.getAllByText(reason)).toHaveLength(1);
    fireEvent.focus(button.parentElement as HTMLElement);
    expect(screen.getAllByText(reason)).toHaveLength(2);
    const focusable = button.parentElement as HTMLElement;
    expect(focusable).toHaveAttribute('tabindex', '0');
    expect(focusable.getAttribute('aria-describedby')).toBe(screen.getAllByText(reason)[0].id);
  });

  it('is a plain enabled button with the permission', () => {
    perms.granted = new Set(['journal:post']);
    render(<GuardedButton perm="postJournal">Record Journal Entry</GuardedButton>);
    expect(screen.getByRole('button', { name: 'Record Journal Entry' })).toBeEnabled();
  });
});

describe('journal entry modal', () => {
  const open = async () => {
    render(<JournalEntryModal isOpen onClose={() => {}} onSuccess={() => {}} />);
    await screen.findAllByText(/1010 Cash/);
  };
  const fill = (rows: Array<[string, string, string]>) => {
    const selects = screen.getAllByRole('combobox');
    const debit = screen.getAllByLabelText('Debit');
    const credit = screen.getAllByLabelText('Credit');
    rows.forEach(([account, dr, cr], i) => {
      fireEvent.change(selects[i], { target: { value: account } });
      fireEvent.change(debit[i], { target: { value: dr } });
      fireEvent.change(credit[i], { target: { value: cr } });
    });
  };
  const post = () => screen.getByRole('button', { name: /Post entry/ });

  it('shows Empty and blocks post', async () => {
    await open();
    expect(screen.getByTestId('journal-state')).toHaveTextContent('Empty');
    expect(post()).toBeDisabled();
  });

  it('shows Out of balance with the difference, and blocks post', async () => {
    await open();
    fill([['1', '100', '0'], ['2', '0', '90']]);
    expect(screen.getByTestId('journal-state')).toHaveTextContent(/Out of balance/);
    expect(post()).toBeDisabled();
  });

  it('shows Balanced and allows post, which sends the lines', async () => {
    svc.recordJournalEntry.mockResolvedValue({});
    await open();
    fireEvent.change(screen.getByPlaceholderText(/Logiswift payout/), { target: { value: 'Owner top-up' } });
    fill([['1', '100', '0'], ['2', '0', '100']]);
    expect(screen.getByTestId('journal-state')).toHaveTextContent('Balanced');
    expect(post()).toBeEnabled();
    fireEvent.click(post());
    await waitFor(() => expect(svc.recordJournalEntry).toHaveBeenCalledTimes(1));
    expect(svc.recordJournalEntry.mock.calls[0][0].transactions).toHaveLength(2);
  });

  it('a user without the journal permission sees post disabled with a tooltip, even when balanced', async () => {
    perms.granted = new Set();
    await open();
    fill([['1', '100', '0'], ['2', '0', '100']]);
    inertWithReason(post(), 'You do not have permission to post journal entries.');
  });
});

describe('account ledger void button', () => {
  const entry = (over: Record<string, unknown>) => ({
    id: 1, accountId: 1, debitAmount: 10, creditAmount: 0, runningBalance: 10, description: 'x', createdAt: '2026-10-01',
    journalEntry: { id: 11, entryNumber: 'JE-1', entryDate: '2026-10-01', description: 'd', sourceType: 'manual', isVoided: false, voidableByHand: true, ...over },
  });
  const load = async (rows: any[]) => {
    svc.getAccountLedger.mockResolvedValue({
      account: { id: 1, code: '1010', name: 'Cash', normalBalance: 'debit', currentBalance: 10, isActive: true },
      transactions: rows, pagination: { pages: 1 },
    });
    render(<AccountLedger accountId={1} />);
    await screen.findByText('JE-1');
  };

  it('shows Void for a hand-made entry and none for an entry the server says is not voidable by hand', async () => {
    await load([entry({}), { ...entry({ id: 12, entryNumber: 'JE-2', sourceType: 'commission_accrual', voidableByHand: false }), id: 2 }]);
    expect(screen.getAllByRole('button', { name: 'Void' })).toHaveLength(1);
  });

  it('shows Voided instead of a button for a voided entry', async () => {
    await load([entry({ isVoided: true })]);
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
    expect(screen.getByText('Voided')).toBeInTheDocument();
  });

  it('a view-only user sees Void disabled with a tooltip', async () => {
    perms.granted = new Set();
    await load([entry({})]);
    inertWithReason(screen.getByRole('button', { name: /Void/ }), 'You do not have permission to void journal entries.');
  });
});

describe('expenses tab', () => {
  const row = (over: Record<string, unknown>) => ({
    id: '1', category: 'Transport', amount: 50, description: 'Fuel', expenseDate: '2026-10-05', paidFrom: 'cash', source: 'manual', locked: false, ...over,
  });
  beforeEach(() => {
    storeState.expenses = [row({}), row({ id: '2', description: 'Meta daily spend', source: 'meta', locked: true, paidFrom: null })];
    storeState.expensesTotal = 100;
    storeState.expenseBreakdown = [{ category: 'Transport', totalAmount: 100, count: 2 }];
    storeState.pagination = { expenses: { page: 1, totalPages: 1, total: 2 } };
  });

  it('a locked system row has no edit or delete, and a lock instead', () => {
    render(<ExpenseManagementTab />);
    expect(screen.getAllByRole('button', { name: /Edit expense/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Delete expense/ })).toHaveLength(1);
    expect(screen.getByText('Locked: posted by the system')).toBeInTheDocument();
  });

  it('the total above the list equals the breakdown total', () => {
    render(<ExpenseManagementTab />);
    expect(screen.getByTestId('expense-total')).toHaveTextContent(/100/);
    expect(screen.getByTestId('expense-total')).not.toHaveTextContent(/category bars add up/);
  });

  it('a view-only user sees add, edit and delete disabled with tooltips', () => {
    perms.granted = new Set();
    render(<ExpenseManagementTab />);
    inertWithReason(screen.getByRole('button', { name: /Add expense/ }), 'You do not have permission to add expenses.');
    inertWithReason(screen.getByRole('button', { name: /Edit expense/ }), 'You do not have permission to edit expenses.');
    inertWithReason(screen.getByRole('button', { name: /Delete expense/ }), 'You do not have permission to delete expenses.');
  });

  it('opens a receipt in a viewer in the same tab, not a new window', () => {
    storeState.expenses = [row({ receiptUrl: '/uploads/r-1-2.pdf' })];
    render(<ExpenseManagementTab />);
    fireEvent.click(screen.getByRole('button', { name: /View/ }));
    expect(screen.getByTitle('Receipt PDF')).toHaveAttribute('src', '/uploads/r-1-2.pdf');
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
  });
});

describe('add expense modal', () => {
  const file = (type: string, size: number) => {
    const f = new File(['x'], 'r.pdf', { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  it('shows the closed-month notice for a date in an earlier month', async () => {
    render(<AddExpenseModal isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-15' } });
    await screen.findByRole('option', { name: 'Packaging' });
    expect(await screen.findByRole('status')).toHaveTextContent('This month is closed; the P&L changes');
  });

  it('lists the server categories, the paid-from choices and the posting note', async () => {
    render(<AddExpenseModal isOpen onClose={() => {}} />);
    await screen.findByRole('option', { name: 'Packaging' });
    expect(screen.queryByRole('option', { name: 'COGS' })).toBeNull();
    expect(screen.getByRole('option', { name: 'MoMo' })).toBeInTheDocument();
    expect(screen.getByText('Posts to account 5100 Operating Expenses.')).toBeInTheDocument();
  });

  it('shows the limit for a file that is too large, and does not upload it', async () => {
    render(<AddExpenseModal isOpen onClose={() => {}} />);
    await screen.findByRole('option', { name: 'Packaging' }); // the limits arrive with the category list
    fireEvent.change(screen.getByLabelText('Attach receipt'), { target: { files: [file('application/pdf', 16 * 1024 * 1024)] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/15 MB/);
    expect(screen.getByText('JPEG, PNG, WebP or PDF, up to 15 MB')).toBeInTheDocument();
    expect(svc.uploadReceipt).not.toHaveBeenCalled();
  });

  it('keeps the file after a failed upload and retries it with "Try again"', async () => {
    svc.uploadReceipt.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('/uploads/r-1-2.pdf');
    render(<AddExpenseModal isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Attach receipt'), { target: { files: [file('application/pdf', 1000)] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(svc.uploadReceipt).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Receipt attached|r\.pdf/)).toBeInTheDocument();
    expect(svc.uploadReceipt.mock.calls[1][0]).toBe(svc.uploadReceipt.mock.calls[0][0]);
  });
});
