import apiClient from './api';

export interface CustomerRep {
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
  createdAt: string;
  country?: string;
  commissionAmount?: number;
}

export interface RepWorkload {
  userId: string;
  userName: string;
  isAvailable: boolean;
  activeOrders: number;
  byStatus: Record<string, number>;
}

export interface RepPerformance {
  repId: string;
  repName: string;
  totalOrders: number;
  deliveredOrders: number;
  successRate: number;
  totalEarnings: number;
  monthlyEarnings: number;
  country: string | null;
}

export interface UpdateRepData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  country?: string;
  commissionAmount?: number;
  isActive?: boolean;
}

export interface RepPayout {
  id: number;
  repId: number;
  amount: number;
  method: string;
  status: string;
  payoutDate: string;
  notes?: string;
  createdAt: string;
  _count?: {
    orders: number;
  };
}

export interface PendingPayment {
  orderId: number;
  totalAmount: number;
  commissionAmount: number;
  customerName: string;
  deliveredAt: string;
}

export const customerRepsService = {
  async getCustomerReps(): Promise<CustomerRep[]> {
    const response = await apiClient.get('/api/admin/users', {
      params: { role: 'sales_rep' }
    });
    const users = response.data.users || [];
    return users.map((u: any) => ({
      ...u,
      name: `${u.firstName} ${u.lastName}`
    }));
  },

  async getRepWorkload(): Promise<RepWorkload[]> {
    const response = await apiClient.get('/api/users/reps/workload');
    return response.data.workload || [];
  },

  async getRepById(id: string): Promise<CustomerRep> {
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

  async updateRep(id: string, data: Partial<CustomerRep>): Promise<CustomerRep> {
    const response = await apiClient.put(`/api/users/${id}`, data);
    const user = response.data.user;
    return {
      ...user,
      name: `${user.firstName} ${user.lastName}`
    };
  },

  async updateRepDetails(id: string, data: UpdateRepData): Promise<CustomerRep> {
    const response = await apiClient.put(`/api/users/reps/${id}`, data);
    // Backend returns { message, rep } not { user }
    const user = response.data.rep || response.data.user;
    return {
      ...user,
      name: `${user.firstName} ${user.lastName}`
    };
  },

  async getRepPerformance(filters?: { startDate?: string; endDate?: string }): Promise<RepPerformance[]> {
    const response = await apiClient.get('/api/users/reps/performance', {
      params: filters
    });
    const backendPerformance = response.data.performance || [];

    // Transform backend structure (nested metrics) to match frontend interface (flat fields)
    return backendPerformance.map((p: any) => ({
      repId: p.repId,
      repName: p.repName,
      totalOrders: p.metrics?.totalAssigned || 0,
      deliveredOrders: p.metrics?.deliveredCount || 0,
      successRate: p.metrics?.successRate || 0,
      totalEarnings: p.metrics?.totalEarnings || 0,
      monthlyEarnings: p.metrics?.monthlyEarnings || 0,
      country: p.country || null
    }));
  },

  async getPendingPayments(id: string): Promise<PendingPayment[]> {
    const response = await apiClient.get(`/api/users/reps/${id}/pending-payments`);
    return response.data || [];
  },

  async getPayoutHistory(id: string): Promise<RepPayout[]> {
    const response = await apiClient.get(`/api/users/reps/${id}/payout-history`);
    return response.data || [];
  },

  async processPayout(id: string, data: { amount: number; method: string; orderIds: number[]; notes?: string }): Promise<RepPayout> {
    const response = await apiClient.post(`/api/users/reps/${id}/process-payout`, data);
    return response.data.payout;
  }
};
