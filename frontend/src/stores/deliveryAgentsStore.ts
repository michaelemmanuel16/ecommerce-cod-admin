import { create } from 'zustand';
import {
  deliveryAgentsService,
  DeliveryAgent,
  AgentPerformance
} from '../services/delivery-agents.service';
import { connectSocket, getSocket } from '../services/socket';
import toast from 'react-hot-toast';

interface DeliveryAgentsState {
  agents: DeliveryAgent[];
  performance: AgentPerformance[];
  selectedAgent: DeliveryAgent | null;
  isLoading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  fetchPerformance: () => Promise<void>;
  fetchAgentById: (id: string) => Promise<void>;
  toggleAvailability: (id: string, isAvailable: boolean) => Promise<void>;
  updateAgent: (id: string, data: Partial<DeliveryAgent>) => Promise<void>;
  setSelectedAgent: (agent: DeliveryAgent | null) => void;
  addAgent: (agent: DeliveryAgent) => void;
  updateAgentInStore: (agent: DeliveryAgent) => void;
}

export const useDeliveryAgentsStore = create<DeliveryAgentsState>((set, get) => {
  // Initialize Socket.io listeners
  const socket = getSocket();
  if (socket) {
    socket.on('agent:updated', (data: DeliveryAgent) => {
      get().updateAgentInStore(data);
    });

    socket.on('agent:availability_changed', (data: { agentId: string; isAvailable: boolean }) => {
      const agents = get().agents.map(agent =>
        agent.id === data.agentId ? { ...agent, isAvailable: data.isAvailable } : agent
      );
      set({ agents });
    });

    socket.on('order:assigned', (data: { assignedTo: string; role: string }) => {
      if (data.role === 'delivery_agent') {
        // Refresh performance stats when new order assigned to an agent
        get().fetchPerformance();
      }
    });
  }

  return {
    agents: [],
    performance: [],
    selectedAgent: null,
    isLoading: false,
    error: null,

    fetchAgents: async () => {
      set({ isLoading: true, error: null });
      try {
        const agents = await deliveryAgentsService.getDeliveryAgents();
        set({ agents, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch delivery agents';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
        throw error;
      }
    },

    fetchPerformance: async () => {
      try {
        const performance = await deliveryAgentsService.getAgentPerformance();
        set({ performance });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch agent performance';
        console.error(errorMessage, error);
        toast.error(errorMessage);
      }
    },

    fetchAgentById: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        const agent = await deliveryAgentsService.getAgentById(id);
        set({ selectedAgent: agent, isLoading: false });
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to fetch agent details';
        set({ error: errorMessage, isLoading: false });
        toast.error(errorMessage);
        throw error;
      }
    },

    toggleAvailability: async (id: string, isAvailable: boolean) => {
      try {
        await deliveryAgentsService.toggleAvailability(id, isAvailable);
        const agents = get().agents.map(agent =>
          agent.id === id ? { ...agent, isAvailable } : agent
        );
        set({ agents });
        if (get().selectedAgent?.id === id) {
          set({ selectedAgent: { ...get().selectedAgent!, isAvailable } });
        }
        toast.success(`Agent ${isAvailable ? 'is now available' : 'is now unavailable'}`);
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to update availability';
        toast.error(errorMessage);
        throw error;
      }
    },

    updateAgent: async (id: string, data: Partial<DeliveryAgent>) => {
      try {
        const updatedAgent = await deliveryAgentsService.updateAgent(id, data);
        get().updateAgentInStore(updatedAgent);
        toast.success('Agent updated successfully');
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to update agent';
        toast.error(errorMessage);
        throw error;
      }
    },

    setSelectedAgent: (agent: DeliveryAgent | null) => {
      set({ selectedAgent: agent });
    },

    addAgent: (agent: DeliveryAgent) => {
      set((state) => ({
        agents: [agent, ...state.agents],
      }));
    },

    updateAgentInStore: (agent: DeliveryAgent) => {
      set((state) => ({
        agents: state.agents.map((a) => (a.id === agent.id ? agent : a)),
        selectedAgent: state.selectedAgent?.id === agent.id ? agent : state.selectedAgent,
      }));
    },
  };
});
