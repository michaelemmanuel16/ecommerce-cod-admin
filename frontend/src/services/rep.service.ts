import apiClient from './api';
import type { DeclineReason, FailureReason, OrderStatus } from '../types';

export interface ShellSummary {
  queue: number;
  inbox: number;
  todayConfirmed: number;
}

export interface TodayStats {
  callsDone: number;
  confirmed: number;
  upsellExtra: string;
  timeToFirstCall: {
    medianMinutes: number | null;
    operatingHoursSet: boolean;
    targetMinutes: number | null;
    alertMinutes: number | null;
  };
  targetProgress: {
    hasTarget: boolean;
    message: string;
    target: number | null;
    actual: number | null;
    percent: number | null;
    tier: string;
    metric?: string | null;
    unit?: string | null;
    reward?: string | null;
    distance?: number | null;
  };
  confirmationRate: number | null;
  deliveredFromConfirmed: number | null;
}

/** One reward tier as the server sends it (rewardService tierView). */
export interface RewardTierConfig {
  amount: string;
  dayOff: boolean;
  payout: boolean;
}

export interface RewardDistance {
  next: '100' | '120';
  amount: number | null;
  unit: string;
  message: string;
}

export interface RewardProgressResult {
  period: string;
  currency: string;
  target: string | null;
  actual: number;
  percent: number | null;
  tier: 'none' | '100' | '120';
  tiers: {
    tier100: RewardTierConfig | null;
    tier120: RewardTierConfig | null;
  } | null;
  reward: { amount: string; dayOff: boolean } | null;
  distance: RewardDistance | null;
  message: string;
  note: string;
  targetReached: boolean;
  earned: boolean;
}

export interface QueueItem {
  id: number;
  status: string;
  customer: {
    id: number;
    name: string;
    phoneNumber: string;
    alternatePhone?: string | null;
    area: string;
    riskLevel?: string;
    refusedOrders?: number;
    deliveredOrders?: number;
    codBlocked?: boolean;
    wrongNumber?: boolean;
  };
  area: string;
  itemsSummary: string;
  totalAmount: string;
  saidNo: boolean;
  customerResponse?: 'yes' | 'no' | 'change' | 'cancel' | null;
  tab: 'new' | 'call_back' | 'said_no' | 'not_reachable';
  waitMinutes: number;
  waitTimerSeverity: 'normal' | 'gold' | 'coral';
  callbackAt: string | null;
  callbackDue: boolean;
  callbackSeverity: 'normal' | 'gold' | 'coral' | null;
  createdAt: string;
  updatedAt: string;
  priority: number;
}

export interface QueueResult {
  tabs: {
    new: number;
    call_back: number;
    said_no: number;
    not_reachable: number;
    total: number;
  };
  orders: QueueItem[];
  total: number;
  firstCallTargetMinutes: number;
  queueWaitAlertMinutes: number;
}

export interface CallCardOrder {
  id: number;
  status: OrderStatus;
  totalAmount: string | number;
  subtotal: string | number;
  deliveryFee: string | number | null;
  customerRepId: number | null;
  deliveryAgentId: number | null;
  deliveryAgent: { id: number; name: string; phoneNumber?: string } | null;
  customerRep: { id: number; name: string } | null;
  createdAt: string;
  updatedAt: string;
  firstContactAt: string | null;
  saidNo: boolean;
  customerResponse: string | null;
  requiresManualCall: boolean;
  notes: string | null;
  declineReason: DeclineReason | null;
  failureReason: FailureReason | null;
  statusVersion: number;
}

export interface CallCardCustomerPreviousOrder {
  id: number;
  createdAt: string;
  totalAmount: string | number;
  status: string;
}

export interface CallCardCustomer {
  id: number;
  firstName: string;
  lastName: string;
  name: string;
  phoneNumber: string;
  alternatePhone: string | null;
  email: string | null;
  address: string | null;
  area: string;
  state: string;
  riskLevel: string;
  refusedOrders: number;
  deliveredOrders: number;
  codBlocked: boolean;
  wrongNumber: boolean;
  previousOrders: CallCardCustomerPreviousOrder[];
}

export interface CallCardItem {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: string | number;
  totalPrice: string | number;
}

export interface CallCardPackageTier {
  id: number;
  name: string;
  price: string | number;
  description?: string | null;
  unitsCount?: number;
  isPopular?: boolean;
  isDefault?: boolean;
  extraValueFromBase?: string | number;
}

export interface CallCardAddon {
  id: number;
  name: string;
  price: string | number;
  productId?: number | null;
  isActive?: boolean;
}

export interface CallCardPackages {
  orderId: number;
  currentPackage: {
    id: number | null;
    name: string | null;
    price: string | number;
  };
  availablePackages: CallCardPackageTier[];
  availableAddons: CallCardAddon[];
}

export interface CallCardCallHistory {
  id: number;
  outcome: string;
  duration: number | null;
  notes: string | null;
  startedAt: string | null;
  callbackAt: string | null;
  declineReason: string | null;
  createdAt: string;
  salesRep: { id: number; name: string } | null;
}

