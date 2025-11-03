import { create } from 'zustand';
import { Customer, PaginationMeta } from '../types';
import { customersService } from '../services/customers.service';

interface CustomersState {
  customers: Customer[];
  selectedCustomer: Customer | null;
  pagination: PaginationMeta;
  searchQuery: string;
  isLoading: boolean;
  fetchCustomers: () => Promise<void>;
  fetchCustomerById: (id: number) => Promise<void>;
  setSelectedCustomer: (customer: Customer | null) => void;
  setPage: (page: number) => void;
  setSearchQuery: (query: string) => void;
}

export const useCustomersStore = create<CustomersState>((set, get) => ({
  customers: [],
  selectedCustomer: null,
  pagination: { page: 1, limit: 20, total: 0, pages: 0 },
  searchQuery: '',
  isLoading: false,

  fetchCustomers: async () => {
    set({ isLoading: true });
    try {
      const { pagination, searchQuery } = get();
      const { customers, pagination: newPagination } = await customersService.getCustomers({
        page: pagination.page,
        limit: pagination.limit,
        search: searchQuery || undefined
      });
      set({ customers, pagination: newPagination, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchCustomerById: async (id: number) => {
    set({ isLoading: true });
    try {
      const customer = await customersService.getCustomerById(id);
      set({ selectedCustomer: customer, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  setSelectedCustomer: (customer: Customer | null) => {
    set({ selectedCustomer: customer });
  },

  setPage: (page: number) => {
    set((state) => ({ pagination: { ...state.pagination, page } }));
    get().fetchCustomers();
  },

  setSearchQuery: (query: string) => {
    // Reset to page 1 when search changes
    set((state) => ({
      searchQuery: query,
      pagination: { ...state.pagination, page: 1 }
    }));
    get().fetchCustomers();
  },
}));
