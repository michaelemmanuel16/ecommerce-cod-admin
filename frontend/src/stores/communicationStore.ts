import { create } from 'zustand';
import {
  communicationService,
  MessageLog,
  MessageStats,
  SmsTemplate,
  Recipient,
} from '../services/communication.service';
import toast from 'react-hot-toast';

interface CommunicationState {
  messages: MessageLog[];
  pagination: { page: number; limit: number; total: number; totalPages: number } | null;
  stats: MessageStats | null;
  templates: SmsTemplate[];
  recipients: Recipient[];
  optOutCustomers: any[];
  optOutPagination: { page: number; limit: number; total: number; totalPages: number } | null;
  isLoading: boolean;
  isLoadingMessages: boolean;
  isLoadingStats: boolean;
  isLoadingTemplates: boolean;
  isLoadingRecipients: boolean;
  isLoadingOptOuts: boolean;
  fetchMessages: (params?: Record<string, any>) => Promise<void>;
  fetchStats: (startDate?: string, endDate?: string) => Promise<void>;
  fetchTemplates: () => Promise<void>;
  fetchRecipients: (filters: Record<string, any>) => Promise<void>;
  fetchOptOutCustomers: (page?: number, limit?: number) => Promise<void>;
}

export const useCommunicationStore = create<CommunicationState>((set) => ({
  messages: [],
  pagination: null,
  stats: null,
  templates: [],
  recipients: [],
  optOutCustomers: [],
  optOutPagination: null,
  isLoading: false,
  isLoadingMessages: false,
  isLoadingStats: false,
  isLoadingTemplates: false,
  isLoadingRecipients: false,
  isLoadingOptOuts: false,

  fetchMessages: async (params?: Record<string, any>) => {
    set({ isLoadingMessages: true });
    try {
      const data = await communicationService.getMessages(params);
      set({ messages: data.messages, pagination: data.pagination, isLoadingMessages: false });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to fetch messages';
      console.error(errorMessage, error);
      set({ isLoadingMessages: false });
    }
  },

  fetchStats: async (startDate?: string, endDate?: string) => {
    set({ isLoadingStats: true });
    try {
      const stats = await communicationService.getStats(startDate, endDate);
      set({ stats, isLoadingStats: false });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to fetch stats';
      console.error(errorMessage, error);
      set({ isLoadingStats: false });
    }
  },

  fetchTemplates: async () => {
    set({ isLoadingTemplates: true });
    try {
      const templates = await communicationService.getTemplates();
      set({ templates, isLoadingTemplates: false });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to fetch templates';
      console.error(errorMessage, error);
      set({ isLoadingTemplates: false });
    }
  },

  fetchRecipients: async (filters: Record<string, any>) => {
    set({ isLoadingRecipients: true });
    try {
      const recipients = await communicationService.getRecipients(filters);
      set({ recipients, isLoadingRecipients: false });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to fetch recipients';
      console.error(errorMessage, error);
      set({ isLoadingRecipients: false });
    }
  },

  fetchOptOutCustomers: async (page?: number, limit?: number) => {
    set({ isLoadingOptOuts: true });
    try {
      const data = await communicationService.getOptOutCustomers(page, limit);
      set({
        optOutCustomers: data.customers,
        optOutPagination: data.pagination,
        isLoadingOptOuts: false,
      });
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Failed to fetch opt-out customers';
      console.error(errorMessage, error);
      set({ isLoadingOptOuts: false });
    }
  },
}));
