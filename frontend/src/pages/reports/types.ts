// Shapes of GET /api/reports/:tab (backend services/reportsService.ts). The frontend only formats these.
// Money can arrive as "92000.00" or, after the api.ts normaliser, as a number: read it with parseMoney.
import type { Block, Money, RateTag } from '../dashboard/types';

export type { Block, Money, RateTag };

/** The tabs the API answers for. */
export type ReportTabId = 'overview' | 'sales' | 'delivery' | 'team';

export interface ReportParams { from: string; to: string; compare: boolean }

export interface ReportHead {
  tab: ReportTabId;
  range: { from: string; to: string; days: number; timeZone: string };
  /** The previous period, null when compare is off. */
  compare: { from: string; to: string; days: number } | null;
  generatedAt: string;
  currency: string;
}
export type ReportBody = ReportHead | TeamReport;

export interface Counted { value: number; previous: number | null; deltaPercent: number | null }
export interface MoneyTile { value: Money; previous: Money | null; deltaPercent: number | null }
export interface RateTile { value: number | null; previous: number | null; deltaPoints: number | null }
export interface TargetedRate extends RateTile { target: number; tag: RateTag }
export interface SuccessRate extends TargetedRate { delivered: number; closed: number }

/* ---- Overview ---- */
export type Segment = 'delivered' | 'failed' | 'returned' | 'outForDelivery' | 'waitingToDispatch' | 'pendingCall' | 'cancelled' | 'other';
export interface OverviewTiles {
  currency: string;
  orders: Counted;
  confirmed: Counted & { confirmationRate: TargetedRate };
  delivered: Counted & { deliverySuccessRate: SuccessRate };
  deliveredRevenue: MoneyTile & { monthTarget: Money | null };
  orderToCashYield: RateTile;
}
export interface EndedUp {
  total: number;
  segments: Array<{ key: Segment; count: number; percent: number | null }>;
  deliverySuccessRate: number | null;
  orderToCashYield: number | null;
}
export interface DayRow { date: string; orders: number; confirmed: number; delivered: number; revenue: Money }
export interface DailyTable {
  rows: Array<DayRow & { previous: DayRow | null }>;
  total: { orders: number; confirmed: number; delivered: number; revenue: Money };
}
export interface OverviewReport extends ReportHead {
  tiles: Block<OverviewTiles>;
  endedUp: Block<EndedUp>;
  daily: Block<DailyTable>;
}

/* ---- Sales ---- */
export interface SalesTiles {
  currency: string;
  deliveredRevenue: MoneyTile;
  deliveredOrders: Counted;
  aov: { value: Money | null; previous: Money | null; deltaAmount: Money | null };
  thirtyDayAov: { value: Money | null; from: string; to: string; deliveredOrders: number };
  /** The two cash tiles are missing without financial:view. */
  cashReceived?: MoneyTile & { percentOfDeliveredRevenue: number | null };
  cashWithPartners?: { value: Money; partners: number };
}
export interface SalesReport extends ReportHead {
  tiles: Block<SalesTiles>;
  revenuePerDay: Block<{ rows: Array<{ date: string; revenue: Money; previous: { date: string; revenue: Money } | null }> }>;
  byProduct: Block<{ rows: Array<{ productId: number; name: string; units: number; revenue: Money; sharePercent: number | null }>; total: Money }>;
  byCity: Block<{
    label: string;
    rows: Array<{ city: string; delivered: number; revenue: Money; averageOrder: Money | null; sharePercent: number | null }>;
    total: { delivered: number; revenue: Money; averageOrder: Money | null };
  }>;
}

/* ---- Delivery ---- */
export interface DeliveryTiles {
  currency: string;
  deliverySuccessRate: SuccessRate;
  failed: Counted;
  returned: Counted;
  notReachable: { count: number; percentOfFailedAndReturned: number | null };
  outForDeliveryNow: { value: number; partners: number };
  slowestPaysIn: { partnerId: number; name: string; days: number } | null;
}
export interface PartnerRow {
  partnerId: number;
  name: string;
  assigned: number;
  delivered: number;
  failedOrReturned: number;
  outNow: number;
  closed: number;
  successRate: number | null;
  confirmedToDispatchedDays: number | null;
  dispatchedToDeliveredDays: number | null;
  /** Absent without financial:view. */
  cashHeld?: Money;
  paysInDays: number | null;
}
export interface DeliveryReport extends ReportHead {
  tiles: Block<DeliveryTiles>;
  deliveredPerDay: Block<{ rows: Array<{ date: string; delivered: number; previous: { date: string; delivered: number } | null }> }>;
  reasons: Block<{ total: number; rows: Array<{ reason: string; count: number; percent: number | null }> }>;
  successByCity: Block<{
    label: string;
    target: number;
    rows: Array<{ city: string; placed: number; delivered: number; failed: number; returned: number; closed: number; successRate: number | null }>;
  }>;
  waitingAndReturns: Block<{ waiting: { count: number; oldestDays: number | null }; returned: { count: number } }>;
  partners: Block<{
    rows: PartnerRow[];
    total: { assigned: number; delivered: number; failedOrReturned: number; outNow: number; successRate: number | null; cashHeld?: Money };
  }>;
}

/* ---- Team (GET /api/reports/team: no blocks, no previous period) ---- */
export interface CountedRate {
  value: number | null;
  detail?: Record<string, number>;
}
export interface TeamRates { confirmationRate: CountedRate; deliveredFromConfirmedRate: CountedRate }
export interface TeamRepRow extends TeamRates {
  repId: number;
  name: string;
  calls: number;
  confirmed: number;
  notReachable: number;
}
export interface TeamReport {
  from: string;
  to: string;
  asOf: string;
  tiles: {
    ordersConfirmed: number;
    callsMade: number;
    callsPerConfirmation: number | null;
    notReachable: { count: number; percentOfCalls: number | null };
    queue: { pending: number; oldestWaitMinutes: number | null; withoutRep: number };
  };
  reps: TeamRepRow[];
  all: TeamRates & { calls: number; confirmed: number; notReachable: number };
  callOutcomes: Array<{ outcome: string; count: number }>;
  declineReasons: Array<{ reason: string; count: number; percent: number | null }>;
}
