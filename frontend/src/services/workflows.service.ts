import apiClient from './api';

export interface Workflow {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  triggerData: any;
  actions: any;
  conditions: any;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: string;
  input: any;
  output?: any;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export const workflowsService = {
  async getWorkflows(params?: {
    isActive?: boolean;
    triggerType?: string;
  }): Promise<Workflow[]> {
    const response = await apiClient.get('/api/workflows', { params });
    return response.data.workflows || [];
  },

  async getWorkflow(id: string): Promise<Workflow> {
    const response = await apiClient.get(`/api/workflows/${id}`);
    return response.data.workflow;
  },

  async createWorkflow(workflow: Partial<Workflow>): Promise<Workflow> {
    const response = await apiClient.post('/api/workflows', workflow);
    return response.data.workflow;
  },

  async updateWorkflow(id: string, workflow: Partial<Workflow>): Promise<Workflow> {
    const response = await apiClient.put(`/api/workflows/${id}`, workflow);
    return response.data.workflow;
  },

  async deleteWorkflow(id: string): Promise<void> {
    await apiClient.delete(`/api/workflows/${id}`);
  },

  async executeWorkflow(id: string, input?: any): Promise<WorkflowExecution> {
    const response = await apiClient.post(`/api/workflows/${id}/execute`, { input });
    return response.data.execution;
  },

  async getWorkflowExecutions(id: string, params?: {
    page?: number;
    limit?: number;
  }): Promise<{ executions: WorkflowExecution[]; pagination: any }> {
    const response = await apiClient.get(`/api/workflows/${id}/executions`, { params });
    return response.data;
  }
};
