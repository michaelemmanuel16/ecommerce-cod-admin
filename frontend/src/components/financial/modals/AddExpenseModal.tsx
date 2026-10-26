import React, { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Button, Input, Modal, Select } from '../../ui-v2';
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
    <Modal
      open={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit expense' : 'Add expense'}
      description="Money you spent that is not ad spend or a delivery fee."
      footer={
        <>
          <span className="mfnote">Posts to account 5100 Operating Expenses.</span>
          <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="expense-form" variant="primary" disabled={isSubmitting || receipt.uploading}>
            {isSubmitting ? 'Saving...' : 'Save expense'}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={handleSubmit} className="cform">
        <div>
          <Input id="expense-date" label="Date" type="date" value={formData.expenseDate}
            onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })} required />
          {closedMonth && <p role="status" className="hint warn">{rules!.closedNotice}</p>}
        </div>
        <Input id="expense-amount" label="Amount" type="number" step="0.01" min="0.01" value={formData.amount} placeholder="0.00"
          onChange={(e) => setFormData({ ...formData, amount: e.target.value })} required />
        <Select id="expense-category" label="Category" value={category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })} required>
          {/* A row from before the category list shows its old name until it is changed */}
          {category && !categories.includes(category) && <option value={category}>{category}</option>}
          {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
        </Select>
        <Select id="expense-paid-from" label="Paid from" value={formData.paidFrom}
          onChange={(e) => setFormData({ ...formData, paidFrom: e.target.value as ExpensePaidFrom })} required>
          {PAID_FROM.map((p) => <option key={p} value={p}>{PAID_FROM_LABELS[p]}</option>)}
        </Select>
        <Input id="expense-description" className="span2" label="Description" type="text" value={formData.description} placeholder="What was it for?"
          onChange={(e) => setFormData({ ...formData, description: e.target.value })} required />

        <div className="fl span2">
          <label>Receipt <span className="opt">(optional)</span></label>
          <div className="revreceipt sm">
            <div>
              <Paperclip />
              {receipt.url && !receipt.error && (
                <b>
                  {receipt.name ?? 'Receipt attached'}{' '}
                  {isSafeReceiptUrl(receipt.url) && <span>(saved)</span>}
                </b>
              )}
              {rules && <small>{receiptLimitText(rules.receipt)}</small>}
              <p>
                <label className="btn file">
                  {receipt.uploading ? 'Uploading...' : receipt.url ? 'Replace receipt' : 'Attach receipt'}
                  <input type="file" aria-label="Attach receipt" className="sr-only" accept={rules?.receipt.mimeTypes.join(',')}
                    disabled={receipt.uploading} onChange={(e) => { receipt.pick(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {receipt.url && !receipt.error && <> <button type="button" className="mini" onClick={receipt.remove}>Remove</button></>}
              </p>
            </div>
          </div>
          {receipt.error && (
            <p role="alert" className="err">
              {receipt.error}{' '}
              {receipt.pending && <button type="button" className="mini" onClick={receipt.retry}>Try again</button>}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
};
