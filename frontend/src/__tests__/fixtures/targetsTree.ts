import type { Actuals, Attainment, Calculators, RewardSettings, Tree, TreeNode } from '../../services/targets.service';

// The Targets page fixture: the October numbers of the mockup (clock 17 October 2026). Money is a number, as the API client delivers it.

const FUTURE: Actuals = { state: 'future', actual: null, percent: null, marginPct: null, status: null, pace: null, paceBasis: null, chip: null };
const node = (id: number, scope: TreeNode['scope'], start: string, end: string, value: number, actuals?: Actuals): TreeNode => ({
  id, updatedAt: '2026-01-02T08:00:00.000Z', scope, metric: 'revenue', unit: 'money', value, periodStart: start, periodEnd: end, parentId: null, closed: false, actuals,
});
const past = (actual: number, percent: number, marginPct: number | null, key: 'revenue_hit' | 'hit_margin_missed' | 'behind', label: string): Actuals =>
  ({ state: 'past', actual, percent, marginPct, status: { key, label }, pace: null, paceBasis: null, chip: null });

export const TREE: Tree = {
  year: 2026, metric: 'revenue', currency: 'GHS', marginTarget: 35,
  northStar: node(1, 'north_star', '2026-01-01', '2026-12-31', 1_800_000, {
    state: 'current', actual: 1_382_000, percent: 76.8, marginPct: 12, status: { key: 'on_track', label: 'On track' }, pace: 79.5, paceBasis: 'quarter_plan',
    chip: { points: 3, tag: 'behind' },
  }),
  quarters: [
    node(11, 'quarter', '2026-01-01', '2026-03-31', 360_000, past(372_000, 103.3, 11, 'hit_margin_missed', 'Revenue hit, margin missed')),
    node(12, 'quarter', '2026-04-01', '2026-06-30', 420_000, past(421_000, 100.2, null, 'revenue_hit', 'Revenue hit')),
    node(13, 'quarter', '2026-07-01', '2026-09-30', 480_000, past(497_000, 103.5, 12, 'hit_margin_missed', 'Revenue hit, margin missed')),
    node(14, 'quarter', '2026-10-01', '2026-12-31', 540_000, {
      state: 'current', actual: 92_000, percent: 17, marginPct: -16, status: { key: 'behind', label: 'Behind' }, pace: 18.5, paceBasis: 'days', chip: { points: 2, tag: 'behind' },
    }),
  ],
  months: [
    node(21, 'month', '2026-01-01', '2026-01-31', 120_000, past(118_000, 98.3, 12, 'behind', 'Behind')),
    node(22, 'month', '2026-02-01', '2026-02-28', 120_000, past(121_000, 100.8, 12, 'revenue_hit', 'Revenue hit')),
    node(23, 'month', '2026-03-01', '2026-03-31', 120_000, past(133_000, 110.8, 11, 'hit_margin_missed', 'Revenue hit, margin missed')),
    node(24, 'month', '2026-10-01', '2026-10-31', 180_000, {
      state: 'current', actual: 92_000, percent: 51.1, marginPct: -16, status: { key: 'behind', label: 'Behind' }, pace: 54.8, paceBasis: 'days', chip: null,
    }),
    node(25, 'month', '2026-11-01', '2026-11-30', 180_000, FUTURE),
    node(26, 'month', '2026-12-01', '2026-12-31', 180_000, FUTURE),
  ],
  roles: [
    {
      roleId: 7, roleName: 'Call rep', target: { id: 31, scope: 'role', metric: 'confirmed_delivered', unit: 'count', value: 723, periodStart: '2026-10-01', periodEnd: '2026-10-31', parentId: null, closed: false },
      pool: { metric: 'confirmed_delivered', unit: 'count', total: 723, allocated: '673.00', pool: '50.00' },
      holders: [
        { userId: 101, name: 'Adwoa Darko', kind: 'person', typeLabel: 'Person', target: { id: 41, metric: 'confirmed_delivered', unit: 'count', value: 423 }, label: null },
        { userId: 102, name: 'Confirm agent', kind: 'ai_agent', typeLabel: 'AI agent', target: { id: 42, metric: 'confirmed_delivered', unit: 'count', value: 250 }, label: null },
        { userId: 103, name: 'Nana Kyei', kind: 'person', typeLabel: 'Person', target: null, label: 'Set a target' },
      ],
    },
    {
      roleId: 8, roleName: 'Delivery', target: { id: 32, scope: 'role', metric: 'delivery_success_rate', unit: 'percent', value: 60, periodStart: '2026-10-01', periodEnd: '2026-10-31', parentId: null, closed: false },
      pool: null, holders: [],
    },
    { roleId: 9, roleName: 'Stock keeper', target: null, pool: null, holders: [] },
  ],
};

export const ATTAINMENT: Attainment = {
  period: '2026-10', closed: false, currency: 'GHS',
  results: [
    { userId: 101, name: 'Adwoa Darko', kind: 'person', roleId: 7, roleName: 'Call rep', payout: true, metric: 'confirmed_delivered', unit: 'count', target: 423, actual: 253, percent: 60, tier: 'none', reward: null, earned: false, status: { key: 'ahead', label: 'Ahead' }, distance: null, warning: null, message: '' },
    { userId: 102, name: 'Confirm agent', kind: 'ai_agent', roleId: 7, roleName: 'Call rep', payout: false, metric: 'confirmed_delivered', unit: 'count', target: 250, actual: 110, percent: 44, tier: 'none', reward: null, earned: false, status: { key: 'behind', label: 'Behind' }, distance: null, warning: null, message: 'No payout' },
  ],
};

export const SETTINGS: RewardSettings = {
  currency: 'GHS',
  tiers: [{ roleId: 7, roleName: 'Call rep', tier100: { amount: 300, dayOff: false, payout: true }, tier120: { amount: 500, dayOff: true, payout: true } }],
  repPay: { baseCommission: 8, upsellPercent: '10.00' }, badgesDisplay: true, noPayout: ['ai_agent', 'company'], notice: 'Saved.',
};

export const CALCULATORS: Calculators = {
  month: '2026-10', daysInMonth: 31, revenueTarget: 180_000, plannedAov: 249, confirmationRate: 70, deliverySuccessRate: 60,
  ordersDelivered: 723, ordersToTakeIn: 1721, ordersPerDay: 56, maxCostPerOrder: null,
};
