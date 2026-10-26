import apiClient from './api';

/**
 * GET /api/financial/overview (backend overviewService.ts, M5-T24). The API client turns money strings under money keys
 * into numbers, so money here is a number; "n/a" stays a string.
 */

export const NOT_AVAILABLE = 'n/a';

/** A money field: the API client turns numeric strings under money-like keys into numbers and leaves the rest as strings. */
export type Amount = number | string;

/** The ui-v2 Tag tones. The page draws `badge` as it comes. */
export interface Badge { label: string; tone: 'ok' | 'bad' | 'warn' | 'v' | 'n' }

export interface TileDetails {
  deliveredRevenue: {
    deliveredOrders: number;
    averageOrderValue: Amount;
    ofWhichDigital: Amount;
    /** The covering revenue target and the Dashboard progress key (PROGRESS_TAG); null when no target covers the range. */
    target: { value: Amount; status: 'hit' | 'on_track' | 'behind' | 'off_track' | 'no_target' } | null;
  };
  cashReceived: { payouts: number; percentOfDeliveredRevenue: number | null };
  cashOutstanding: { orders: number; overdueOrders: number };
  netMargin: { target: number; netProfit: Amount; expenses: { total: Amount; paystackFees: Amount } };
  profitPerOrder: { deliveredOrders: number; topProduct: { name: string; profitPerOrder: Amount } | null };
  cashRunway: { cash: Amount; adsPerDay: Amount; adDays: number };
}
export type TileKey = keyof TileDetails;

/** One tile, a union by key so each key has its own detail. */
export type OkTile = {
  [K in TileKey]: {
    status: 'ok';
    key: K;
    label: string;
    tooltip: string;
    dateBasis: 'range' | 'today';
    value: Amount;
    badge: Badge | null;
    detail: TileDetails[K];
  };
}[TileKey];
export interface ErrorTile { status: 'error'; key: TileKey; label: string; message: string }
export type Tile = OkTile | ErrorTile;

export type SettlementStatus = 'matched' | 'short' | 'over' | 'unmatched';

export interface UnpaidRow {
  orderId: number;
  orderNumber: string;
  customer: string | null;
  area: string | null;
  deliveredOn: string;
  ageDays: number;
  orderTotal: Amount | null;
  fee: Amount | null;
  amount: Amount;
}

export interface ReconRow {
  id: number;
  date: string;
  partnerName: string;
  partnerKind: 'person' | 'company' | 'ai_agent' | 'system';
  paidIn: Amount;
  expectedAfterFees: Amount;
  orders: number;
  status: SettlementStatus;
  shortAmount: Amount;
  overAmount: Amount;
  unpaid: { orders: number; amount: Amount; rows: UnpaidRow[] } | null;
}

export interface Failed { status: 'error'; message: string }
export interface Reconciliation { rows: ReconRow[] }

export interface FinanceOverview {
  from: string;
  to: string;
  currency: string;
  tiles: Tile[];
  reconciliation: Reconciliation | Failed;
}

export interface RangeParams { from: string; to: string }

export const financeOverviewService = {
  async get(range: RangeParams, skipCache = false): Promise<FinanceOverview> {
    const response = await apiClient.get('/api/financial/overview', { params: range, skipCache, quiet: true });
    return response.data;
  },
};
