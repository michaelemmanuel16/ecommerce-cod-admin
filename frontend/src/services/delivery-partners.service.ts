import axios from 'axios';
import apiClient from './api';
import type { FailureReason, OrderStatus } from '../types';

/** The Deliveries page API (backend deliveryPartnerRoutes.ts, M4-T18 to T20). Money arrives as strings, rates as numbers. */

export type PartnerType = 'agent' | '3pl';
export type PartnerTab = 'all' | 'agent' | '3pl';
export type PartnerDataSource = 'app' | 'connector' | 'csv';
export type PartnerKind = 'person' | 'company';

/** A KPI result as the backend sends it. `value` is null when no order has closed yet. */
export interface RateResult {
  value: number | null;
  detail?: { delivered: number; failed: number; returned: number; closed: number };
}

/** What we pay per outcome. A role without financial:view gets no `feeRule` at all. */
export interface FeeRule {
  delivered: string | null;
  failed: string | null;
  returned: string | null;
}

export type FeeOutcome = 'delivered' | 'failed' | 'returned';
export type FeeBasis = 'flat' | 'percent';

/** One delivery fee rule as GET /api/delivery-partners/:id/fee-rules returns it (F-703). `amount` is a money string, or a percent for basis `percent`. */
export interface FeeRuleRow {
  id: number;
  outcome: FeeOutcome;
  basis: FeeBasis;
  amount: string;
  validFrom: string;
  createdAt: string;
}

export interface FeeRulesResponse {
  /** Every rule of the partner, newest first within an outcome. */
  rules: FeeRuleRow[];
  /** The rule in force today per outcome; null when there is none. */
  current: Record<FeeOutcome, FeeRuleRow | null>;
  /** Average delivery fee stamped on the partner's delivered orders (decision R5); null with no delivered order. */
  weightedFee: string | null;
  deliveredOrders: number;
}

export interface NewFeeRule {
  outcome: FeeOutcome;
  basis: FeeBasis;
  amount: string;
  validFrom: string;
}

export interface PartnerRow {
  partnerId: number;
  name: string;
  type: PartnerType;
  isActive: boolean;
  isAvailable: boolean;
  isTrial: boolean;
  baseTown: string | null;
  assigned: number;
  delivered: number;
  failed: number;
  returned: number;
  failedOrReturned: number;
  outNow: number;
  notYetDispatched: number;
  deliverySuccessRate: RateResult;
  confirmedToDispatchedDays: number | null;
  dispatchedToDeliveredDays: number | null;
  dataSource: PartnerDataSource;
  daysToPay: number | null;
  feeRule?: FeeRule | null;
  /** M5 (F-704): always null until then. */
  cashHeld: string | null;
  oldestUnpaidDays: number | null;
}

export interface PartnerTotal {
  assigned: number;
  delivered: number;
  failed: number;
  returned: number;
  failedOrReturned: number;
  outNow: number;
  notYetDispatched: number;
  deliverySuccessRate: RateResult;
}

export interface PartnerList {
  from: string;
  to: string;
  type: PartnerTab;
  /** Rows per tab, whatever tab is open. */
  counts: { all: number; agent: number; '3pl': number };
  rows: PartnerRow[];
  total: PartnerTotal;
}

export interface PartnerSummary {
  outNow: { orders: number; partners: number };
  waiting: { orders: number; oldestDays: number | null };
  delivered: { orders: number; revenue?: string; currency?: string };
  deliverySuccess: { rate: RateResult; target: number; gapPoints: number | null };
}

export interface WaitingOrder {
  orderId: number;
  orderNumber: string | null;
  status: OrderStatus;
  customerName: string;
  region: string | null;
  area: string | null;
  ageDays: number;
  overdue: boolean;
  partner: { id: number; name: string } | null;
  total?: string;
}

export interface WaitingList {
  orders: number;
  oldestDays: number | null;
  overdueAfterDays: number;
  list: WaitingOrder[];
}

export interface FailureReasons {
  total: number;
  failed: number;
  returned: number;
  reasons: Array<{ reason: FailureReason; count: number; percent: number | null }>;
}

export interface PartnerDetail {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  kind: PartnerKind;
  type: PartnerType;
  isActive: boolean;
  isAvailable: boolean;
  vehicleType: string | null;
  vehicleId: string | null;
  profile: { daysToPay: number; isTrial: boolean; dataSource: PartnerDataSource; baseTown: string | null };
  stockLocation: { id: number; name: string; type: string; isActive: boolean } | null;
  feeRule?: FeeRule;
}

/** Fields PATCH /api/delivery-partners/:id takes. */
export interface PartnerPatch {
  daysToPay?: number;
  isTrial?: boolean;
  dataSource?: PartnerDataSource;
  baseTown?: string | null;
  vehicleType?: string;
  vehicleId?: string | null;
}

/** POST /api/delivery-partners. A person with a login sets a password; without one the account cannot sign in. */
export interface NewPartner extends PartnerPatch {
  kind: PartnerKind;
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber?: string;
  password?: string;
}

