import { create } from 'zustand';
import { callsService, CreateCallData, CallFilters } from '../services/calls.service';
import { Call, CallStats } from '../types';
import { getSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface CallsState {
  calls: Call[];
  stats: CallStats[];
  isLoading: boolean;
  error: string | null;

  createCall: (data: CreateCallData) => Promise<void>;
  fetchCalls: (filters?: CallFilters) => Promise<void>;
  fetchCallStats: (filters?: { salesRepId?: number; startDate?: string; endDate?: string }) => Promise<void>;
  addCallToStore: (call: Call) => void;
}

export const useCallsStore = create<CallsState>((set, get) => {
  // Initialize Socket.io listeners
  const socket = getSocket();
  if (socket) {
    socket.on('call:logged', (call: Call) => {
      get().addCallToStore(call);
      toast.success('Call logged successfully');
    });
  }

  return {
    calls: [],
    stats: [],
    isLoading: false,
    error: null,

    createCall: async (data: CreateCallData) => {
      try {
        const call = await callsService.createCall(data);
        get().addCallToStore(call);
        toast.success('Call logged successfully');
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to log call';
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchCalls: async (filters?: CallFilters) => {
      set({ isLoading: true, error: null });
      try {
        const result = await callsService.getCalls(filters);
        set({ calls: result.calls, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch calls';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
      }
    },

    fetchCallStats: async (filters?) => {
      set({ isLoading: true, error: null });
      try {
        const stats = await callsService.getCallStats(filters);
        set({ stats, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch call stats';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
      }
    },

    addCallToStore: (call: Call) => {
      set((state) => ({
        calls: [call, ...state.calls]
      }));
    }
  };
});
