import apiClient from './api';

/** One connected ad account. The API never sends a token, only its type and expiry. */
export interface MetaAdAccount {
  id: number;
  accountId: string;
  name: string;
  currency: string;
  timezone: string;
  enabled: boolean;
  status: 'connected' | 'disconnected';
  statusReason: string | null;
  tokenType: 'system_user' | 'user';
  tokenExpiresAt: string | null;
  lastPulledAt: string | null;
  lastPullError: string | null;
}

/** One ad account Meta offers after the login (before it is saved). */
export interface MetaPickAccount {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  alreadyConnected: boolean;
}

export interface MetaRefreshResult {
  lastPulledAt: string | null;
  days: string[];
  lastPullError: string | null;
}

export const metaAdsService = {
  async initiate(): Promise<{ authUrl: string }> {
    const response = await apiClient.post('/api/meta-ads/oauth/initiate');
    return response.data;
  },

  async getPickAccounts(pickId: string): Promise<MetaPickAccount[]> {
    const response = await apiClient.get(`/api/meta-ads/oauth/pick/${encodeURIComponent(pickId)}`);
    return response.data.accounts;
  },

  async savePick(pickId: string, accountIds: string[]): Promise<void> {
    await apiClient.post(`/api/meta-ads/oauth/pick/${encodeURIComponent(pickId)}`, { accountIds });
  },

  async getAccounts(): Promise<MetaAdAccount[]> {
    const response = await apiClient.get('/api/meta-ads/accounts');
    return response.data.accounts;
  },

  async setEnabled(id: number, enabled: boolean): Promise<void> {
    await apiClient.patch(`/api/meta-ads/accounts/${id}`, { enabled });
  },

  async remove(id: number): Promise<void> {
    await apiClient.delete(`/api/meta-ads/accounts/${id}`);
  },

  async refresh(id: number): Promise<MetaRefreshResult> {
    const response = await apiClient.post(`/api/meta-ads/accounts/${id}/refresh`, undefined, { quiet: true }); // the card shows the error inline
    return response.data;
  },
};
