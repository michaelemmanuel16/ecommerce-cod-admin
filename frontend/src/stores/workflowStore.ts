import { create } from 'zustand';
import { WorkflowNode, WorkflowEdge, Workflow } from '../types';
import apiClient from '../services/api';

interface WorkflowState {
  workflows: Workflow[];
  currentWorkflow: Workflow | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isLoading: boolean;
  fetchWorkflows: () => Promise<void>;
  setCurrentWorkflow: (workflow: Workflow | null) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, data: Partial<WorkflowNode>) => void;
  deleteNode: (id: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  deleteEdge: (id: string) => void;
  saveWorkflow: () => Promise<void>;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  nodes: [],
  edges: [],
  isLoading: false,

  fetchWorkflows: async () => {
    set({ isLoading: true });
    try {
      const response = await apiClient.get('/api/workflows');
      set({ workflows: response.data, isLoading: false });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  setCurrentWorkflow: (workflow: Workflow | null) => {
    set({
      currentWorkflow: workflow,
      nodes: workflow?.nodes || [],
      edges: workflow?.edges || [],
    });
  },

  setNodes: (nodes: WorkflowNode[]) => {
    set({ nodes });
  },

  setEdges: (edges: WorkflowEdge[]) => {
    set({ edges });
  },

  addNode: (node: WorkflowNode) => {
    set((state) => ({ nodes: [...state.nodes, node] }));
  },

  updateNode: (id: string, data: Partial<WorkflowNode>) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, ...data } : node
      ),
    }));
  },

  deleteNode: (id: string) => {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
      edges: state.edges.filter(
        (edge) => edge.source !== id && edge.target !== id
      ),
    }));
  },

  addEdge: (edge: WorkflowEdge) => {
    set((state) => ({ edges: [...state.edges, edge] }));
  },

  deleteEdge: (id: string) => {
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== id),
    }));
  },

  saveWorkflow: async () => {
    const { currentWorkflow, nodes, edges } = get();
    if (!currentWorkflow) return;

    try {
      const response = await apiClient.put(`/api/workflows/${currentWorkflow.id}`, {
        nodes,
        edges,
      });
      set({ currentWorkflow: response.data });
    } catch (error) {
      throw error;
    }
  },
}));
