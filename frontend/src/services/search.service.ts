import apiClient from './api';

/** GET /api/search?q= (M3-T08, F-105): up to 5 orders and 5 customers, tenant-scoped and permission-filtered. */
export interface SearchOrder {
  id: number;
  status: string;
  totalAmount: string | number;
  createdAt: string;
  customer: { id: number; firstName: string; lastName: string; phoneNumber: string } | null;
}

export interface SearchCustomer {
  id: number;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  area: string | null;
  state: string | null;
  totalOrders: number;
}

export interface SearchResults {
  orders: SearchOrder[];
  customers: SearchCustomer[];
}

export const searchService = {
  async search(q: string): Promise<SearchResults> {
    const response = await apiClient.get('/api/search', { params: { q } });
    return { orders: response.data?.orders ?? [], customers: response.data?.customers ?? [] };
  },
};
