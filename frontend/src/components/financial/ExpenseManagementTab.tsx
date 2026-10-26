import React, { useEffect, useState, useMemo } from 'react';
import { Plus, Download, Edit2, Trash2, Filter, Lock, Paperclip } from 'lucide-react';
import { useFinancialStore } from '../../stores/financialStore';
import { ExpenseCategoryCard } from './cards/ExpenseCategoryCard';
import { Card } from '../ui/Card';
import { AddExpenseModal } from './modals/AddExpenseModal';
import { ReceiptViewerModal } from './modals/ReceiptViewerModal';
import { GuardedButton } from './GuardedButton';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { isSafeReceiptUrl, PAID_FROM_LABELS } from '../../utils/expenseRules';
import { formatCurrency, formatDate, todayYmd } from '../../utils/format';
import type { Expense } from '../../services/financial.service';

const PAGE_SIZE = 20;

export const ExpenseManagementTab: React.FC = () => {
  const {
    expenses,
    expensesTotal,
    expenseBreakdown,
    pagination,
    dateRange,
    loadingStates,
    fetchExpenses,
    fetchExpenseBreakdown,
    deleteExpense
  } = useFinancialStore();

  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const search = useDebouncedValue(searchTerm.trim(), 300);
  const [page, setPage] = useState(1);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
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

  // Category bars: each category's share of the range total
  const categoryTotals = useMemo(() => {
    let total = 0;
    const bars = expenseBreakdown.map((cat) => {
      const amount = Number(cat.totalAmount);
      total += amount;
      return { ...cat, totalAmount: amount, percentage: 0 };
    });
    for (const bar of bars) bar.percentage = total > 0 ? (bar.totalAmount / total) * 100 : 0;
    return bars;
  }, [expenseBreakdown]);
  const totalPages = pagination.expenses?.pages ?? 1;

  const handleDeleteExpense = async (expenseId: string) => {
    if (window.confirm('Are you sure you want to delete this expense?')) {
      try {
        await deleteExpense(expenseId);
        refresh();
      } catch (error) {
        console.error('Failed to delete expense:', error);
      }
    }
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Category', 'Amount', 'Description', 'Paid from', 'Recorded By'];
    const rows = expenses.map(expense => [
      new Date(expense.expenseDate).toLocaleDateString(),
      expense.category,
      expense.amount.toString(),
      expense.description,
      expense.paidFrom ? PAID_FROM_LABELS[expense.paidFrom] : '',
      expense.recordedBy ? `${expense.recordedBy.firstName} ${expense.recordedBy.lastName}` : 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${todayYmd()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Skeleton only for the first load: a reload while typing in the search box must keep the box mounted
  if (loadingStates.expenses && expenses.length === 0 && !search && !categoryFilter) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(7)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="p-4">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Expense Category Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {categoryTotals.map((category) => (
          <ExpenseCategoryCard
            key={category.category}
            category={category.category}
            amount={category.totalAmount}
            count={category.count}
            percentage={category.percentage}
            onClick={() => {
              setCategoryFilter(categoryFilter === category.category ? '' : category.category);
              setPage(1);
            }}
          />
        ))}
      </div>

      {/* Expenses Table */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Expenses</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCSV}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              <GuardedButton perm="addExpense" onClick={() => setIsAddModalOpen(true)} className="gap-2 text-sm">
                <Plus className="w-4 h-4" />
                Add Expense
              </GuardedButton>
            </div>
          </div>

          <div className="mb-4 flex gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search expenses..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {categoryFilter && (
              <button
                onClick={() => { setCategoryFilter(''); setPage(1); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Filter className="w-4 h-4" />
                Clear Filter: {categoryFilter}
              </button>
            )}
          </div>

          <p className="mb-3 text-sm text-gray-600" data-testid="expense-total">
            {categoryFilter ? `${categoryFilter}: ` : 'All categories: '}
            <span className="font-semibold text-gray-900">{formatCurrency(expensesTotal)}</span>
            {' '}over {pagination.expenses?.total ?? expenses.length} expense{(pagination.expenses?.total ?? expenses.length) === 1 ? '' : 's'}
          </p>

          <div className="overflow-x-auto">
            {expenses.length === 0 ? (
              <p className="text-center text-gray-500 py-8">
                {searchTerm || categoryFilter ? 'No expenses match your filters' : 'No expenses recorded'}
              </p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Paid from
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Receipt
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(expense.expenseDate)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
                          {expense.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                        {expense.description}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {expense.paidFrom ? PAID_FROM_LABELS[expense.paidFrom] : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {formatCurrency(expense.amount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {isSafeReceiptUrl(expense.receiptUrl) ? (
                          <button
                            type="button"
                            onClick={() => setReceiptToView(expense.receiptUrl as string)}
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                          >
                            <Paperclip className="w-3 h-3" />
                            View
                          </button>
                        ) : (
                          <span className="text-gray-400">None</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {expense.locked ? (
                          <span className="inline-flex items-center gap-1 text-gray-400" title="Posted by the system. It cannot be edited or deleted by hand.">
                            <Lock className="w-4 h-4" aria-hidden="true" />
                            <span className="sr-only">Locked: posted by the system</span>
                          </span>
                        ) : (
                          <>
                            <GuardedButton
                              perm="editExpense"
                              variant="ghost"
                              size="sm"
                              className="text-blue-600 hover:text-blue-900 mr-2"
                              aria-label="Edit expense"
                              onClick={() => {
                                setEditingExpense(expense);
                                setIsAddModalOpen(true);
                              }}
                            >
                              <Edit2 className="w-4 h-4" />
                            </GuardedButton>
                            <GuardedButton
                              perm="deleteExpense"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteExpense(expense.id)}
                              className="text-red-600 hover:text-red-900"
                              aria-label="Delete expense"
                            >
                              <Trash2 className="w-4 h-4" />
                            </GuardedButton>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-700">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50">Previous</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

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
    </div>
  );
};
