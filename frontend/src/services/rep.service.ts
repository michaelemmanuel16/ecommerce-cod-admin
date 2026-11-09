import apiClient from './api';

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

export interface RewardTierConfig {
  thresholdPercent: number;
  bonusAmount: string;
  description: string;
}

export interface RewardProgressResult {
  period: string;
  currency: string;
  target: number | null;
  actual: number;
  percent: number | null;
  tier: string;
  tiers: {
    tier100: RewardTierConfig;
    tier120: RewardTierConfig;
  } | null;
  reward: string | null;
  distance: number | null;
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
};
