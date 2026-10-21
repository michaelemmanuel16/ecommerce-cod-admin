import { apiClient } from './api';
import type { DashboardRange, OwnerDashboardData } from '../pages/dashboard/types';

export const dashboardService = {
  /**
   * `fresh` adds a throwaway query value: api.ts caches every GET for 5 seconds by URL and params, and a refresh
   * (button or socket event) must reach the server. The server ignores the extra value.
   */
  async getOwner(range: DashboardRange, fresh = false): Promise<OwnerDashboardData> {
    const params: Record<string, string | number> = { range };
    if (fresh) params._ = Date.now();
    const { data } = await apiClient.get<OwnerDashboardData>('/api/dashboard/owner', { params });
    return data;
  },
};
