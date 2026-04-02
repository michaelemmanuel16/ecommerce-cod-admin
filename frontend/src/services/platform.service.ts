import { apiClient } from './api';

export interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  mrr: number;
  activeUsers: number;
  ordersThisMonth: number;
}

export interface TrendData {
  date: string;
  newTenants: number;
  revenue: number;
  orders: number;
}

export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: string;
  createdAt: string;
  rateLimitEnabled: boolean;
  rateLimitConfig: { requestsPer15Min: number; burstPerSec: number } | null;
  currentPlan: { id: string; name: string; displayName: string } | null;
  _count: { users: number; orders: number };
}

export interface TenantDetail extends TenantListItem {
  region: string | null;
  currency: string;
  usage: {
    ordersThisMonth: number;
    revenueThisMonth: number;
    totalUsers: number;
  };
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface PlanItem {
  id: string;
  name: string;
  displayName: string;
  priceGHS: string;
}

export const platformService = {
  // Metrics
  async getMetrics(): Promise<PlatformMetrics> {
    const res = await apiClient.get('/api/platform/metrics');
    return res.data;
  },

  async getTrends(period = '30d'): Promise<{ data: TrendData[] }> {
    const res = await apiClient.get('/api/platform/metrics/trends', { params: { period } });
    return res.data;
  },

  // Tenants
  async listTenants(params?: { search?: string; plan?: string; status?: string; page?: number; limit?: number }): Promise<{
    tenants: TenantListItem[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const res = await apiClient.get('/api/platform/tenants', { params });
    return res.data;
  },

  async getTenant(id: string): Promise<TenantDetail> {
    const res = await apiClient.get(`/api/platform/tenants/${id}`);
    return res.data;
  },

  async createTenant(data: { name: string; slug: string; planName?: string; region?: string; currency?: string }): Promise<TenantListItem> {
    const res = await apiClient.post('/api/platform/tenants', data);
    return res.data;
  },

  async updateTenant(id: string, data: Record<string, any>): Promise<TenantDetail> {
    const res = await apiClient.put(`/api/platform/tenants/${id}`, data);
    return res.data;
  },

  async suspendTenant(id: string): Promise<void> {
    await apiClient.post(`/api/platform/tenants/${id}/suspend`);
  },

  async reactivateTenant(id: string): Promise<void> {
    await apiClient.post(`/api/platform/tenants/${id}/reactivate`);
  },

  async deleteTenant(id: string, confirmSlug: string): Promise<void> {
    await apiClient.delete(`/api/platform/tenants/${id}`, { data: { confirmSlug } });
  },

  // Announcements
  async listAnnouncements(): Promise<{ announcements: Announcement[] }> {
    const res = await apiClient.get('/api/platform/announcements');
    return res.data;
  },

  async getActiveAnnouncements(): Promise<{ announcements: Announcement[] }> {
    const res = await apiClient.get('/api/platform/announcements/active');
    return res.data;
  },

  async createAnnouncement(data: { title: string; body: string; type?: string; expiresAt?: string }): Promise<Announcement> {
    const res = await apiClient.post('/api/platform/announcements', data);
    return res.data;
  },

  async deleteAnnouncement(id: string): Promise<void> {
    await apiClient.delete(`/api/platform/announcements/${id}`);
  },

  // Plans
  async listPlans(): Promise<{ plans: PlanItem[] }> {
    const res = await apiClient.get('/api/platform/plans');
    return res.data;
  },

  // Health
  async getHealth(): Promise<any> {
    const res = await apiClient.get('/api/platform/health');
    return res.data;
  },
};
