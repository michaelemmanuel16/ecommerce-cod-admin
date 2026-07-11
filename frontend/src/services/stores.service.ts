import apiClient from './api';

export interface Store {
  tenantId: string;
  name: string;
  slug: string;
  subscriptionStatus: string;
  role: string;
  isDefault: boolean;
  isActive: boolean;
}

export const storesService = {
  getStores: () => apiClient.get<{ stores: Store[] }>('/api/stores').then((r) => r.data.stores),

  switchStore: (tenantId: string) =>
    apiClient
      .post<{ accessToken: string; refreshToken: string; activeTenantId: string }>('/api/stores/switch', { tenantId })
      .then((r) => r.data),

  /** Self-serve: provision an additional store on a Growth/Scale plan; returns the Paystack redirect URL. */
  createStore: (name: string, planName: string) =>
    apiClient
      .post<{ tenantId: string; billingEmail: string; authorizationUrl: string; reference: string }>('/api/stores', {
        name,
        planName,
      })
      .then((r) => r.data),
};
