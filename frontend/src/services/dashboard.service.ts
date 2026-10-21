import { apiClient } from './api';
import type { DashboardRange, OwnerDashboardData } from '../pages/dashboard/types';

export const dashboardService = {
  /** `fresh`: skip the 5 second GET cache of api.ts. A refresh (button or socket event) must reach the server. */
  async getOwner(range: DashboardRange, fresh = false): Promise<OwnerDashboardData> {
    const { data } = await apiClient.get<OwnerDashboardData>('/api/dashboard/owner', { params: { range }, skipCache: fresh });
    return data;
  },
};
