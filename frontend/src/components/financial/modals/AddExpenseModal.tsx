import React, { useEffect, useState } from 'react';
import { X, Paperclip } from 'lucide-react';
import { useFinancialStore } from '../../../stores/financialStore';
import { financialService, Expense, ExpensePaidFrom } from '../../../services/financial.service';
import {
  CLOSED_MONTH_NOTICE, isClosedMonth, isSafeReceiptUrl, PAID_FROM_LABELS, receiptFileError, RECEIPT_LIMIT_TEXT,
} from '../../../utils/expenseRules';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a save, so the list and its total reload. */
  onSaved?: () => void;
  expense?: Expense | null;
}

const today = () => new Date().toISOString().split('T')[0];
const PAID_FROM_OPTIONS: ExpensePaidFrom[] = ['momo', 'bank', 'cash'];

export const AddExpenseModal: React.FC<AddExpenseModalProps> = ({ isOpen, onClose, onSaved, expense }) => {
  const { recordExpense, updateExpense } = useFinancialStore();
  const isEditMode = !!expense;
  const [categories, setCategories] = useState<string[]>([]);

  const getDefaultFormData = () => ({
    category: expense?.category || '',
    amount: expense?.amount != null ? String(expense.amount) : '',
    description: expense?.description || '',
    expenseDate: expense?.expenseDate ? new Date(expense.expenseDate).toISOString().split('T')[0] : today(),
    paidFrom: (expense?.paidFrom ?? 'momo') as ExpensePaidFrom,
  });

  const [formData, setFormData] = useState(getDefaultFormData);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // One category list, from the server (F-918)
  useEffect(() => {
    if (!isOpen || categories.length > 0) return;
    financialService.getExpenseCategories().then((r) => setCategories(r.categories)).catch(() => setCategories([]));
  }, [isOpen, categories.length]);

  // Reset the form when the modal opens or a different expense is edited
  useEffect(() => {
    if (!isOpen) return;
    const data = getDefaultFormData();
    setFormData({ ...data, category: data.category || categories[0] || '' });
    setReceiptUrl(expense?.receiptUrl ?? null);
    setReceiptName(null);
    setPendingFile(null);
    setReceiptError(null);
  }, [isOpen, expense?.id]);

  useEffect(() => {
    if (isOpen && !formData.category && categories.length > 0) setFormData((f) => ({ ...f, category: categories[0] }));
  }, [isOpen, categories, formData.category]);

  if (!isOpen) return null;

  const upload = async (file: File) => {
    setUploading(true);
    setReceiptError(null);
    try {
      const url = await financialService.uploadReceipt(file);
      setReceiptUrl(url);
      setReceiptName(file.name);
      setPendingFile(null);
    } catch (error: any) {
      setPendingFile(file); // kept so "Try again" needs no second pick
      setReceiptError(error?.response?.data?.error || error?.response?.data?.message || 'The upload failed. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const problem = receiptFileError(file);
    if (problem) {
      setPendingFile(null);
      setReceiptError(problem);
      return;
    }
    void upload(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const payload = {
        category: formData.category,
        amount: parseFloat(formData.amount),
        description: formData.description,
        expenseDate: formData.expenseDate,
        paidFrom: formData.paidFrom,
        receiptUrl,
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

  const closedMonth = isClosedMonth(formData.expenseDate);
  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose}></div>
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">{isEditMode ? 'Edit Expense' : 'Add Expense'}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="expense-date" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input id="expense-date" type="date" value={formData.expenseDate}
              onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })} className={inputClass} required />
            {closedMonth && (
              <p role="status" className="mt-1 text-sm text-amber-700">{CLOSED_MONTH_NOTICE}</p>
            )}
          </div>

          <div>
            <label htmlFor="expense-amount" className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
            <input id="expense-amount" type="number" step="0.01" min="0.01" value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className={inputClass} placeholder="0.00" required />
          </div>

          <div>
            <label htmlFor="expense-category" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select id="expense-category" value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })} className={inputClass} required>
              {/* A row from before the category list shows its old name until it is changed */}
              {formData.category && !categories.includes(formData.category) && <option value={formData.category}>{formData.category}</option>}
              {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="expense-paid-from" className="block text-sm font-medium text-gray-700 mb-1">Paid from</label>
            <select id="expense-paid-from" value={formData.paidFrom}
              onChange={(e) => setFormData({ ...formData, paidFrom: e.target.value as ExpensePaidFrom })} className={inputClass} required>
              {PAID_FROM_OPTIONS.map((p) => <option key={p} value={p}>{PAID_FROM_LABELS[p]}</option>)}
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
              {uploading ? 'Uploading...' : receiptUrl ? 'Replace receipt' : 'Attach receipt'}
              <input type="file" aria-label="Attach receipt" className="sr-only" accept=".jpg,.jpeg,.png,.webp,.pdf"
                disabled={uploading} onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <p className="mt-1 text-xs text-gray-500">{RECEIPT_LIMIT_TEXT}</p>
            {receiptUrl && !receiptError && (
              <p className="mt-1 text-sm text-green-700">
                {receiptName ?? 'Receipt attached'}{' '}
                {isSafeReceiptUrl(receiptUrl) && <span className="text-gray-400">(saved)</span>}{' '}
                <button type="button" className="text-red-600 hover:underline" onClick={() => { setReceiptUrl(null); setReceiptName(null); }}>Remove</button>
              </p>
            )}
            {receiptError && (
              <p role="alert" className="mt-1 text-sm text-red-600">
                {receiptError}{' '}
                {pendingFile && <button type="button" className="font-semibold underline" onClick={() => void upload(pendingFile)}>Try again</button>}
              </p>
            )}
          </div>

          <p className="text-xs text-gray-500">Posts to account 5100 Operating expenses</p>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={isSubmitting}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={isSubmitting || uploading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {isSubmitting ? (isEditMode ? 'Saving...' : 'Adding...') : (isEditMode ? 'Save Changes' : 'Add Expense')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
