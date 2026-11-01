import apiClient from './api';

/**
 * The Targets page API (M6-T15): GET /api/targets/tree (T07/T08 and the actuals of T15), the calculators, the daily progress, the
 * target writes, and the Rewards reads of M6-T09. The API client turns money strings under money keys (value, actual, total) into
 * numbers; "pool" and "allocated" stay strings, so read them with Number().
 */

/** The keys of backend `TargetStatus` (services/targetStatus.ts); the model test pins the set. */
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
  /** ISO instant of the last change: "Set on <date>" on the North Star. */
  updatedAt: string;
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
  /** The tree's status word for this month's progress; null when the month has not started or there is no percent. */
  status: { key: StatusKey; label: string } | null;
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

export type GrowthMode = 'even' | 'grow' | 'custom';

/** GET /api/targets/drivers: the planned AOV in use (manual edit or the last 30 days), the two rates, the margin target. */
export interface Drivers {
  year: number;
  plannedAov: { value: number | null; source: 'auto' | 'manual'; last30Days: number | null; deliveredOrders: number; required: boolean };
  confirmationRate: { value: number; source: 'target' | 'default' };
  deliverySuccessRate: { value: number; source: 'target' | 'default' };
  netMargin: { value: number; source: 'target' | 'default' };
}

export interface DriverInput {
  /** A number is an owner edit (manual); null puts it back to the last 30 days. */
  plannedAov?: number | null;
  confirmationRate?: number;
  deliverySuccessRate?: number;
  netMargin?: number;
}

export interface NorthStarInput { year: number; annual: number; mode: GrowthMode; customQuarters?: number[]; plannedAov?: number }

/** GET /api/targets/north-star/preview: what a save would write: four quarters and the three months of each, money strings. */
export interface SplitPreview { quarters: string[]; months: string[][]; /** Months of the year that stay as they are (past or closed). */ kept: number }

export interface CalculatorParams {
  month?: string;
  aov?: number;
  confirmationRate?: number;
  deliverySuccessRate?: number;
  revenueTarget?: number;
  profitPerOrder?: number;
}

export interface Calculators {
  month: string;
  daysInMonth: number;
  revenueTarget: number;
  plannedAov: number;
  confirmationRate: number;
  deliverySuccessRate: number;
  ordersDelivered: number;
  ordersToTakeIn: number;
  ordersPerDay: number;
  maxCostPerOrder: number | null;
  profitPerOrder?: number | null;
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
  async calculators(params: CalculatorParams | string): Promise<Calculators> {
    return (await apiClient.get('/api/targets/calculators', { params: typeof params === 'string' ? { month: params } : params, quiet: true })).data;
  },
  async drivers(year: number): Promise<Drivers> {
    return (await apiClient.get('/api/targets/drivers', { params: { year }, quiet: true, skipCache: true })).data;
  },
  async saveDrivers(year: number, input: DriverInput): Promise<Drivers> {
    return (await apiClient.put('/api/targets/drivers', { year, ...input }, { quiet: true })).data;
  },
  async preview(year: number, annual: number, mode: GrowthMode, customQuarters?: number[]): Promise<SplitPreview> {
    const params = { year, annual, mode, ...(customQuarters && { customQuarters: customQuarters.join(',') }) };
    return (await apiClient.get('/api/targets/north-star/preview', { params, quiet: true })).data;
  },
  async saveNorthStar(input: NorthStarInput): Promise<void> {
    await apiClient.post('/api/targets/north-star', input, { quiet: true });
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
