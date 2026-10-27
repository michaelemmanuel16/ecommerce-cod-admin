import type { ExpenseFormRules, ExpensePaidFrom } from '../utils/expenseRules';
import apiClient from './api';

export interface Expense {
  id: string;
  category: string;
  amount: number;
  description: string;
  receiptUrl?: string | null;
  expenseDate: string;
  paidFrom?: ExpensePaidFrom | null;
  /** manual, meta, delivery_fee or ai. Anything but manual is posted by the system. */
  source?: string;
  /** A system row: read-only. */
  locked?: boolean;
  recordedBy?: {
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

/** Fields of a new or changed expense. `receiptUrl: null` clears the receipt. */
export interface ExpenseInput {
  category: string;
  amount: number;
  description: string;
  expenseDate: string;
  paidFrom?: ExpensePaidFrom | null;
  receiptUrl?: string | null;
}

export interface Paging {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface LedgerLine {
  id: number;
  accountId: number;
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
  description: string;
  createdAt: string;
  journalEntry: {
    id: number;
    isVoided: boolean;
    /** From the server's void rules: false for an entry an automatic posting made. */
    voidableByHand: boolean;
    entryNumber: string;
    entryDate: string;
    description: string;
    sourceType: string;
  };
}

export interface AccountLedgerResponse {
  account: { id: number; code: string; name: string; normalBalance: string; currentBalance: number; isActive: boolean };
  transactions: LedgerLine[];
  pagination: Paging;
}

export interface FinanceJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  result?: { filename: string; rows: number; downloadUrl: string };
  error?: string;
}

const JOB_WAIT_MS = 5 * 60 * 1000;

/** A timer that rejects when `signal` aborts. */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

export interface ExpenseCategory {
  category: string;
  totalAmount: number;
  count: number;
}

export interface CollectionRecord {
  id: number;
  orderId: number;
  agentId: number;
  amount: number;
  status: 'draft' | 'verified' | 'approved' | 'deposited' | 'reconciled';
  collectionDate: string;

  verifiedAt?: string;
  approvedAt?: string;
  order: {
    id: number;
    totalAmount: number;
    customer: {
      firstName: string;
      lastName: string;
    }
  }
}

export const financialService = {

  async recordExpense(expense: ExpenseInput): Promise<{ expense: Expense; notice: string | null }> {
    const response = await apiClient.post('/api/financial/expenses', expense);
    return { expense: response.data.expense, notice: response.data.notice ?? null };
  },

  async getExpenseCategories(): Promise<ExpenseFormRules> {
    const response = await apiClient.get('/api/financial/expense-categories');
    return response.data;
  },

  /** POST /api/upload: the stored receipt's URL. The types and size it accepts are the `receipt` limits of `getExpenseCategories`. */
  async uploadReceipt(file: File): Promise<string> {
    const form = new FormData();
    form.append('image', file);
    const response = await apiClient.post('/api/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    return response.data.url;
  },

  async getExpenses(params?: {
    category?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<{ expenses: Expense[]; totalAmount: string; pagination: any }> {
    const response = await apiClient.get('/api/financial/expenses', { params });
    return response.data;
  },

  async getExpenseBreakdown(startDate?: string, endDate?: string): Promise<ExpenseCategory[]> {
    const response = await apiClient.get('/api/financial/expenses/breakdown', {
      params: { startDate, endDate }
    });
    return response.data.breakdown;
  },

  async updateExpense(id: string, data: Partial<ExpenseInput>): Promise<{ expense: Expense; notice: string | null }> {
    const response = await apiClient.put(`/api/financial/expenses/${id}`, data);
    return { expense: response.data.expense, notice: response.data.notice ?? null };
  },

  async deleteExpense(id: string): Promise<{ notice: string | null }> {
    const response = await apiClient.delete(`/api/financial/expenses/${id}`);
    return { notice: response.data.notice ?? null };
  },
  async downloadAgentAgingCSV(): Promise<void> {
    const response = await apiClient.get('/api/financial/agent-aging/export/csv', {
      responseType: 'blob'
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `agent-aging-report-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  // General Ledger Methods
  async getAllGLAccounts(params?: {
    accountType?: string;
    isActive?: boolean;
    search?: string;
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<{ accounts: any[]; pagination: Paging }> {
    const response = await apiClient.get('/api/gl/accounts', { params });
    return response.data;
  },

  async getAccountLedger(accountId: number, params?: {
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<AccountLedgerResponse> {
    const response = await apiClient.get(`/api/gl/accounts/${accountId}/ledger`, { params });
    return response.data;
  },

  /** Trial balance line under the chart: total debits equal total credits. */
  async getTrialBalance(params?: { endDate?: string }): Promise<{ totalDebits: string; totalCredits: string; difference: string; balanced: boolean }> {
    const response = await apiClient.get('/api/gl/trial-balance', { params });
    return response.data;
  },

  /** State of a background finance job (a ledger export over 50,000 lines). */
  async getFinanceJob(id: string, signal?: AbortSignal): Promise<FinanceJob> {
    const response = await apiClient.get(`/api/financial/jobs/${id}`, { signal });
    return response.data;
  },

  /** Polls a job until it is done. Rejects when it fails, when `signal` aborts, or after about 5 minutes. */
  async waitForFinanceJob(id: string, signal?: AbortSignal): Promise<FinanceJob> {
    const deadline = Date.now() + JOB_WAIT_MS;
    for (let delay = 1000; Date.now() < deadline; delay = Math.min(delay * 2, 5000)) {
      await sleep(delay, signal);
      const job = await this.getFinanceJob(id, signal);
      if (job.status === 'failed') throw new Error(job.error ?? 'The export failed');
      if (job.status === 'done' && job.result) return job;
    }
    throw new Error('The export took too long');
  },

  async downloadFinanceJob(downloadUrl: string, signal?: AbortSignal): Promise<Blob> {
    const response = await apiClient.get(downloadUrl, { responseType: 'blob', signal });
    return response.data;
  },

  async voidJournalEntry(entryId: number, voidReason: string): Promise<void> {
    await apiClient.post(`/api/gl/journal-entries/${entryId}/void`, { voidReason });
  },

  async recordJournalEntry(entry: any): Promise<any> {
    const response = await apiClient.post('/api/gl/journal-entries', entry);
    return response.data.entry;
  },

  /**
   * The ledger of one account as a CSV file. A very large ledger answers 202 with a job id: this waits for the job
   * (1 s, 2 s, 4 s, then every 5 s, up to 5 minutes) and downloads its file. `signal` cancels the wait.
   */
  async exportAccountLedger(
    accountId: number,
    params: { startDate?: string; endDate?: string },
    opts: { signal?: AbortSignal; onQueued?: () => void } = {}
  ): Promise<{ blob: Blob; filename: string | null }> {
    const response = await apiClient.get(`/api/gl/accounts/${accountId}/ledger/export`, {
      params,
      responseType: 'blob',
      signal: opts.signal
    });
    if (response.status !== 202) return { blob: response.data, filename: null };

    const { jobId } = JSON.parse(await (response.data as Blob).text());
    opts.onQueued?.();
    const job = await this.waitForFinanceJob(jobId, opts.signal);
    return { blob: await this.downloadFinanceJob(job.result!.downloadUrl, opts.signal), filename: job.result!.filename };
  },

  // Agent Reconciliation Methods
  async getAgentCollections(agentId: number, params?: { status?: string }): Promise<CollectionRecord[]> {
    const response = await apiClient.get('/api/agent-reconciliation', {
      params: { agentId, ...params }
    });
    return response.data;
  },

  async getAgentDeposits(params?: { agentId?: number; status?: string }): Promise<any[]> {
    const response = await apiClient.get('/api/agent-reconciliation/deposits', { params });
    return response.data;
  },

  async createDeposit(data: {
    amount: number;
    depositMethod: string;
    referenceNumber: string;
    notes?: string;
    receiptUrl?: string;
  }): Promise<any> {
    const response = await apiClient.post('/api/agent-reconciliation/deposits', data);
    return response.data;
  },

  async getAgentBalance(agentId: number): Promise<{
    id: number;
    agentId: number;
    totalCollected: number;
    totalDeposited: number;
    currentBalance: number;
    lastSettlementDate?: string;
    isBlocked: boolean;
  } | null> {
    const response = await apiClient.get(`/api/agent-reconciliation/agents/${agentId}/balance`);
    return response.data;
  },
};
