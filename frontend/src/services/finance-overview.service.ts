import apiClient from './api';

/**
 * GET /api/financial/overview (backend overviewService.ts, M5-T24). The API client turns money strings under money keys
 * into numbers, so money here is a number; "n/a" stays a string.
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
export const NOT_AVAILABLE = 'n/a';

export interface OkTile {
  status: 'ok';
  key: TileKey;
  label: string;
  tooltip: string;
  dateBasis: 'range' | 'today';
  value: number | typeof NOT_AVAILABLE;
  unit: 'money' | 'percent' | 'days';
  available: boolean;
  tone: Tone;
  detail: Record<string, any>;
}
export interface ErrorTile { status: 'error'; key: TileKey; label: string; message: string }
export type Tile = OkTile | ErrorTile;
export type TileKey = 'deliveredRevenue' | 'cashReceived' | 'cashOutstanding' | 'netMargin' | 'profitPerOrder' | 'cashRunway';

export type SettlementStatus = 'matched' | 'short' | 'over' | 'unmatched';

export interface UnpaidRow {
  orderId: number;
  orderNumber: string;
  customer: string | null;
  area: string | null;
  deliveredOn: string;
  ageDays: number;
  orderTotal: number | null;
  fee: number | null;
  amount: number;
}

export interface ReconRow {
  id: number;
  date: string;
  reference: string;
  partnerId: number;
  partnerName: string;
  partnerKind: 'person' | 'company' | 'ai_agent' | 'system';
  paidIn: number;
  expectedAfterFees: number;
  orders: number;
  status: SettlementStatus;
  shortAmount: number;
  overAmount: number;
  unappliedAmount: number;
  unpaid: { orders: number; amount: number; rows: UnpaidRow[] } | null;
}

export interface Failed { status: 'error'; message: string }

export interface Reconciliation {
  basis: 'expected_cash_after_fees';
  from: string;
  to: string;
  counts: Record<SettlementStatus, number>;
  rows: ReconRow[];
}

export interface FinanceOverview {
  from: string;
  to: string;
  asOf: string;
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
