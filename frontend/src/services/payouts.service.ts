import apiClient from './api';

/** The payout API (backend payoutRoutes.ts, M5-T19): one payout for reps and delivery agents. Money arrives as strings. */

export type CommissionKind = 'base' | 'upsell' | 'reward';
export type PayoutKind = 'rep' | 'agent';

export interface OwedEntry {
  id: number;
  orderId: number | null;
  kind: CommissionKind;
  amount: string;
  earnedAt: string | null;
}

/** GET /api/payouts/owed/:payeeId: what the form shows before a save. */
export interface OwedPreview {
  payee: { id: number; firstName: string; lastName: string; kind: PayoutKind };
  commission: string;
  upsellReward: string;
  targetReward: string;
  earned: string;
  paid: string;
  owed: string;
  entries: OwedEntry[];
}

/** One row of GET /api/payouts/owed: a rep on the Rep commissions tab. */
export interface RepOwedRow {
  id: number;
  firstName: string;
  lastName: string;
  delivered: number;
  commission: string;
  upsellReward: string;
  targetReward: string;
  earned: string;
  paid: string;
  /** Paid in the month the list was asked for. */
  paidInMonth: string;
  owed: string;
  lastPayout: string | null;
}

/** GET /api/payouts/owed: the reps and the totals the server adds up (Money, no float in the browser). */
export interface RepsOwed {
  /** YYYY-MM the paid-in-month figures are for. */
  month: string;
  reps: RepOwedRow[];
  totals: { owed: string; paid: string; paidInMonth: string; repsOwed: number };
}

export interface PayoutRow {
  id: number;
  payeeId: number;
  kind: PayoutKind;
  amount: string;
  method: string;
  reference: string | null;
  payoutDate: string;
  notes: string | null;
  payee: { id: number; firstName: string; lastName: string };
  recordedBy: { id: number; firstName: string; lastName: string } | null;
  _count: { commissionEntries: number };
}

/** POST /api/payouts. There is no delivery fee field: the server refuses unknown fields. */
export interface RecordPayout {
  payeeId: number;
  amount: string;
  method: string;
  reference?: string;
  payoutDate?: string;
  notes?: string;
  entryIds?: number[];
}

// `quiet`: the form shows a refusal ("Owed is GH₵2,034", "Already paid") itself, so the client raises no second toast.
export const payoutsService = {
  async repsOwed(params: { month?: string; includeInactive?: boolean } = {}): Promise<RepsOwed> {
    const response = await apiClient.get('/api/payouts/owed', { params, skipCache: true, quiet: true });
    return response.data;
  },

  async owed(payeeId: number): Promise<OwedPreview> {
    const response = await apiClient.get(`/api/payouts/owed/${payeeId}`, { skipCache: true, quiet: true });
    return response.data;
  },

  async history(payeeId: number): Promise<PayoutRow[]> {
    const response = await apiClient.get('/api/payouts', { params: { payeeId, limit: 10 }, skipCache: true, quiet: true });
    return response.data.payouts;
  },

  async record(body: RecordPayout): Promise<PayoutRow> {
    const response = await apiClient.post('/api/payouts', body, { quiet: true });
    return response.data.payout;
  },
};
