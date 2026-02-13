import { create } from 'zustand';
import {
  agentInventoryService,
  ProductAgentStockResponse,
  AgentStockItem,
} from '../services/agent-inventory.service';
import toast from 'react-hot-toast';

interface AgentInventoryState {
  // Product agent stock cache keyed by productId
  productAgentStock: Record<number, ProductAgentStockResponse>;
  isLoading: boolean;
  error: string | null;

  fetchProductAgentStock: (productId: number) => Promise<void>;
  allocateStock: (data: {
    productId: number;
    agentId: number;
    quantity: number;
    notes?: string;
  }) => Promise<void>;
  transferStock: (data: {
    productId: number;
    fromAgentId: number;
    toAgentId: number;
    quantity: number;
    notes?: string;
  }) => Promise<void>;
  returnStock: (data: {
    productId: number;
    agentId: number;
    quantity: number;
    notes?: string;
  }) => Promise<void>;
  adjustStock: (data: {
    productId: number;
    agentId: number;
    newQuantity: number;
    notes: string;
  }) => Promise<void>;
}

export const useAgentInventoryStore = create<AgentInventoryState>((set, get) => ({
  productAgentStock: {},
  isLoading: false,
  error: null,

  fetchProductAgentStock: async (productId: number) => {
    set({ isLoading: true, error: null });
    try {
      const data = await agentInventoryService.getProductAgentStock(productId);
      set((state) => ({
        productAgentStock: { ...state.productAgentStock, [productId]: data },
        isLoading: false,
      }));
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to fetch agent stock';
      set({ error: msg, isLoading: false });
    }
  },

  allocateStock: async (data) => {
    try {
      await agentInventoryService.allocateStock(data);
      toast.success('Stock allocated to agent');
      // Refresh the product's agent stock
      await get().fetchProductAgentStock(data.productId);
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to allocate stock';
      toast.error(msg);
      throw error;
    }
  },

  transferStock: async (data) => {
    try {
      await agentInventoryService.transferStock(data);
      toast.success('Stock transferred between agents');
      await get().fetchProductAgentStock(data.productId);
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to transfer stock';
      toast.error(msg);
      throw error;
    }
  },

  returnStock: async (data) => {
    try {
      await agentInventoryService.returnStock(data);
      toast.success('Stock returned to warehouse');
      await get().fetchProductAgentStock(data.productId);
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to return stock';
      toast.error(msg);
      throw error;
    }
  },

  adjustStock: async (data) => {
    try {
      await agentInventoryService.adjustStock(data);
      toast.success('Agent stock adjusted');
      await get().fetchProductAgentStock(data.productId);
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to adjust stock';
      toast.error(msg);
      throw error;
    }
  },
}));
