import { create } from 'zustand';
import { Customer } from '../types';
import { customersService } from '../services/customers.service';

interface CustomersState {
  customers: Customer[];
  selectedCustomer: Customer | null;
  isLoading: boolean;
  fetchCustomers: () => Promise<void>;
  fetchCustomerById: (id: string) => Promise<void>;
  setSelectedCustomer: (customer: Customer | null) => void;
}

export const useCustomersStore = create<CustomersState>((set) => ({
  customers: [],
  selectedCustomer: null,
  isLoading: false,

  fetchCustomers: async () => {
    set({ isLoading: true });
    try {
      const customers = await customersService.getCustomers();
      set({ customers, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  fetchCustomerById: async (id: string) => {
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
}));
