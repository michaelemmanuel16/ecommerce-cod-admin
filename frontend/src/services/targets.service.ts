import apiClient from './api';

/**
 * The Targets page API (M6-T15): GET /api/targets/tree (T07/T08 and the actuals of T15), the calculators, the daily progress, the
 * target writes, and the Rewards reads of M6-T09. The API client turns money strings under money keys (value, actual, total) into
 * numbers; "pool" and "allocated" stay strings, so read them with Number().
 */

export type StatusKey = 'revenue_hit' | 'hit_margin_missed' | 'ahead' | 'on_track' | 'behind';

export interface Actuals {
  state: 'past' | 'current' | 'future';
  actual: number | null;
  percent: number | null;
  /** Net margin percent of the same days; null = no margin data ("n/a"). */
  marginPct: number | null;
  status: { key: StatusKey; label: string } | null;
  pace: number | null;
  paceBasis: 'quarter_plan' | 'days' | null;
  chip: { points: number; tag: 'ahead' | 'behind' | 'on_pace' } | null;
}

export interface TreeNode {
  id: number;
  scope: 'north_star' | 'quarter' | 'month' | 'role' | 'person' | 'daily';
  metric: string;
  unit: string;
  value: number;
  periodStart: string;
  periodEnd: string;
  parentId: number | null;
  closed: boolean;
  actuals?: Actuals;
}

export type HolderKind = 'person' | 'ai_agent' | 'company' | 'system';

export interface Holder {
  userId: number;
  name: string;
  kind: HolderKind;
  typeLabel: string;
  target: { id: number; metric: string; unit: string; value: number } | null;
  /** "Set a target" while the owner has not set one. */
  label: string | null;
}

export interface RoleRow {
  roleId: number;
  roleName: string;
  target: TreeNode | null;
  pool: { metric: string; unit: string; total: number; allocated: string; pool: string } | null;
  holders: Holder[];
}

export interface Tree {
  year: number;
  metric: string;
  currency: string | null;
  marginTarget: number;
  northStar: TreeNode | null;
  quarters: TreeNode[];
  months: TreeNode[];
  roles?: RoleRow[];
}

/** One row of GET /api/rewards/attainment (backend rewardService.ts, M6-T09). */
export interface AttainmentRow {
  userId: number;
  name: string;
  kind: 'person' | 'ai_agent' | 'company';
  roleId: number;
  roleName: string;
  payout: boolean;
  metric: string | null;
  unit: string | null;
  target: number | null;
  actual: number | null;
  percent: number | null;
  tier: 'none' | '100' | '120';
  reward: { amount: number; dayOff: boolean } | null;
  earned: boolean;
  distance: { next: '100' | '120'; amount: number | null; unit: string; message: string } | null;
  warning: string | null;
  message: string;
}
export interface Attainment { period: string; closed: boolean; currency: string; results: AttainmentRow[] }

/** GET /api/rewards/settings: the tiers of every role. The reward cell reads tier100; nothing is typed in the page. */
export interface RewardSettings {
  currency: string;
  tiers: Array<{ roleId: number; roleName: string; tier100: { amount: number; dayOff: boolean; payout: boolean } | null; tier120: { amount: number; dayOff: boolean; payout: boolean } | null }>;
}

export interface Calculators {
  month: string;
  revenueTarget: number;
  plannedAov: number;
  confirmationRate: number;
  deliverySuccessRate: number;
  ordersDelivered: number;
  ordersToTakeIn: number;
  ordersPerDay: number;
  maxCostPerOrder: number | null;
}

export interface DailyProgress {
  metric: string;
  date: string;
  id: number | null;
  unit: string | null;
  target: number | null;
  actual: number | null;
  /** "No data for this metric" when the metric has no source. */
  message: string | null;
}

export interface SaveTargetInput {
  scope: 'role' | 'person' | 'daily';
  metric: string;
  unit: string;
  value: number;
  period: string;
  roleId?: number;
  userId?: number;
}

export const targetsService = {
  async tree(year: number, month?: string): Promise<Tree> {
    return (await apiClient.get('/api/targets/tree', { params: { year, month }, quiet: true })).data;
  },
  async calculators(month: string): Promise<Calculators> {
    return (await apiClient.get('/api/targets/calculators', { params: { month }, quiet: true })).data;
  },
  async daily(metric: string, date: string): Promise<DailyProgress> {
    return (await apiClient.get('/api/targets/daily', { params: { metric, date }, quiet: true })).data;
  },
  async attainment(period: string): Promise<Attainment> {
    return (await apiClient.get('/api/rewards/attainment', { params: { period }, quiet: true })).data;
  },
  async rewardSettings(): Promise<RewardSettings> {
    return (await apiClient.get('/api/rewards/settings', { quiet: true })).data;
  },
  async save(input: SaveTargetInput): Promise<void> {
    await apiClient.post('/api/targets', input, { quiet: true });
  },
  async update(id: number, value: number): Promise<void> {
    await apiClient.put(`/api/targets/${id}`, { value }, { quiet: true });
  },
  async remove(id: number): Promise<void> {
    await apiClient.delete(`/api/targets/${id}`, { quiet: true });
  },
};
