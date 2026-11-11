import { apiClient } from './api';
import type { DayRange } from '../pages/reports/range';

/**
 * The Marketing APIs of M8 (backend marketingRoutes.ts). Money is a string or a number once the client has normalized
 * it (utils/money); every figure goes through formatCurrency or parseMoney. Every GET skips the 5 second request cache,
 * because a saved mapping must show at once.
 */
export type Amount = string | number;

export interface MoneyView {
  store: Amount;
  account: Amount | null;
  accountCurrency: string | null;
  rate: Amount | null;
  rateDate: string | null;
}

export interface MaxCpa {
  available: boolean;
  yieldPct: number | null;
  profitBeforeAds: MoneyView | null;
  maxCpa: MoneyView | null;
  message: string | null;
  closedOrders: number;
}

export interface TileSet {
  from: string;
  to: string;
  spend: MoneyView;
  spendDaysWaitingForRate: number;
  ordersPlaced: number;
  confirmed: number;
  delivered: number;
  projectedCostPerDelivered: { value: MoneyView | null; message: string | null };
  actualCostPerDelivered: { label: string; value: MoneyView | null };
  maxCpa: MaxCpa;
}
export type Summary = TileSet & { previous: TileSet };

/** One day of GET /daily. `spend.store` is null when the day has spend and no FX rate yet. */
export interface DailyRow {
  date: string;
  spend: Omit<MoneyView, 'store'> & { store: Amount | null };
  waitingForRate: boolean;
  ordersPlaced: number;
  costPerOrder: MoneyView | null;
}
export interface Daily {
  from: string;
  to: string;
  days: DailyRow[];
  best: { date: string; costPerOrder: MoneyView } | null;
  worst: { date: string; costPerOrder: MoneyView } | null;
  average: { spend: MoneyView; ordersPerDay: number };
}

export interface Funnel {
  from: string;
  to: string;
  productId: number | null;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  checkoutsStarted: number;
  ordersPlaced: number;
  confirmed: number;
  delivered: number;
}

export type CampaignStatus = 'Paused' | 'Not mapped' | 'Winning' | 'On track' | 'Over max CPA';

export interface CampaignRow {
  adAccountId: number;
  campaignId: string;
  campaignName: string;
  product: { id: number; name: string; archived: boolean; via: 'campaign' | 'prefix' } | null;
  spend: MoneyView;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  checkoutsStarted: number;
  purchases: number;
  cpa: MoneyView | null;
  projectedDelivered: number | null;
  projectedDeliveredLabel: string;
  maxCpa: MaxCpa | null;
  status: CampaignStatus | null;
  lowData: boolean;
}

export interface CampaignTotals {
  spend: MoneyView;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  checkoutsStarted: number;
  purchases: number;
  cpa: MoneyView | null;
  projectedDelivered: number;
}

export interface ProductRow {
  product: { id: number; name: string; archived: boolean };
  spend: MoneyView;
  purchases: number;
  ordersPlaced: number;
  confirmed: number;
  delivered: number;
  yieldPct: number | null;
  maxCpa: MaxCpa;
  costPerPlaced: MoneyView | null;
  lowData: boolean;
}

/** A campaign with no product (GET /campaigns/unmapped). `spend` is in the ad account currency. */
export interface UnmappedCampaign {
  adAccountId: number;
  campaignId: string;
  campaignName: string;
  currency: string;
  spend: Amount;
}
export interface Unmapped {
  campaigns: UnmappedCampaign[];
  spendByCurrency: Record<string, Amount>;
}

const get = async <T>(path: string, params: object): Promise<T> =>
  (await apiClient.get<T>(`/api/marketing/${path}`, { params, skipCache: true, quiet: true })).data;

export const marketingService = {
  summary: (r: DayRange) => get<Summary>('summary', r),
  daily: (r: DayRange) => get<Daily>('daily', r),
  funnel: (r: DayRange, productId: number | null) => get<Funnel>('funnel', { ...r, ...(productId !== null && { productId }) }),
  products: async (r: DayRange) => (await get<{ products: ProductRow[] }>('products', r)).products,
  campaigns: (r: DayRange) => get<{ campaigns: CampaignRow[]; totals: CampaignTotals }>('campaigns/performance', r),
  unmapped: (r: DayRange) => get<Unmapped>('campaigns/unmapped', r),

  /** A one-off pick for one campaign. `productId` null removes the pick. */
  async setPick(body: { adAccountId: number; campaignId: string; productId: number | null }): Promise<void> {
    await apiClient.put('/api/marketing/mappings/campaigns', body);
  },
  /** A name rule: every campaign whose name starts with `prefix`. */
  async addRule(body: { prefix: string; productId: number }): Promise<void> {
    await apiClient.post('/api/marketing/mappings/rules', body);
  },
};