export interface CallCardPay {
  baseCommission: string;
  upsellPercent: number;
}

export interface CallCardData {
  order: CallCardOrder;
  customer: CallCardCustomer;
  items: CallCardItem[];
  packages: CallCardPackages;
  lastCalls: CallCardCallHistory[];
  nextOrderId: number | null;
  pay: CallCardPay;
}

export const repService = {
  async getSummary(repId?: number): Promise<ShellSummary> {
    const res = await apiClient.get<ShellSummary>('/api/rep/summary', {
      params: repId ? { repId } : undefined,
    });
    return res.data;
  },

  async getToday(repId?: number): Promise<TodayStats> {
    const res = await apiClient.get<TodayStats>('/api/rep/today', {
      params: repId ? { repId } : undefined,
    });
    return res.data;
  },

  async getRewardProgress(repId?: number, period?: string): Promise<RewardProgressResult> {
    const res = await apiClient.get<RewardProgressResult>('/api/rep/reward-progress', {
      params: { repId, period },
    });
    return res.data;
  },

  async getQueue(tab?: string, q?: string, repId?: number): Promise<QueueResult> {
    const res = await apiClient.get<QueueResult>('/api/rep/queue', {
      params: { tab, q, repId },
    });
    return res.data;
  },
  async getCallCard(orderId: number): Promise<CallCardData> {
    const response = await apiClient.get(`/api/rep/orders/${orderId}/card`);
    return response.data;
  },

  async getOrders(params?: RepOrdersQuery): Promise<RepOrdersResult> {
    const res = await apiClient.get<RepOrdersResult>('/api/rep/orders', {
      params,
    });
    return res.data;
  },

  async getNumbers(repId?: number, period?: string): Promise<RepNumbersResult> {
    const res = await apiClient.get<RepNumbersResult>('/api/rep/numbers', {
      params: { repId, period },
    });
    return res.data;
  },

  async getEarnings(repId?: number, month?: string): Promise<RepEarningsResult> {
    const res = await apiClient.get<RepEarningsResult>('/api/rep/earnings', {
      params: { repId, month },
    });
    return res.data;
  },

  async getPayouts(params?: { repId?: number; page?: number; limit?: number }): Promise<RepPayoutsResult> {
    const res = await apiClient.get<RepPayoutsResult>('/api/rep/payouts', {
      params,
    });
    return res.data;
  },
};

export interface RepOrderCustomer {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  alternatePhone?: string | null;
  address?: string | null;
  area?: string | null;
  state?: string | null;
}

export interface RepOrderItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

export interface RepOrderRow {
  id: number;
  createdAt: string;
  status: OrderStatus;
  totalAmount: string;
  customer: RepOrderCustomer | null;
  customerRep: { id: number; firstName: string; lastName: string } | null;
  items: RepOrderItem[];
  upsellExtraValue: string;
}

export interface RepOrdersResult {
  orders: RepOrderRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface RepOrdersQuery {
  repId?: number;
  q?: string;
  status?: string;
  page?: number;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}

export interface RepTargetHit {
  target: number;
  actual: number;
  percent: number | null;
}

export interface RepNumbersResult {
  repId: number;
  period: string;
  confirmed: number;
  confirmationRate: number | null;
  confirmationRateDetail: Record<string, number>;
  deliveredFromConfirmedRate: number | null;
  deliveredFromConfirmedDetail: Record<string, number>;
  upsellRate: number;
  upsellCount: number;
  extraValueAdded: string;
  timeToFirstCall: number | null;
  targetHit: RepTargetHit | null;
  ranks: {
    callRep: { rank: number | null; total: number } | null;
    upsell: { rank: number | null; total: number } | null;
  };
  orderBreakdown: {
    confirmed: number;
    delivered: number;
    failedOrReturned: number;
    stillOpen: number;
  };
  calls: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    averagePerDay: number;
  };
  callOutcomes: Record<string, number>;
  callsPerDay: { date: string; count: number; isToday: boolean }[];
}

export interface RepEarningsLine {
  orderId: number;
  date: string;
  customerName: string | null;
  status: OrderStatus;
  base: string;
  upsell: string;
  earned: string;
  paid: string;
  reversal: string | null;
  isReversal: boolean;
  /** A return deduction row (COD-193): amount < 0, label "Order #<id> returned". */
  isDeduction?: boolean;
  label?: string;
}

export interface RepPayout {
  id: number;
  date: string;
  amount: string;
  status: string;
  notes: string | null;
  method: string | null;
  reference: string | null;
}

export interface RepEarningsResult {
  currency: string;
  commission: string;
  upsellReward: string;
  targetReward: string;
  earned: string;
  paid: string;
  owed: string;
  overpaid: string | null;
  isOverpaid: boolean;
  openOrdersCount: number;
  openOrdersNote: string;
  message?: string;
  lines: RepEarningsLine[];
  payouts: RepPayout[];
}

export interface RepPayoutsResult {
  payouts: RepPayout[];
  total: number;
  page: number;
  limit: number;
}
