import { create } from 'zustand';
import {
  financialService,
  FinancialSummary,
  Transaction,
  CODCollection,
  FinancialReport,
  Expense,
  ExpenseCategory,
  AgentCashHolding,
  AgentAgingBucket,
  AgentAgingReport,
  PipelineRevenue,
  ProfitMargins,
  ProfitabilityAnalysis,
  CashFlowReport
} from '../services/financial.service';
import { getSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface FinancialFilters {
  startDate?: string;
  endDate?: string;
  type?: string;
  status?: string;
  agentId?: string;
  category?: string;
  page?: number;
  limit?: number;
}

interface FinancialState {
  // Existing state
  summary: FinancialSummary | null;
  transactions: Transaction[];
  codCollections: CODCollection[];
  reports: FinancialReport[];

  // New state
  expenses: Expense[];
  expenseBreakdown: ExpenseCategory[];
  agentCashHoldings: AgentCashHolding[];
  pipelineRevenue: PipelineRevenue | null;
  profitMargins: ProfitMargins | null;
  profitabilityAnalysis: ProfitabilityAnalysis | null;
  agentAging: AgentAgingReport | null;
  cashFlowReport: CashFlowReport | null;

  // Filters and UI state
  filters: FinancialFilters;
  dateRange: { startDate?: string; endDate?: string };
  isLoading: boolean;
  error: string | null;
  loadingStates: {
    summary: boolean;
    collections: boolean;
    expenses: boolean;
    agents: boolean;
    reports: boolean;
    profitability: boolean;
    cashFlow: boolean;
  };
  pagination: {
    transactions: { page: number; totalPages: number; total: number } | null;
    collections: { page: number; totalPages: number; total: number } | null;
    expenses: { page: number; totalPages: number; total: number } | null;
  };

  // Existing actions
  fetchSummary: (startDate?: string, endDate?: string) => Promise<void>;
  fetchTransactions: (filters?: FinancialFilters) => Promise<void>;
  fetchCODCollections: (filters?: FinancialFilters) => Promise<void>;
  fetchReports: (period?: 'daily' | 'monthly', startDate?: string, endDate?: string) => Promise<void>;
  recordExpense: (expense: {
    category: string;
    amount: number;
    description: string;
    expenseDate: string;
  }) => Promise<void>;
  setFilters: (filters: FinancialFilters) => void;
  addTransaction: (transaction: Transaction) => void;
  updateTransaction: (transaction: Transaction) => void;

  // New actions
  fetchExpenses: (filters?: FinancialFilters) => Promise<void>;
  fetchExpenseBreakdown: (startDate?: string, endDate?: string) => Promise<void>;
  fetchAgentCashHoldings: () => Promise<void>;
  fetchPipelineRevenue: (startDate?: string, endDate?: string) => Promise<void>;
  fetchProfitMargins: (startDate?: string, endDate?: string) => Promise<void>;
  fetchProfitabilityAnalysis: (params: { startDate?: string; endDate?: string; productId?: number }) => Promise<void>;
  exportProfitability: (params: { startDate?: string; endDate?: string; productId?: number; format: 'csv' | 'xlsx' }) => Promise<void>;
  fetchAgentAging: () => Promise<void>;
  updateExpense: (id: string, data: {
    category?: string;
    amount?: number;
    description?: string;
    expenseDate?: string;
  }) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  markAsDeposited: (transactionIds: string[], reference?: string) => Promise<void>;
  reconcileTransaction: (id: string, data: {
    status: string;
    reference?: string;
    notes?: string;
  }) => Promise<void>;
  fetchCashFlowReport: () => Promise<void>;
  downloadCashFlowCSV: () => Promise<void>;
  setDateRange: (startDate?: string, endDate?: string) => void;
}

export const useFinancialStore = create<FinancialState>((set, get) => {
  // Initialize Socket.io listeners
  const socket = getSocket();
  if (socket) {
    // Existing listeners
    socket.on('transaction:created', (data: Transaction) => {
      get().addTransaction(data);
      get().fetchSummary();
    });

    socket.on('transaction:updated', (data: Transaction) => {
      get().updateTransaction(data);
    });

    socket.on('cod:collected', (data: CODCollection) => {
      set((state) => ({
        codCollections: [data, ...state.codCollections],
      }));
      get().fetchSummary();
    });

    // New listeners
    socket.on('expense:created', (data: Expense) => {
      set((state) => ({
        expenses: [data, ...state.expenses],
      }));
      get().fetchExpenseBreakdown();
      get().fetchSummary();
    });

    socket.on('expense:updated', (data: Expense) => {
      set((state) => ({
        expenses: state.expenses.map(e => e.id === data.id ? data : e)
      }));
      get().fetchExpenseBreakdown();
      get().fetchSummary();
    });

    socket.on('expense:deleted', (data: { id: string }) => {
      set((state) => ({
        expenses: state.expenses.filter(e => e.id !== data.id)
      }));
      get().fetchExpenseBreakdown();
      get().fetchSummary();
    });

    socket.on('transaction:deposited', () => {
      get().fetchCODCollections();
      get().fetchAgentCashHoldings();
      get().fetchSummary();
    });

    socket.on('transaction:reconciled', (data: Transaction) => {
      get().updateTransaction(data);
      get().fetchSummary();
    });
  }

  return {
    // Existing state
    summary: null,
    transactions: [],
    codCollections: [],
    reports: [],

    // New state
    expenses: [],
    expenseBreakdown: [],
    agentCashHoldings: [],
    pipelineRevenue: null,
    profitMargins: null,
    profitabilityAnalysis: null,
    agentAging: null,
    cashFlowReport: null,

    // Filters and UI state
    filters: {},
    dateRange: {},
    isLoading: false,
    error: null,
    loadingStates: {
      summary: false,
      collections: false,
      expenses: false,
      agents: false,
      reports: false,
      profitability: false,
      cashFlow: false,
    },
    pagination: {
      transactions: null,
      collections: null,
      expenses: null,
    },

    fetchSummary: async (startDate?: string, endDate?: string) => {
      set((state) => ({ loadingStates: { ...state.loadingStates, summary: true }, error: null }));
      try {
        const summary = await financialService.getFinancialSummary(startDate, endDate);
        set((state) => ({ summary, loadingStates: { ...state.loadingStates, summary: false } }));
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch financial summary';
        set((state) => ({ error: errorMessage, loadingStates: { ...state.loadingStates, summary: false } }));
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchTransactions: async (filters?: FinancialFilters) => {
      set({ isLoading: true, error: null });
      try {
        const response = await financialService.getTransactions(filters);
        set({
          transactions: response.transactions,
          pagination: {
            ...get().pagination,
            transactions: response.pagination
          },
          isLoading: false
        });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch transactions';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchCODCollections: async (filters?: FinancialFilters) => {
      set({ isLoading: true, error: null });
      try {
        const response = await financialService.getCODCollections(filters);
        set({
          codCollections: response.collections,
          pagination: {
            ...get().pagination,
            collections: response.pagination
          },
          isLoading: false
        });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch COD collections';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchReports: async (period?: 'daily' | 'monthly', startDate?: string, endDate?: string) => {
      set((state) => ({ loadingStates: { ...state.loadingStates, reports: true }, error: null }));
      try {
        const reports = await financialService.getFinancialReports({ period, startDate, endDate });
        set((state) => ({ reports, loadingStates: { ...state.loadingStates, reports: false } }));
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch financial reports';
        set((state) => ({ error: errorMessage, loadingStates: { ...state.loadingStates, reports: false } }));
        toast.error(errorMessage);
        throw error;
      }
    },

    recordExpense: async (expense) => {
      try {
        await financialService.recordExpense(expense);
        toast.success('Expense recorded successfully');
        // Refresh data
        await Promise.all([
          get().fetchSummary(),
          get().fetchTransactions(get().filters)
        ]);
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to record expense';
        toast.error(errorMessage);
        throw error;
      }
    },

    setFilters: (filters: FinancialFilters) => {
      set({ filters });
    },

    addTransaction: (transaction: Transaction) => {
      set((state) => ({
        transactions: [transaction, ...state.transactions],
      }));
    },

    updateTransaction: (transaction: Transaction) => {
      set((state) => ({
        transactions: state.transactions.map((t) =>
          t.id === transaction.id ? transaction : t
        ),
      }));
    },

    fetchExpenses: async (filters?: FinancialFilters) => {
      set((state) => ({ loadingStates: { ...state.loadingStates, expenses: true }, error: null }));
      try {
        const response = await financialService.getExpenses(filters);
        set((state) => ({
          expenses: response.expenses,
          pagination: {
            ...state.pagination,
            expenses: response.pagination
          },
          loadingStates: { ...state.loadingStates, expenses: false }
        }));
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch expenses';
        set((state) => ({ error: errorMessage, loadingStates: { ...state.loadingStates, expenses: false } }));
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchExpenseBreakdown: async (startDate?: string, endDate?: string) => {
      try {
        const breakdown = await financialService.getExpenseBreakdown(startDate, endDate);
        set({ expenseBreakdown: breakdown });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch expense breakdown';
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchAgentCashHoldings: async () => {
      set((state) => ({ loadingStates: { ...state.loadingStates, agents: true }, error: null }));
      try {
        const holdings = await financialService.getAgentCashHoldings();
        set((state) => ({
          agentCashHoldings: holdings,
          loadingStates: { ...state.loadingStates, agents: false }
        }));
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch agent cash holdings';
        set((state) => ({ error: errorMessage, loadingStates: { ...state.loadingStates, agents: false } }));
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchPipelineRevenue: async (startDate?: string, endDate?: string) => {
      try {
        const pipelineRevenue = await financialService.getPipelineRevenue(startDate, endDate);
        set({ pipelineRevenue });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch pipeline revenue';
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchProfitMargins: async (startDate?: string, endDate?: string) => {
      try {
        const profitMargins = await financialService.getProfitMargins(startDate, endDate);
        set({ profitMargins });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch profit margins';
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchProfitabilityAnalysis: async (params) => {
      set((state) => ({ loadingStates: { ...state.loadingStates, profitability: true }, error: null }));
      try {
        const profitabilityAnalysis = await financialService.getProfitabilityAnalysis(params);
        set((state) => ({
          profitabilityAnalysis,
          loadingStates: { ...state.loadingStates, profitability: false }
        }));
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch profitability analysis';
        set((state) => ({ error: errorMessage, loadingStates: { ...state.loadingStates, profitability: false } }));
        toast.error(errorMessage);
        throw error;
      }
    },

    exportProfitability: async (params) => {
      try {
        const data = await financialService.exportProfitability(params);
        const url = window.URL.createObjectURL(new Blob([data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `profitability_report_${Date.now()}.${params.format}`);
        document.body.appendChild(link);
        link.click();
        link.parentNode?.removeChild(link);
        window.URL.revokeObjectURL(url);
        toast.success(`Exporting profitability analysis as ${params.format.toUpperCase()}`);
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to export profitability analysis';
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchAgentAging: async () => {
      set((state) => ({ loadingStates: { ...state.loadingStates, agents: true }, error: null }));
      try {
        const report = await financialService.getAgentAging();
        set((state) => ({
          agentAging: report,
          loadingStates: { ...state.loadingStates, agents: false }
        }));
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch agent aging data';
        set((state) => ({ error: errorMessage, loadingStates: { ...state.loadingStates, agents: false } }));
        toast.error(errorMessage);
        throw error;
      }
    },

    updateExpense: async (id: string, data: {
      category?: string;
      amount?: number;
      description?: string;
      expenseDate?: string;
    }) => {
      try {
        const updated = await financialService.updateExpense(id, data);
        set((state) => ({
          expenses: state.expenses.map(e => e.id === id ? updated : e)
        }));
        toast.success('Expense updated successfully');
        await get().fetchExpenseBreakdown();
        await get().fetchSummary();
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to update expense';
        toast.error(errorMessage);
        throw error;
      }
    },

    deleteExpense: async (id: string) => {
      try {
        await financialService.deleteExpense(id);
        set((state) => ({
          expenses: state.expenses.filter(e => e.id !== id)
        }));
        toast.success('Expense deleted successfully');
        await get().fetchExpenseBreakdown();
        await get().fetchSummary();
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to delete expense';
        toast.error(errorMessage);
        throw error;
      }
    },

    markAsDeposited: async (transactionIds: string[], reference?: string) => {
      try {
        await financialService.markAsDeposited(transactionIds, reference);
        toast.success('Collections marked as deposited successfully');
        await Promise.all([
          get().fetchCODCollections(),
          get().fetchAgentCashHoldings(),
          get().fetchSummary()
        ]);
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to mark as deposited';
        toast.error(errorMessage);
        throw error;
      }
    },

    reconcileTransaction: async (id: string, data: {
      status: string;
      reference?: string;
      notes?: string;
    }) => {
      try {
        await financialService.reconcileTransaction(id, data);
        toast.success('Transaction reconciled successfully');
        await Promise.all([
          get().fetchTransactions(get().filters),
          get().fetchSummary()
        ]);
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to reconcile transaction';
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchCashFlowReport: async () => {
      set((state) => ({ loadingStates: { ...state.loadingStates, cashFlow: true }, error: null }));
      try {
        const report = await financialService.getCashFlowReport();
        set((state) => ({
          cashFlowReport: report,
          loadingStates: { ...state.loadingStates, cashFlow: false }
        }));
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch cash flow report';
        set((state) => ({ error: errorMessage, loadingStates: { ...state.loadingStates, cashFlow: false } }));
        toast.error(errorMessage);
        throw error;
      }
    },

    downloadCashFlowCSV: async () => {
      try {
        await financialService.downloadCashFlowCSV();
        toast.success('Cash Flow Report downloaded');
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to download CSV';
        toast.error(errorMessage);
        throw error;
      }
    },

    setDateRange: (startDate?: string, endDate?: string) => {
      set({ dateRange: { startDate, endDate } });
    },
  };
});
