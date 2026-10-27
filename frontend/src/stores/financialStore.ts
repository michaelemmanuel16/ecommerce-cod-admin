import { create } from 'zustand';
import {
  financialService,
  Paging,
  ExpenseInput,
  Expense,
  ExpenseCategory,
} from '../services/financial.service';
import { getSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface FinancialFilters {
  startDate?: string;
  endDate?: string;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

interface FinancialState {
  expenses: Expense[];
  /** Sum of every expense the filters match (all pages). */
  expensesTotal: number;
  expenseBreakdown: ExpenseCategory[];

  dateRange: { startDate?: string; endDate?: string };
  expensesLoading: boolean;
  expensesPagination: Paging | null;

  recordExpense: (expense: ExpenseInput) => Promise<void>;
  fetchExpenses: (filters?: FinancialFilters) => Promise<void>;
  fetchExpenseBreakdown: (startDate?: string, endDate?: string) => Promise<void>;
  updateExpense: (id: string, data: Partial<ExpenseInput>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  setDateRange: (startDate?: string, endDate?: string) => void;
}

export const useFinancialStore = create<FinancialState>((set, get) => {
  const socket = getSocket();
  if (socket) {
    socket.on('expense:created', (data: Expense) => {
      set((state) => ({
        expenses: [data, ...state.expenses],
      }));
      get().fetchExpenseBreakdown();
    });

    socket.on('expense:updated', (data: Expense) => {
      set((state) => ({
        expenses: state.expenses.map(e => e.id === data.id ? data : e)
      }));
      get().fetchExpenseBreakdown();
    });

    socket.on('expense:deleted', (data: { id: string }) => {
      set((state) => ({
        expenses: state.expenses.filter(e => e.id !== data.id)
      }));
      get().fetchExpenseBreakdown();
    });
  }

  return {
    expenses: [],
    expensesTotal: 0,
    expenseBreakdown: [],

    dateRange: (() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const endOfToday = new Date(now);
      endOfToday.setHours(23, 59, 59, 999);
      return {
        startDate: `${year}-${month}-01`,
        endDate: endOfToday.toISOString()
      };
    })(),
    expensesLoading: false,
    expensesPagination: null,

    recordExpense: async (expense) => {
      try {
        const { notice } = await financialService.recordExpense(expense);
        toast.success('Expense recorded successfully');
        if (notice) toast(notice, { icon: '!' });
      } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Failed to record expense';
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchExpenses: async (filters?: FinancialFilters) => {
      set({ expensesLoading: true });
      try {
        const response = await financialService.getExpenses(filters);
        set({
          expenses: response.expenses,
          expensesTotal: Number(response.totalAmount ?? 0),
          expensesPagination: response.pagination,
          expensesLoading: false
        });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch expenses';
        set({ expensesLoading: false });
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

    updateExpense: async (id: string, data: Partial<ExpenseInput>) => {
      try {
        const { expense: updated, notice } = await financialService.updateExpense(id, data);
        set((state) => ({
          expenses: state.expenses.map(e => e.id === id ? updated : e)
        }));
        toast.success('Expense updated successfully');
        if (notice) toast(notice, { icon: '!' });
      } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Failed to update expense';
        toast.error(errorMessage);
        throw error;
      }
    },

    deleteExpense: async (id: string) => {
      try {
        const { notice } = await financialService.deleteExpense(id);
        set((state) => ({
          expenses: state.expenses.filter(e => e.id !== id)
        }));
        toast.success('Expense deleted successfully');
        if (notice) toast(notice, { icon: '!' });
      } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Failed to delete expense';
        toast.error(errorMessage);
        throw error;
      }
    },

    setDateRange: (startDate?: string, endDate?: string) => {
      set({ dateRange: { startDate, endDate } });
    }
  };
});
