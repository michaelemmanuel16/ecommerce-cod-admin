import React, { useEffect, useState, useMemo } from 'react';
import { Pencil, Paperclip, Plus, Search, Trash2, Lock } from 'lucide-react';
import { useFinancialStore } from '../../stores/financialStore';
import { Button, Card, ConfirmDialog, Pagination, Skeleton, Tag } from '../ui-v2';
import { BarList } from './BarList';
import { AddExpenseModal } from './modals/AddExpenseModal';
import { ReceiptViewerModal } from './modals/ReceiptViewerModal';
import { GuardedButtonV2 } from './GuardedButtonV2';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { isSafeReceiptUrl, PAID_FROM_LABELS } from '../../utils/expenseRules';
import { formatCurrency, formatDate } from '../../utils/format';
import { useFinanceRange } from '../../pages/financial/profit/range';
import { rangeLabel } from '../../pages/reports/format';
import type { Expense } from '../../services/financial.service';

const PAGE_SIZE = 20;
/** Bar colours in the mockup's order (finance.html CATC). */
const CATEGORY_COLORS = ['var(--pine)', 'var(--violet)', 'var(--gold)', 'var(--coral)', 'var(--mint)', 'var(--ink-3)'];

/** Expenses (finance.html #a-exp): the expense table beside the By category bars. A bar filters the table. */
export const ExpenseManagementTab: React.FC = () => {
  const {
    expenses,
    expensesTotal,
    expenseBreakdown,
    expensesPagination,
    dateRange,
    expensesLoading,
    fetchExpenses,
    fetchExpenseBreakdown,
    deleteExpense
  } = useFinancialStore();
  const range = useFinanceRange();

  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const search = useDebouncedValue(searchTerm.trim(), 300);
  const [page, setPage] = useState(1);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [receiptToView, setReceiptToView] = useState<string | null>(null);

  const loadList = () => fetchExpenses({
    category: categoryFilter || undefined, search: search || undefined, page, limit: PAGE_SIZE,
    startDate: dateRange.startDate, endDate: dateRange.endDate
  });
  const loadBreakdown = () => fetchExpenseBreakdown(dateRange.startDate, dateRange.endDate);
  // After a save or a delete this screen reloads the list and the breakdown, once each (the store does not)
  const refresh = () => { loadList(); loadBreakdown(); };

  useEffect(() => {
    loadList();
  }, [dateRange.startDate, dateRange.endDate, categoryFilter, search, page]);

  useEffect(() => {
    loadBreakdown();
  }, [dateRange.startDate, dateRange.endDate]);

  // By category: biggest first, each bar as long as its share of the biggest
  const bars = useMemo(() => {
    const rows = expenseBreakdown
      .map((cat) => ({ category: cat.category, amount: Number(cat.totalAmount) }))
      .sort((a, b) => b.amount - a.amount);
    const max = rows[0]?.amount || 1;
    return {
      rows: rows.map((r) => ({ ...r, width: Math.max(0, (r.amount / max) * 100) })),
      total: rows.reduce((sum, r) => sum + r.amount, 0),
    };
  }, [expenseBreakdown]);
  const count = expensesPagination?.total ?? expenses.length;

  const confirmDelete = async () => {
    const expense = deleting;
    setDeleting(null);
    if (!expense) return;
    try {
      await deleteExpense(expense.id);
      refresh();
    } catch (error) {
      console.error('Failed to delete expense:', error);
    }
  };

  // Skeleton only for the first load: a reload while typing in the search box must keep the box mounted
  if (expensesLoading && expenses.length === 0 && !search && !categoryFilter) {
    return (
      <div className="grid two expgrid" aria-busy="true" aria-label="Loading Expenses">
        <Skeleton height={380} className="skelcard" />
        <Skeleton height={380} className="skelcard" />
      </div>
    );
  }

  return (
    <>
      <div className="grid two expgrid">
        <Card title="Expenses" aside={rangeLabel(range.from, range.to)}>
          <div className="filters">
            <label className="srch">
              <Search width={16} height={16} aria-hidden="true" />
              <input type="search" placeholder="Search expenses" aria-label="Search expenses" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }} />
            </label>
            {categoryFilter && (
              <Button className="on" onClick={() => { setCategoryFilter(''); setPage(1); }}>{categoryFilter} · Clear</Button>
            )}
            <GuardedButtonV2 perm="addExpense" className="addexp" onClick={() => { setEditingExpense(null); setIsAddModalOpen(true); }}>
              <Plus />Add expense
            </GuardedButtonV2>
          </div>
          <div className="tablewrap">
            <table className="dt" aria-label="Expenses">
              <thead>
                <tr>
                  <th>Date</th><th>Category</th><th>Description</th><th>Paid from</th><th className="r">Amount</th><th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 && (
                  <tr><td colSpan={6} className="ledempty">{searchTerm || categoryFilter ? 'No expenses match your filters' : 'No expenses recorded'}</td></tr>
                )}
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{formatDate(expense.expenseDate, 'd MMM')}</td>
                    <td><Tag>{expense.category}</Tag></td>
                    <td className="desc">{expense.description}</td>
                    <td>{expense.paidFrom ? PAID_FROM_LABELS[expense.paidFrom] : '-'}</td>
                    <td className="r num"><b>{formatCurrency(expense.amount)}</b></td>
                    <td className="r">
                      <span className="rowact">
                        {isSafeReceiptUrl(expense.receiptUrl) && (
                          <Button size="icon-sm" aria-label="View receipt" onClick={() => setReceiptToView(expense.receiptUrl as string)}><Paperclip /></Button>
                        )}
                        {expense.locked ? (
                          <span className="ink3" title="Posted by the system. It cannot be edited or deleted by hand.">
                            <Lock width={15} height={15} aria-hidden="true" />
                            <span className="sr-only">Locked: posted by the system</span>
                          </span>
                        ) : (
                          <>
                            <GuardedButtonV2
                              perm="editExpense"
                              size="icon-sm"
                              aria-label="Edit expense"
                              onClick={() => {
                                setEditingExpense(expense);
                                setIsAddModalOpen(true);
                              }}
                            >
                              <Pencil />
                            </GuardedButtonV2>
                            <GuardedButtonV2 perm="deleteExpense" size="icon-sm" className="dng" aria-label="Delete expense" onClick={() => setDeleting(expense)}>
                              <Trash2 />
                            </GuardedButtonV2>
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {count > PAGE_SIZE && <Pagination page={page} pageSize={PAGE_SIZE} total={count} noun="expenses" onPageChange={setPage} />}
          <p className="note" data-testid="expense-total">
            {categoryFilter ? `${categoryFilter}, ` : ''}{count} expense{count === 1 ? '' : 's'} · Total <b className="num ink">{formatCurrency(expensesTotal)}</b>
          </p>
        </Card>

        <Card title="By category" aside={formatCurrency(bars.total)}>
          {bars.rows.length === 0 ? (
            <p className="note">No expenses in these dates.</p>
          ) : (
            <BarList
              wide
              label="Expenses by category"
              rows={bars.rows.map((r, i) => ({
                key: r.category, label: r.category, value: formatCurrency(r.amount), width: r.width, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                on: r.category === categoryFilter,
                onClick: () => { setCategoryFilter(categoryFilter === r.category ? '' : r.category); setPage(1); },
              }))}
            />
          )}
        </Card>
      </div>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => void confirmDelete()} action="Delete" count={1} noun="expense">
        {deleting ? `${deleting.description} will be deleted. The ledger entry is reversed.` : ''}
      </ConfirmDialog>

      <AddExpenseModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingExpense(null);
        }}
        onSaved={refresh}
        expense={editingExpense}
      />
      <ReceiptViewerModal url={receiptToView} onClose={() => setReceiptToView(null)} />
    </>
  );
};
