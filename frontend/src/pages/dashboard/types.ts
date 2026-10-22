// Shapes of GET /api/dashboard/owner (backend services/dashboardService.ts). The frontend only formats these.
// Money fields can arrive as "92000.00" or, after the api.ts normaliser, as a number: read them with parseMoney.

export type Money = string | number;
export interface BlockError { error: { code: 'block_failed'; errorId: string; message?: string } }
export type Block<T> = T | BlockError;

export const DASHBOARD_RANGES = ['today', 'week', 'month', 'last_7_days', 'last_30_days', 'quarter', 'year'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export type ProgressTag = 'hit' | 'on_track' | 'behind' | 'off_track' | 'no_target';
export type RateTag = 'on_track' | 'behind' | 'off_track' | 'no_data';
export type Tone = 'ok' | 'warn' | 'bad';

export interface Header {
  asOfDate: string;
  generatedAt: string;
  timeZone: string;
  greeting: 'morning' | 'afternoon' | 'evening';
  currency: string;
  remainingToday: Money | null;
  remainingTodayRounded: Money | null;
  targetMet: boolean;
}

export interface Rung {
  actual: Money;
  target: Money | null;
  percent: number | null;
  pace: number;
  daysLeft: number;
  tag: ProgressTag;
}
export interface Ladder {
  currency: string;
  year: Rung & { paceChip: { points: number; tag: 'ahead' | 'behind' | 'on_pace' } | null };
  quarter: Rung;
  month: Rung;
  day: { actual: Money; target: Money | null; percent: number | null; deliveredOrders: number; tag: 'hit' | 'in_progress' | 'no_target' };
}

export interface QuestItem {
  key: 'new_orders' | 'delivered_revenue' | 'failed_delivery_calls';
  unit: 'count' | 'money';
  value: Money;
  target: Money | null;
  percent: number | null;
  tag: 'hit' | 'open';
  tone: Tone;
  targetSource?: string;
}
export interface Quests {
  onTargetDays: { hit: number; of: number; quest: string } | null;
  items: QuestItem[];
}

export interface Tiles {
  currency: string;
  range: { from: string; to: string };
  ordersToday: {
    value: number;
    target: number | null;
    vsLastWeek: { date: string; count: number; deltaPercent: number | null; trend: 'up' | 'down' | 'flat' | null };
  };
  confirmationRate: { value: number | null; target: number; gapPoints: number | null; tag: RateTag; confirmed: number; placed: number };
  deliverySuccessRate: {
    value: number | null; target: number; gapPoints: number | null; tag: RateTag; basis: string;
    yield: number | null; delivered: number; closed: number;
  };
  /** Missing when the viewer has no financial:view. */
  cash?: { value: Money; partners: number; /** orders behind the cash delivered more than 8 days ago */ overdueOrders?: number };
}

interface ChartDay { date: string; delivered: Money | null; cumulative: Money | null; targetPace: Money | null; vsPace: Money | null }
export interface Chart {
  currency: string;
  period: 'month' | 'quarter' | 'year' | null;
  target: Money | null;
  from: string;
  to: string;
  days: ChartDay[];
}

export interface Drivers {
  currency: string;
  projectedMonth: { value: Money | null; percentOfTarget: number | null; tooEarly: boolean; basis: string; daysGone: number; daysInMonth: number };
  neededPerDay: { value: Money | null; daysLeft: number };
  biggestLever: { rate: 'confirmationRate' | 'deliverySuccessRate' | null; points: number; value: Money | null };
}

export interface RecentOrder {
  id: number;
  externalOrderId: string | null;
  customerName: string;
  city: string | null;
  status: string;
  notReachable: boolean;
  amount: Money;
  currency: string;
  createdAt: string;
}

/** `recentOrders` is missing when the viewer has no orders:view. */
export interface OwnerDashboardData {
  header: Block<Header>;
  ladder: Block<Ladder>;
  quests: Block<Quests>;
  tiles: Block<Tiles>;
  chart: Block<Chart>;
  drivers: Block<Drivers>;
  recentOrders?: Block<RecentOrder[]>;
}

export function isBlockError<T>(block: Block<T> | undefined): block is BlockError {
  return !!block && typeof block === 'object' && !Array.isArray(block) && 'error' in block;
}
