import { create } from 'zustand';
import {
  financialService,
  FinancialSummary,
  Transaction,
  CODCollection,
  FinancialReport
} from '../services/financial.service';
import { getSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface FinancialFilters {
  startDate?: string;
  endDate?: string;
  type?: string;
  status?: string;
  agentId?: string;
  page?: number;
  limit?: number;
}

interface FinancialState {
  summary: FinancialSummary | null;
  transactions: Transaction[];
  codCollections: CODCollection[];
  reports: FinancialReport[];
  filters: FinancialFilters;
  isLoading: boolean;
  error: string | null;
  pagination: {
    transactions: { page: number; totalPages: number; total: number } | null;
    collections: { page: number; totalPages: number; total: number } | null;
  };
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
}

export const useFinancialStore = create<FinancialState>((set, get) => {
  // Initialize Socket.io listeners
  const socket = getSocket();
  if (socket) {
    socket.on('transaction:created', (data: Transaction) => {
      get().addTransaction(data);
      // Refresh summary when new transaction is created
      get().fetchSummary();
    });

    socket.on('transaction:updated', (data: Transaction) => {
      get().updateTransaction(data);
    });

    socket.on('cod:collected', (data: CODCollection) => {
      set((state) => ({
        codCollections: [data, ...state.codCollections],
      }));
      // Refresh summary when COD is collected
      get().fetchSummary();
    });
  }

  return {
    summary: null,
    transactions: [],
    codCollections: [],
    reports: [],
    filters: {},
    isLoading: false,
    error: null,
    pagination: {
      transactions: null,
      collections: null,
    },

    fetchSummary: async (startDate?: string, endDate?: string) => {
      set({ isLoading: true, error: null });
      try {
        const summary = await financialService.getFinancialSummary(startDate, endDate);
        set({ summary, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch financial summary';
        set({ error: errorMessage, isLoading: false });
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
      set({ isLoading: true, error: null });
      try {
        const reports = await financialService.getFinancialReports({ period, startDate, endDate });
        set({ reports, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch financial reports';
        set({ error: errorMessage, isLoading: false });
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
  };
});
