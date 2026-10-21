// Words for the Dashboard: tag labels from the API's tag keys, and the info tooltip of every figure
// (name, formula, date basis; PRD F-200). The formulas describe what the backend KPI services do; they are not run here.
import type { ProgressTag, RateTag, Tone } from './types';

export const PROGRESS_TAG: Record<ProgressTag, { label: string; tone: 'ok' | 'warn' | 'bad' | 'n' }> = {
  hit: { label: 'Hit', tone: 'ok' },
  on_track: { label: 'On track', tone: 'ok' },
  behind: { label: 'Behind', tone: 'warn' },
  off_track: { label: 'Off track', tone: 'bad' },
  no_target: { label: 'No target', tone: 'n' },
};

export const RATE_TAG: Record<RateTag, { label: string; tone: 'ok' | 'warn' | 'bad' | 'n' }> = {
  on_track: { label: 'On track', tone: 'ok' },
  behind: { label: 'Behind', tone: 'warn' },
  off_track: { label: 'Off track', tone: 'bad' },
  no_data: { label: 'No data', tone: 'n' },
};

/** Bar colour class (.prog i.gold / .coral) for a progress tag; mint is the default fill. */
export const BAR_OF_PROGRESS: Record<ProgressTag, '' | 'gold' | 'coral'> = {
  hit: '', on_track: '', behind: 'gold', off_track: 'coral', no_target: '',
};
export const BAR_OF_TONE: Record<Tone, '' | 'gold' | 'coral'> = { ok: '', warn: 'gold', bad: 'coral' };

export const RANGE_LABELS = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  quarter: 'This quarter',
  year: 'This year',
} as const;

export const LEVER_LABEL = { confirmationRate: 'Confirmation rate', deliverySuccessRate: 'Delivery success' } as const;

export interface Info { name: string; formula: string; basis: string }

export const INFO = {
  northStar: {
    name: 'North Star: delivered revenue this year',
    formula: 'Delivered revenue this year ÷ the year target',
    basis: 'Delivery date, 1 January to today (store time)',
  },
  quarter: {
    name: 'Quarter target',
    formula: 'Delivered revenue this quarter ÷ the quarter target. The pace marker is days gone ÷ days in the quarter',
    basis: 'Delivery date, this quarter so far (store time)',
  },
  month: {
    name: 'Month target',
    formula: 'Delivered revenue this month ÷ the month target. The pace marker is days gone ÷ days in the month',
    basis: 'Delivery date, this month so far (store time)',
  },
  today: {
    name: "Today's target",
    formula: "Delivered revenue today ÷ today's target. Today's target is (month target − delivered so far) ÷ days left after today",
    basis: 'Delivery date, today (store time)',
  },
  newOrders: {
    name: 'New orders',
    formula: 'Orders placed today, against the orders needed per day from the North Star setup',
    basis: 'Order date, today (store time)',
  },
  deliveredRevenue: {
    name: 'Delivered revenue today',
    formula: "Delivered revenue today ÷ today's target",
    basis: 'Delivery date, today (store time)',
  },
  failedCalls: {
    name: 'Failed delivery calls',
    formula: 'Orders with a failed delivery that got a call today, counted once per order, against the daily call target',
    basis: 'Call date, today (store time)',
  },
  ordersToday: {
    name: 'Orders today',
    formula: 'Orders placed today, compared with the same weekday last week',
    basis: 'Order date, today (store time)',
  },
  confirmationRate: {
    name: 'Confirmation rate',
    formula: 'Confirmed orders ÷ orders placed',
    basis: 'Order date, inside the range you picked',
  },
  deliverySuccessRate: {
    name: 'Delivery success rate',
    formula: 'Delivered ÷ (delivered + failed + returned). Orders still out for delivery do not count. Yield is delivered ÷ orders placed',
    basis: 'Orders placed inside the range you picked, closed orders only',
  },
  cash: {
    name: 'Cash still with agents',
    formula: 'Cash that delivery agents and 3PL partners collected and have not yet paid in',
    basis: 'Right now. The range does not change it',
  },
  chart: {
    name: 'Delivered revenue vs target',
    formula: 'Running total of delivered revenue, one point a day. The target pace is a straight line from 0 to the period target',
    basis: 'Delivery date, inside the range you picked',
  },
  projected: {
    name: 'Projected month',
    formula: 'Revenue so far ÷ days gone × days in the month',
    basis: "Delivery date, this month, at today's rate",
  },
  needed: {
    name: 'Needed per day',
    formula: '(Month target − revenue so far) ÷ days left after today',
    basis: 'Delivery date, this month (store time)',
  },
  lever: {
    name: 'Biggest lever',
    formula: 'The rate furthest under its target, and what 5 more points of it would add this month at the current pace',
    basis: 'Order cohort of this month, at the current rate',
  },
  recentOrders: {
    name: 'Recent orders',
    formula: 'The latest orders placed inside the range you picked, newest first',
    basis: 'Order date',
  },
} satisfies Record<string, Info>;
