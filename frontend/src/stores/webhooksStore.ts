import { create } from 'zustand';
import { Webhook, PaginationMeta } from '../types';
import { webhooksService } from '../services/webhooks.service';

interface WebhooksState {
  webhooks: Webhook[];
  selectedWebhook: Webhook | null;
  pagination: PaginationMeta;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  fetchWebhooks: () => Promise<void>;
  fetchWebhookById: (id: number) => Promise<void>;
  setSelectedWebhook: (webhook: Webhook | null) => void;
  setPage: (page: number) => void;
  setSearchQuery: (query: string) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useWebhooksStore = create<WebhooksState>((set, get) => ({
  webhooks: [],
  selectedWebhook: null,
  pagination: { page: 1, limit: 20, total: 0, pages: 0 },
  searchQuery: '',
  isLoading: false,
  error: null,

  fetchWebhooks: async () => {
    set({ isLoading: true, error: null });
    try {
      const { pagination, searchQuery } = get();
      const result = await webhooksService.getWebhooks({
        page: pagination.page,
        limit: pagination.limit,
        search: searchQuery || undefined
      });

      set({
        webhooks: result.webhooks,
        pagination: result.pagination || pagination,
        isLoading: false,
        error: null
      });
    } catch (error: any) {
      set({
        isLoading: false,
        error: error.response?.data?.message || error.message || 'Failed to load webhooks'
      });
      throw error;
    }
  },

  fetchWebhookById: async (id: number) => {
    set({ isLoading: true, error: null });
    try {
      const webhook = await webhooksService.getWebhookById(id);
      set({ selectedWebhook: webhook, isLoading: false, error: null });
    } catch (error: any) {
      set({
        isLoading: false,
        error: error.response?.data?.message || error.message || 'Failed to load webhook'
      });
      throw error;
    }
  },

  setSelectedWebhook: (webhook: Webhook | null) => {
    set({ selectedWebhook: webhook });
  },

  setPage: (page: number) => {
    set((state) => ({
      pagination: { ...state.pagination, page },
      error: null
    }));
    get().fetchWebhooks();
  },

  setSearchQuery: (query: string) => {
    // Reset to page 1 when search changes
    set((state) => ({
      searchQuery: query,
      pagination: { ...state.pagination, page: 1 },
      error: null
    }));
    get().fetchWebhooks();
  },

  setError: (error: string | null) => {
    set({ error });
  },

  clearError: () => {
    set({ error: null });
  }
}));
