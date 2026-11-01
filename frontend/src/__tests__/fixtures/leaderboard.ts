import type { Board, BadgeList, BoardRow } from '../../services/leaderboard.service';

// The October numbers of the T11 fixture, as GET /api/leaderboard answers them (clock 17 October 2026).
const callRow = (over: Partial<BoardRow>): BoardRow => ({
  rank: null, userId: 0, name: '', kind: 'person', roleId: 1, roleName: 'Call rep', payout: true, ranked: false, reason: null, target: '10.00',
  actual: 0, percent: null, confirmed: 0, confirmationRate: null, deliveredFromConfirmed: null, delivered: 0, tier: 'none', flag: null, badges: [],
  reward: null, earned: false, distance: null, message: '', ...over,
});
const deliveryRow = (over: Partial<BoardRow>): BoardRow => ({
  rank: null, userId: 0, name: '', kind: 'person', roleId: 2, roleName: 'Delivery', payout: true, ranked: false, reason: null, target: '60.00',
  actual: null, percent: null, success: null, daysToPay: null, delivered: 0, closed: 0, tier: 'none', flag: null, badges: [],
  reward: null, earned: false, distance: null, message: '', ...over,
});

const REWARDS = (role: 'call' | 'delivery'): NonNullable<Board['rewards']> => ({
  tiers: [role === 'call'
    ? { roleId: 1, roleName: 'Call rep', tier100: { amount: 300, dayOff: false, payout: true }, tier120: { amount: 500, dayOff: true, payout: true } }
    : { roleId: 2, roleName: 'Delivery', tier100: { amount: 250, dayOff: false, payout: true }, tier120: { amount: 400, dayOff: true, payout: true } }],
  noPayout: ['ai_agent', 'company'], message: 'No payout',
});

const MONTH = { key: 'month', kind: 'month' as const, label: 'October', from: '2026-10-01', to: '2026-10-31', closed: false };

export const CALL_MONTH: Board = {
  role: 'call_rep', period: MONTH, note: null, currency: 'GHS', rewards: REWARDS('call'),
  rows: [
    callRow({ rank: 1, userId: 1, name: 'Adwoa Darko', ranked: true, actual: 6, percent: 60, confirmed: 12, confirmationRate: 100, deliveredFromConfirmed: 50, delivered: 6, distance: { next: '100', amount: 4, unit: 'confirmed orders', message: '4 more confirmed orders that get delivered to reach 100% (GH₵300)' }, message: '4 more confirmed orders that get delivered to reach 100% (GH₵300)' }),
    callRow({ rank: 1, userId: 2, name: 'Tie Rep', ranked: true, actual: 3, percent: 60, confirmed: 5, confirmationRate: 90, deliveredFromConfirmed: 60, delivered: 3, message: '2 more confirmed orders that get delivered to reach 100% (GH₵300)' }),
    callRow({ rank: 3, userId: 3, name: 'Confirm agent', kind: 'ai_agent', payout: false, ranked: true, actual: 4, percent: 40, confirmed: 8, confirmationRate: 70, deliveredFromConfirmed: 44, delivered: 4, message: 'No payout. Attainment 40%' }),
    callRow({ rank: 4, userId: 4, name: 'Nana Kyei', ranked: true, actual: 2, percent: 20, confirmed: 3, confirmationRate: 58, deliveredFromConfirmed: 30, delivered: 2, message: '8 more confirmed orders that get delivered to reach 100% (GH₵300)' }),
    callRow({ userId: 5, name: 'Yaw New', reason: 'Set a target', target: null, message: 'Set a target' }),
    callRow({ rank: 1, userId: 6, name: 'Top Rep', ranked: true, actual: 13, percent: 130, tier: '120', confirmed: 20, confirmationRate: 95, deliveredFromConfirmed: 85, delivered: 13, reward: { amount: 500, dayOff: true }, message: 'Top tier reached. On track to earn GH₵500 and a paid day off at month close' }),
  ],
};
// the API sends ranked rows first; the order of the list above is what the page keeps
CALL_MONTH.rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

export const DELIVERY_MONTH: Board = {
  role: 'delivery', period: MONTH, note: null, currency: 'GHS', rewards: REWARDS('delivery'),
  rows: [
    deliveryRow({ rank: 1, userId: 11, name: 'Kofi Appiah', ranked: true, actual: 55.5, percent: 92.5, success: 55.5, daysToPay: 2, delivered: 10, closed: 18, distance: { next: '100', amount: 7, unit: 'deliveries with no failure', message: '7 more deliveries with no failure to reach 100%' }, message: '7 more deliveries with no failure to reach 100%' }),
    deliveryRow({ rank: 2, userId: 12, name: 'Esi Badu', ranked: true, actual: 55, percent: 91.6, success: 55, delivered: 11, closed: 20, message: '8 more deliveries with no failure to reach 100%' }),
    deliveryRow({ rank: 4, userId: 14, name: 'Logiswift', kind: 'company', payout: false, ranked: true, actual: 45, percent: 75, success: 45, delivered: 9, closed: 20, flag: 'contract_review', flagText: 'Contract review', message: 'No payout. Attainment 75%' }),
    deliveryRow({ userId: 15, name: 'Kasapa Express', kind: 'company', payout: false, reason: 'Too early', message: 'Too early' }),
  ],
};

export const CALL_TODAY: Board = {
  role: 'call_rep', period: { key: 'today', kind: 'today', label: 'Today', from: '2026-10-17', to: '2026-10-17', closed: false },
  note: 'Early in this period: only a few orders so far, so the ranking can change a lot.', currency: 'GHS', rewards: null,
  rows: [
    callRow({ rank: 1, userId: 1, name: 'Adwoa Darko', ranked: true, actual: 2, percent: 10, confirmed: 3, confirmationRate: 100, deliveredFromConfirmed: 100, delivered: 2 }),
  ],
};
export const DELIVERY_TODAY: Board = { ...DELIVERY_MONTH, period: CALL_TODAY.period, note: CALL_TODAY.note, rewards: null, rows: [] };

export const BADGES: BadgeList = {
  display: true,
  badges: [
    { key: 'top_of_month', label: 'Top of month', description: 'Rank 1 at month close', locked: false, holders: [{ userId: 1, name: 'Adwoa Darko', kind: 'person', period: '2026-09' }, { userId: 11, name: 'Kofi Appiah', kind: 'person', period: '2026-09' }] },
    { key: 'hit_target_3_months', label: 'Hit target 3 months running', description: '', locked: true, message: 'Locked, no one yet', holders: [] },
    { key: 'beat_target_20', label: 'Beat target by 20 percent', description: '', locked: false, holders: [{ userId: 11, name: 'Kofi Appiah', kind: 'person', period: '2026-09' }] },
    { key: 'zero_unpaid_8_days', label: 'Zero unpaid over 8 days', description: '', locked: true, message: 'Locked, no one yet', holders: [] },
  ],
};
