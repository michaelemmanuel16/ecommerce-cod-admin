import { create } from 'zustand';
import { Product } from '../types';
import apiClient from '../services/api';

interface ProductsState {
  products: Product[];
  selectedProduct: Product | null;
  isLoading: boolean;
  fetchProducts: () => Promise<void>;
  setSelectedProduct: (product: Product | null) => void;
}

export const useProductsStore = create<ProductsState>((set) => ({
  products: [],
  selectedProduct: null,
  isLoading: false,

  fetchProducts: async () => {
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/api/products');
      const data = response.data;
      set({ products: Array.isArray(data) ? data : data.products || [], isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  setSelectedProduct: (product: Product | null) => {
    set({ selectedProduct: product });
  },
}));
