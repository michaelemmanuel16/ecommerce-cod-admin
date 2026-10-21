import apiClient from './api';

/** GET /api/nav/counts: numbers for the sidebar pills (M3-T07, F-101). A count the person may not see is 0. */
export interface NavCounts {
  inbox: number;
  ordersPending: number;
  financeOpen: number;
}

export const navService = {
  async getCounts(): Promise<NavCounts> {
    const response = await apiClient.get('/api/nav/counts');
    return response.data;
  },
};
