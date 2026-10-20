import { apiClient } from './api';

export type FxSource = 'auto' | 'manual';

export interface FxCurrentRate {
  from: string;
  to: string;
  /** Units of `to` for 1 unit of `from`. Null when the pair has no rate yet. */
  rate: number | null;
  /** YYYY-MM-DD of the stored row that answered. */
  date: string;
  source: FxSource;
  exact: boolean;
}

export interface FxRatesResponse {
  storeCurrency: string;
  today: string;
  rates: FxCurrentRate[];
  provider: { name: string; url: string };
}

export interface FxHistoryRow {
  id: number;
  from: string;
  to: string;
  /** Decimal string, as the API sends it. */
  rate: string;
  date: string;
  source: FxSource;
  createdAt: string;
}

export const fxService = {
  async getRates(): Promise<FxRatesResponse> {
    const response = await apiClient.get('/api/fx/rates');
    // The API sends rates as decimal strings.
    return { ...response.data, rates: response.data.rates.map((r: any) => ({ ...r, rate: r.rate === null ? null : Number(r.rate) })) };
  },

  async getHistory(to?: string): Promise<FxHistoryRow[]> {
    const response = await apiClient.get('/api/fx/history', { params: to ? { to } : {} });
    return response.data.history;
  },

  async saveManualRate(to: string, rate: number): Promise<void> {
    await apiClient.post('/api/fx/rates', { to, rate });
  },

  async useToday(to: string): Promise<void> {
    await apiClient.post('/api/fx/use-today', { to });
  },
};
