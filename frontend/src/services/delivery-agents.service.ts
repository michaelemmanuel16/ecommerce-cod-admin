import apiClient from './api';

export interface DeliveryAgent {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  phoneNumber: string;
  role: string;
  isActive: boolean;
  isAvailable: boolean;
  lastLogin?: string;
  vehicleType?: string;
  vehicleId?: string;
  deliveryRate?: number;
  totalEarnings?: number;
  location?: string;
  createdAt: string;
}

export interface AgentPerformance {
  userId: string;
  userName: string;
  isAvailable: boolean;
  totalAssigned: number;
  completed: number;
  pending: number;
  successRate: number;
  vehicleType?: string;
  vehicleId?: string;
  deliveryRate?: number;
  totalEarnings?: number;
  location?: string;
}

export const deliveryAgentsService = {
  async getDeliveryAgents(): Promise<DeliveryAgent[]> {
    const response = await apiClient.get('/api/admin/users', {
      params: { role: 'delivery_agent' }
    });
    const users = response.data.users || [];
    return users.map((u: any) => ({
      ...u,
      name: `${u.firstName} ${u.lastName}`
    }));
  },

  async getAgentPerformance(filters?: { startDate?: string; endDate?: string }): Promise<AgentPerformance[]> {
    const response = await apiClient.get('/api/users/agents/performance', {
      params: filters
    });
    return response.data.performance || [];
  },

  async getAgentById(id: string): Promise<DeliveryAgent> {
    const response = await apiClient.get(`/api/users/${id}`);
    const user = response.data.user;
    return {
      ...user,
      name: `${user.firstName} ${user.lastName}`
    };
  },

  async toggleAvailability(id: string, isAvailable: boolean): Promise<void> {
    await apiClient.patch(`/api/users/${id}/availability`, { isAvailable });
  },

  async updateAgent(id: string, data: Partial<DeliveryAgent>): Promise<DeliveryAgent> {
    const response = await apiClient.put(`/api/users/${id}`, data);
    const user = response.data.user;
    return {
      ...user,
      name: `${user.firstName} ${user.lastName}`
    };
  }
};
