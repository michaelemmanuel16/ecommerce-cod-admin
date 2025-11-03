import { create } from 'zustand';
import {
  customerRepsService,
  CustomerRep,
  RepWorkload,
  RepPerformance,
  UpdateRepData
} from '../services/customer-reps.service';
import { connectSocket, getSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface CustomerRepsState {
  reps: CustomerRep[];
  workload: RepWorkload[];
  performance: RepPerformance[];
  selectedRep: CustomerRep | null;
  isLoading: boolean;
  error: string | null;
  fetchReps: () => Promise<void>;
  fetchWorkload: () => Promise<void>;
  fetchPerformance: () => Promise<void>;
  fetchRepById: (id: string) => Promise<void>;
  toggleAvailability: (id: string, isAvailable: boolean) => Promise<void>;
  updateRep: (id: string, data: Partial<CustomerRep>) => Promise<void>;
  updateRepDetails: (id: string, data: UpdateRepData) => Promise<void>;
  setSelectedRep: (rep: CustomerRep | null) => void;
  addRep: (rep: CustomerRep) => void;
  updateRepInStore: (rep: CustomerRep) => void;
}

export const useCustomerRepsStore = create<CustomerRepsState>((set, get) => {
  // Initialize Socket.io listeners
  const socket = getSocket();
  if (socket) {
    socket.on('rep:updated', (data: CustomerRep) => {
      get().updateRepInStore(data);
    });

    socket.on('rep:availability_changed', (data: { repId: string; isAvailable: boolean }) => {
      const reps = get().reps.map(rep =>
        rep.id === data.repId ? { ...rep, isAvailable: data.isAvailable } : rep
      );
      set({ reps });
    });

    socket.on('rep:workload_changed', (data: RepWorkload) => {
      const workload = get().workload.map(w =>
        w.userId === data.userId ? data : w
      );
      set({ workload });
    });

    socket.on('order:assigned', (data: { assignedTo: string; role: string }) => {
      if (data.role === 'sales_rep') {
        // Refresh workload when new order assigned to a rep
        get().fetchWorkload();
      }
    });
  }

  return {
    reps: [],
    workload: [],
    performance: [],
    selectedRep: null,
    isLoading: false,
    error: null,

    fetchReps: async () => {
      set({ isLoading: true, error: null });
      try {
        const reps = await customerRepsService.getCustomerReps();
        set({ reps, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch customer reps';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchWorkload: async () => {
      try {
        const workload = await customerRepsService.getRepWorkload();
        set({ workload });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch rep workload';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchPerformance: async () => {
      try {
        const performance = await customerRepsService.getRepPerformance();
        set({ performance });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch rep performance';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchRepById: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        const rep = await customerRepsService.getRepById(id);
        set({ selectedRep: rep, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch rep details';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
        throw error;
      }
    },

    toggleAvailability: async (id: string, isAvailable: boolean) => {
      try {
        await customerRepsService.toggleAvailability(id, isAvailable);
        const reps = get().reps.map(rep =>
          rep.id === id ? { ...rep, isAvailable } : rep
        );
        set({ reps });
        if (get().selectedRep?.id === id) {
          set({ selectedRep: { ...get().selectedRep!, isAvailable } });
        }
        toast.success(`Rep ${isAvailable ? 'is now available' : 'is now unavailable'}`);
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to update availability';
        toast.error(errorMessage);
        throw error;
      }
    },

    updateRep: async (id: string, data: Partial<CustomerRep>) => {
      try {
        const updatedRep = await customerRepsService.updateRep(id, data);
        get().updateRepInStore(updatedRep);
        toast.success('Rep updated successfully');
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to update rep';
        toast.error(errorMessage);
        throw error;
      }
    },

    updateRepDetails: async (id: string, data: UpdateRepData) => {
      try {
        const updatedRep = await customerRepsService.updateRepDetails(id, data);
        get().updateRepInStore(updatedRep);
        toast.success('Representative updated successfully');
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to update representative';
        toast.error(errorMessage);
        throw error;
      }
    },

    setSelectedRep: (rep: CustomerRep | null) => {
      set({ selectedRep: rep });
    },

    addRep: (rep: CustomerRep) => {
      set((state) => ({
        reps: [rep, ...state.reps],
      }));
    },

    updateRepInStore: (rep: CustomerRep) => {
      set((state) => ({
        reps: state.reps.map((r) => (r.id === rep.id ? rep : r)),
        selectedRep: state.selectedRep?.id === rep.id ? rep : state.selectedRep,
      }));
    },
  };
});
