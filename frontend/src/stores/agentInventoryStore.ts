import { create } from 'zustand';
import {
  agentInventoryService,
  ProductAgentStockResponse,
  AgentInventoryResponse,
  InventorySummaryResponse,
  TransferHistoryResponse,
} from '../services/agent-inventory.service';
import toast from 'react-hot-toast';

interface TransferHistoryParams {
  productId?: number;
  agentId?: number;
  type?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

interface AgentInventoryState {
  // Product agent stock cache keyed by productId
  productAgentStock: Record<number, ProductAgentStockResponse>;
  agentInventory: AgentInventoryResponse | null;
  summary: InventorySummaryResponse | null;
  transferHistory: TransferHistoryResponse | null;
  isLoadingInventory: boolean;
  isLoadingSummary: boolean;
  isLoadingHistory: boolean;
  error: string | null;

  fetchProductAgentStock: (productId: number) => Promise<void>;
  fetchAgentInventory: (agentId: number) => Promise<void>;
  fetchSummary: () => Promise<void>;
  fetchTransferHistory: (params?: TransferHistoryParams) => Promise<void>;
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
  agentInventory: null,
  summary: null,
  transferHistory: null,
  isLoadingInventory: false,
  isLoadingSummary: false,
  isLoadingHistory: false,
  error: null,

  fetchProductAgentStock: async (productId: number) => {
    set({ isLoadingInventory: true, error: null });
    try {
      const data = await agentInventoryService.getProductAgentStock(productId);
      set((state) => ({
        productAgentStock: { ...state.productAgentStock, [productId]: data },
        isLoadingInventory: false,
      }));
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to fetch agent stock';
      set({ error: msg, isLoadingInventory: false });
    }
  },

  fetchAgentInventory: async (agentId: number) => {
    set({ isLoadingInventory: true, error: null });
    try {
      const data = await agentInventoryService.getAgentInventory(agentId);
      set({ agentInventory: data, isLoadingInventory: false });
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to fetch agent inventory';
      set({ error: msg, isLoadingInventory: false });
    }
  },

  fetchSummary: async () => {
    set({ isLoadingSummary: true, error: null });
    try {
      const data = await agentInventoryService.getSummary();
      set({ summary: data, isLoadingSummary: false });
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to fetch inventory summary';
      set({ error: msg, isLoadingSummary: false });
    }
  },

  fetchTransferHistory: async (params) => {
    set({ isLoadingHistory: true, error: null });
    try {
      const data = await agentInventoryService.getTransferHistory(params);
      set({ transferHistory: data, isLoadingHistory: false });
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to fetch transfer history';
      set({ error: msg, isLoadingHistory: false });
    }
  },

  allocateStock: async (data) => {
    try {
      await agentInventoryService.allocateStock(data);
      toast.success('Stock allocated to agent');
      await Promise.all([get().fetchProductAgentStock(data.productId), get().fetchSummary()]);
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
      await Promise.all([get().fetchProductAgentStock(data.productId), get().fetchSummary()]);
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
      await Promise.all([get().fetchProductAgentStock(data.productId), get().fetchSummary()]);
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
      await Promise.all([get().fetchProductAgentStock(data.productId), get().fetchSummary()]);
    } catch (error: any) {
      const msg = error.response?.data?.error || 'Failed to adjust stock';
      toast.error(msg);
      throw error;
    }
  },
}));