export interface AttemptView {
  id: number;
  attemptedAt: string;
  reason: string | null;
  note: string | null;
  partner: { id: number; name: string };
}

/** GET /api/deliveries/by-order/:orderId, the parts the drawer reads (F-711, F-713). */
export interface OrderProof {
  proof: {
    recorded: boolean;
    proofType: string | null;
    recipientName: string | null;
    time: string | null;
    cashCollected: string | null;
    /** A signed link that expires (10 minutes). Relative to the API host. */
    photoUrl: string | null;
  };
  attempts: AttemptView[];
}

/** GET /api/inventory/returns/summary (COD-41, F-656): returns sent back by 3PLs, received, missing. */
export interface ReturnsSummary {
  partners: Array<{ locationId: number; partnerId: number | null; name: string; sent: number; received: number; missing: number }>;
  total: { sent: number; received: number; missing: number };
}

/** One row of GET /api/inventory/levels. */
export interface StockLevelRow {
  locationId: number;
  productId: number;
  productName: string;
  sku: string;
  onHand: number;
  reserved: number;
  inTransit: number;
}

/** One order of a partner in GET /api/delivery-partners/:id/order-proofs. */
export interface OrderProofSummary {
  orderId: number;
  photoUrl: string | null;
  attemptCount: number;
}

export interface RangeParams {
  from: string;
  to: string;
}

/** A role that may not read this (the API answers 403) gets null; any other failure still rejects. */
export async function allowed<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 403) return null;
    throw e;
  }
}

export const deliveryPartnersService = {
  async list(range: RangeParams, type: PartnerTab, skipCache = false): Promise<PartnerList> {
    const response = await apiClient.get('/api/delivery-partners', { params: { ...range, type }, skipCache, quiet: true });
    return response.data;
  },

  async summary(range: RangeParams, skipCache = false): Promise<PartnerSummary> {
    const response = await apiClient.get('/api/delivery-partners/summary', { params: range, skipCache, quiet: true });
    return response.data;
  },

  async failureReasons(range: RangeParams, skipCache = false): Promise<FailureReasons> {
    const response = await apiClient.get('/api/delivery-partners/failure-reasons', { params: range, skipCache, quiet: true });
    return response.data;
  },

  async waiting(limit: number, skipCache = false): Promise<WaitingList | null> {
    return allowed(apiClient.get('/api/delivery-partners/waiting', { params: { limit }, skipCache, quiet: true }).then((r) => r.data));
  },

  async get(id: number): Promise<PartnerDetail> {
    const response = await apiClient.get(`/api/delivery-partners/${id}`, { skipCache: true });
    return response.data.partner;
  },

  async update(id: number, patch: PartnerPatch): Promise<PartnerDetail> {
    const response = await apiClient.patch(`/api/delivery-partners/${id}`, patch);
    return response.data.partner;
  },

  /** Rule history, the rule in force per outcome and the weighted fee. `quiet`: the tab shows a failure itself. */
  async feeRules(id: number): Promise<FeeRulesResponse> {
    const response = await apiClient.get(`/api/delivery-partners/${id}/fee-rules`, { skipCache: true, quiet: true });
    return response.data;
  },

  /** One rule for one outcome from a date. A second rule with the same date is refused with a 409 sentence. `quiet`: the form shows it. */
  async addFeeRule(id: number, rule: NewFeeRule): Promise<FeeRuleRow> {
    const response = await apiClient.post(`/api/delivery-partners/${id}/fee-rules`, rule, { quiet: true });
    return response.data.rule;
  },

  async create(body: NewPartner): Promise<PartnerDetail> {
    const response = await apiClient.post('/api/delivery-partners', body);
    return response.data.partner;
  },

  async setAvailability(id: number, isAvailable: boolean): Promise<void> {
    await apiClient.patch(`/api/delivery-partners/${id}/availability`, { isAvailable });
  },

  /** Proof and attempts of one order. `quiet`: a failure shows in the drawer, not as a toast. */
  async orderProof(orderId: number): Promise<OrderProof> {
    const response = await apiClient.get(`/api/deliveries/by-order/${orderId}`, { quiet: true, skipCache: true });
    return { proof: response.data.proof, attempts: response.data.attempts };
  },

  async returnsSummary(range: RangeParams, skipCache = false): Promise<ReturnsSummary | null> {
    return allowed(apiClient.get('/api/inventory/returns/summary', { params: range, skipCache, quiet: true }).then((r) => r.data));
  },

  async stockLevels(locationId: number): Promise<StockLevelRow[] | null> {
    return allowed(apiClient.get('/api/inventory/levels', { params: { locationId }, skipCache: true, quiet: true }).then((r) => r.data.levels));
  },

  /** Photo link and attempt count of up to 50 orders of this partner, in one call. */
  async orderProofs(partnerId: number, orderIds: number[]): Promise<OrderProofSummary[]> {
    const response = await apiClient.get(`/api/delivery-partners/${partnerId}/order-proofs`, { params: { orderIds: orderIds.join(',') }, skipCache: true, quiet: true });
    return response.data.proofs;
  },
};
