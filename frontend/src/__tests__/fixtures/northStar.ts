import type { Calculators, Drivers, SplitPreview, Tree } from '../../services/targets.service';
import { TREE } from './targetsTree';

// Fixtures of the North Star wizard and the Settings tab (M6-T17): the split of 1,800,000 in each mode, the drivers, the October calculator tiles.

const rows = (q: number[]): SplitPreview => ({ quarters: q.map((v) => `${v}.00`), months: q.map((v) => Array(3).fill(`${v / 3}.00`)), kept: 0 });
export const PREVIEWS = {
  grow: rows([360_000, 420_000, 480_000, 540_000]),
  even: rows([450_000, 450_000, 450_000, 450_000]),
};

export const DRIVERS: Drivers = {
  year: 2026,
  plannedAov: { value: 245, source: 'auto', last30Days: 245, deliveredOrders: 38, required: false },
  confirmationRate: { value: 70, source: 'default' },
  deliverySuccessRate: { value: 60, source: 'default' },
  netMargin: { value: 35, source: 'default' },
};

export const CALC: Calculators = {
  month: '2026-10', daysInMonth: 31, revenueTarget: 180_000, plannedAov: 249, confirmationRate: 70, deliverySuccessRate: 60,
  ordersDelivered: 723, ordersToTakeIn: 1721, ordersPerDay: 56, maxCostPerOrder: 8700,
};

/** A saved Grow tree, months included, with a past month. */
export const SAVED: Tree = { ...TREE, roles: undefined };
/** No North Star saved yet. */
export const EMPTY: Tree = { ...TREE, northStar: null, quarters: [], months: [], roles: undefined };
