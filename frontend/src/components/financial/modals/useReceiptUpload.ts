import { useState } from 'react';
import { financialService } from '../../../services/financial.service';
import { ExpenseFormRules, receiptFileError } from '../../../utils/expenseRules';

interface ReceiptState {
  url: string | null;
  name: string | null;
  /** A file that failed to upload, kept so "Try again" needs no second pick. */
  pending: File | null;
  error: string | null;
  uploading: boolean;
}

const EMPTY: ReceiptState = { url: null, name: null, pending: null, error: null, uploading: false };

/** The receipt of an expense: pick, check against the server limits, upload, retry, remove. */
export function useReceiptUpload(rules: ExpenseFormRules['receipt'] | undefined) {
  const [state, setState] = useState<ReceiptState>(EMPTY);

  const upload = async (file: File) => {
    setState((s) => ({ ...s, uploading: true, error: null }));
    try {
      const url = await financialService.uploadReceipt(file);
      setState({ url, name: file.name, pending: null, error: null, uploading: false });
    } catch (error: any) {
      setState((s) => ({
        ...s, uploading: false, pending: file,
        error: error?.response?.data?.error || error?.response?.data?.message || 'The upload failed. Check your connection and try again.',
      }));
    }
  };

  return {
    ...state,
    reset: (url: string | null) => setState({ ...EMPTY, url }),
    remove: () => setState(EMPTY),
    pick: (file: File | undefined) => {
      if (!file) return;
      const problem = rules ? receiptFileError(file, rules) : null;
      if (problem) setState((s) => ({ ...s, pending: null, error: problem }));
      else void upload(file);
    },
    retry: () => { if (state.pending) void upload(state.pending); },
  };
}
