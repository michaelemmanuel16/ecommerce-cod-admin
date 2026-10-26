import apiClient from './api';
import { parseMoney } from '../utils/money';

/**
 * The Agent collections API (COD-50: financialRoutes, agentReconciliationRoutes). Money is turned into numbers at the
 * network edge; `parseMoney` here only keeps a stray string from reaching a sum. Every call is `quiet`: the screen shows
 * a refusal in its own words, so the client raises no second toast.
 */

export type BucketKey = '0-3' | '4-7' | '8-14' | '15+';

export interface AgingBucket {
  key: BucketKey;
  label: string;
  orders: number;
  amount: number;
}

/** GET /api/financial/unpaid-by-age: the card. Amounts are net of the delivery fee. `overdue` is past each partner's days to pay. */
export interface UnpaidByAge {
  basis: 'net_of_delivery_fee';
  total: { orders: number; amount: number };
  overdue: { orders: number; amount: number };
  buckets: AgingBucket[];
}

export interface AgingPartner {
  agentId: number;
  name: string;
  email: string | null;
  cashHeld: number;
  negativeCashHeld: boolean;
  /** The open negative-cash Finding of this partner, if any. */
  findingId: number | null;
  daysToPay: number;
  unpaidOrders: number;
  unpaidAmount: number;
  buckets: AgingBucket[];
  overdueOrders: number;
  overdueAmount: number;
  oldestUnpaidDays: number | null;
  oldestDeliveredOn: string | null;
  isBlocked: boolean;
}

export interface AgingReport {
  summary: {
    totalOutstandingAmount: number;
    totalOrders: number;
    overdueAmount: number;
    overdueOrders: number;
    overduePartners: number;
    partnersWithCash: number;
    negativeCashPartners: number;
    blockedPartners: number;
    bucketTotals: AgingBucket[];
  };
  partners: AgingPartner[];
}

/** One collection of a partner (GET /api/agent-reconciliation?agentId&status). */
export interface PartnerCollection {
  id: number;
  orderId: number;
  amount: number;
  allocatedAmount: number;
  status: 'draft' | 'verified' | 'approved' | 'deposited' | 'reconciled';
  collectionDate: string;
}

/** One pay-in of a partner (GET /api/agent-reconciliation/deposits?agentId). */
export interface PartnerDeposit {
  id: number;
  amount: number;
  status: 'pending' | 'verified' | 'rejected';
  depositDate: string;
  depositMethod: string;
  referenceNumber: string;
  receiptUrl: string | null;
  rejectReason: string | null;
}

export interface ReminderResult {
  /** false: the WhatsApp connection is off, so the text was only saved in the message log. */
  sent: boolean;
  unpaidOrders: number;
  overdueOrders: number;
}

const bucket = (b: AgingBucket): AgingBucket => ({ ...b, amount: parseMoney(b.amount) });
const QUIET = { quiet: true, skipCache: true } as const;

export const collectionsService = {
  async unpaidByAge(): Promise<UnpaidByAge> {
    const { data } = await apiClient.get<UnpaidByAge>('/api/financial/unpaid-by-age', QUIET);
    return {
      basis: data.basis,
      total: { orders: data.total.orders, amount: parseMoney(data.total.amount) },
      overdue: { orders: data.overdue.orders, amount: parseMoney(data.overdue.amount) },
      buckets: data.buckets.map(bucket),
    };
  },

  async aging(): Promise<AgingReport> {
    const { data } = await apiClient.get<AgingReport>('/api/financial/agent-aging', QUIET);
    return {
      summary: {
        ...data.summary,
        totalOutstandingAmount: parseMoney(data.summary.totalOutstandingAmount),
        overdueAmount: parseMoney(data.summary.overdueAmount),
        bucketTotals: data.summary.bucketTotals.map(bucket),
      },
      partners: data.partners.map((p) => ({
        ...p,
        cashHeld: parseMoney(p.cashHeld),
        unpaidAmount: parseMoney(p.unpaidAmount),
        overdueAmount: parseMoney(p.overdueAmount),
        buckets: p.buckets.map(bucket),
      })),
    };
  },

  /** Collections still to verify: only `draft` can be reconciled. */
  async toVerify(agentId: number): Promise<PartnerCollection[]> {
    const { data } = await apiClient.get<PartnerCollection[]>('/api/agent-reconciliation', { params: { agentId, status: 'draft' }, ...QUIET });
    return data.map((c) => ({ ...c, amount: parseMoney(c.amount), allocatedAmount: parseMoney(c.allocatedAmount) }));
  },

  async deposits(agentId: number): Promise<PartnerDeposit[]> {
    const { data } = await apiClient.get<PartnerDeposit[]>('/api/agent-reconciliation/deposits', { params: { agentId }, ...QUIET });
    return data.map((d) => ({ ...d, amount: parseMoney(d.amount) }));
  },

  /** Verify and reconcile in one step: there is no approve step (F-912). */
  async verify(collectionId: number): Promise<void> {
    await apiClient.post(`/api/agent-reconciliation/${collectionId}/verify`, {}, { quiet: true });
  },

  /** At most 50 ids; the server refuses more. */
  async verifyMany(ids: number[]): Promise<void> {
    await apiClient.post('/api/agent-reconciliation/bulk-verify', { ids }, { quiet: true, timeout: 90000 });
  },

  async verifyDeposit(depositId: number): Promise<void> {
    await apiClient.post(`/api/agent-reconciliation/deposits/${depositId}/verify`, {}, { quiet: true, timeout: 90000 });
  },

  /** The reason is required: the server refuses fewer than 5 characters. */
  async rejectDeposit(depositId: number, reason: string): Promise<void> {
    await apiClient.post(`/api/agent-reconciliation/deposits/${depositId}/reject`, { reason }, { quiet: true });
  },

  /** A blocked partner gets no new orders; the deliveries it already has stay with it. */
  async block(agentId: number, reason: string): Promise<void> {
    await apiClient.post(`/api/agent-reconciliation/agents/${agentId}/block`, { reason }, { quiet: true });
  },

  async unblock(agentId: number): Promise<void> {
    await apiClient.post(`/api/agent-reconciliation/agents/${agentId}/unblock`, {}, { quiet: true });
  },

  async remind(agentId: number): Promise<ReminderResult> {
    const { data } = await apiClient.post<ReminderResult>(`/api/financial/agent-aging/${agentId}/remind`, {}, { quiet: true });
    return data;
  },

  /** Opens or closes the "negative cash held" Findings now (owner and admin). */
  async syncCashFindings(): Promise<void> {
    await apiClient.post('/api/financial/sync-cash-findings', {}, { quiet: true });
  },
};
