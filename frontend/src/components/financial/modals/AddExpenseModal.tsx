import React, { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { useFinancialStore } from '../../../stores/financialStore';
import { financialService, Expense } from '../../../services/financial.service';
import { ExpenseFormRules, ExpensePaidFrom, isClosedMonth, isSafeReceiptUrl, PAID_FROM, PAID_FROM_LABELS, receiptLimitText } from '../../../utils/expenseRules';
import { todayYmd } from '../../../utils/format';
import { useReceiptUpload } from './useReceiptUpload';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a save, so the list and its total reload. */
  onSaved?: () => void;
  expense?: Expense | null;
}

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent';

export const AddExpenseModal: React.FC<AddExpenseModalProps> = ({ isOpen, onClose, onSaved, expense }) => {
  const { recordExpense, updateExpense } = useFinancialStore();
  const isEditMode = !!expense;
  const [rules, setRules] = useState<ExpenseFormRules | null>(null);
  const receipt = useReceiptUpload(rules?.receipt);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getDefaultFormData = () => ({
    category: expense?.category || '',
    amount: expense?.amount != null ? String(expense.amount) : '',
    description: expense?.description || '',
    expenseDate: expense?.expenseDate ? new Date(expense.expenseDate).toISOString().split('T')[0] : todayYmd(),
    paidFrom: (expense?.paidFrom ?? PAID_FROM[0]) as ExpensePaidFrom,
  });
  const [formData, setFormData] = useState(getDefaultFormData);

  // The category list, closed-month rule and receipt limits come from the server, once per mount
  useEffect(() => {
    financialService.getExpenseCategories().then(setRules).catch(() => setRules(null));
  }, []);

  // Reset the form when the modal opens or a different expense is edited
  useEffect(() => {
    if (!isOpen) return;
    setFormData(getDefaultFormData());
    receipt.reset(expense?.receiptUrl ?? null);
  }, [isOpen, expense?.id]);


  const categories = rules?.categories ?? [];
  const category = formData.category || categories[0] || '';
  const closedMonth = rules ? isClosedMonth(formData.expenseDate, rules.closedBefore) : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        category,
        amount: parseFloat(formData.amount),
        description: formData.description,
        expenseDate: formData.expenseDate,
        paidFrom: formData.paidFrom,
        receiptUrl: receipt.url,
      };
      if (isEditMode && expense) await updateExpense(expense.id, payload);
      else await recordExpense(payload);
      onSaved?.();
      onClose();
    } catch (error) {
      console.error(`Failed to ${isEditMode ? 'update' : 'add'} expense:`, error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditMode ? 'Edit Expense' : 'Add Expense'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="expense-date" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input id="expense-date" type="date" value={formData.expenseDate}
            onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })} className={inputClass} required />
          {closedMonth && <p role="status" className="mt-1 text-sm text-amber-700">{rules!.closedNotice}</p>}
        </div>

        <div>
          <label htmlFor="expense-amount" className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
          <input id="expense-amount" type="number" step="0.01" min="0.01" value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className={inputClass} placeholder="0.00" required />
        </div>

        <div>
          <label htmlFor="expense-category" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <select id="expense-category" value={category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })} className={inputClass} required>
            {/* A row from before the category list shows its old name until it is changed */}
            {category && !categories.includes(category) && <option value={category}>{category}</option>}
            {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="expense-paid-from" className="block text-sm font-medium text-gray-700 mb-1">Paid from</label>
          <select id="expense-paid-from" value={formData.paidFrom}
            onChange={(e) => setFormData({ ...formData, paidFrom: e.target.value as ExpensePaidFrom })} className={inputClass} required>
            {PAID_FROM.map((p) => <option key={p} value={p}>{PAID_FROM_LABELS[p]}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="expense-description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea id="expense-description" value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })} className={inputClass} rows={3}
            placeholder="Enter expense description..." required />
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1">Receipt</span>
          <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 cursor-pointer hover:bg-gray-50">
            <Paperclip className="w-4 h-4" />
            {receipt.uploading ? 'Uploading...' : receipt.url ? 'Replace receipt' : 'Attach receipt'}
            <input type="file" aria-label="Attach receipt" className="sr-only" accept={rules?.receipt.mimeTypes.join(',')}
              disabled={receipt.uploading} onChange={(e) => { receipt.pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {rules && <p className="mt-1 text-xs text-gray-500">{receiptLimitText(rules.receipt)}</p>}
          {receipt.url && !receipt.error && (
            <p className="mt-1 text-sm text-green-700">
              {receipt.name ?? 'Receipt attached'}{' '}
              {isSafeReceiptUrl(receipt.url) && <span className="text-gray-400">(saved)</span>}{' '}
              <button type="button" className="text-red-600 hover:underline" onClick={receipt.remove}>Remove</button>
            </p>
          )}
          {receipt.error && (
            <p role="alert" className="mt-1 text-sm text-red-600">
              {receipt.error}{' '}
              {receipt.pending && <button type="button" className="font-semibold underline" onClick={receipt.retry}>Try again</button>}
            </p>
          )}
        </div>

        <p className="text-xs text-gray-500">Posts to account 5100 Operating expenses</p>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting || receipt.uploading}>
            {isSubmitting ? (isEditMode ? 'Saving...' : 'Adding...') : (isEditMode ? 'Save Changes' : 'Add Expense')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
