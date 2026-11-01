import { Target } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { daysInMonth, getStoreTimeZone, localDate, MONTH_RE, parseYmd, utcDate, ymdOfUtc } from './kpi/dates';
import { isOwnerRole } from '../config/defaultRoles';
import { actualsOf } from './targetActuals';
import { autoPlannedAov, plannedAovBounds, plannedAovWindow } from './kpi/leadership';
import { topProductByDelivered } from './finance/profitService';
import { deleteTarget, replanYear, roleViews, saveTarget, saveTargets, type TargetInput } from './targetService';
import { GrowthMode, assertRate, maxCostPerOrder, monthSplit, ordersDelivered, ordersPerDay, ordersToTakeIn, planQuarters } from './northStarMath';

/**
 * M6-T08 (F-1111, F-1112, F-1113): the North Star. It builds the year's tree through `replanYear` (T07), keeps the driver
 * targets, and previews the calculators.
 *
 * Driver targets are `Target` rows on the year (scope north_star, no parent, so they never count in the quarter sum):
 *   planned_aov            money    only an owner edit is stored, with source 'manual'. Without one the default is worked out
 *                                   from the last 30 days of delivered orders and reported as source 'auto' (a stored 'auto'
 *                                   row would be read as a manual override by the dashboard, kpi/leadership.ts).
 *   confirmation_rate      percent  (70)   default 70 when not set
 *   delivery_success_rate  percent  (60)   default 60 when not set
 *   net_margin             percent  (35)   default 35 when not set
 */

export const REVENUE_METRIC = 'revenue';
export const DRIVER_METRICS = { plannedAov: 'planned_aov', confirmationRate: 'confirmation_rate', deliverySuccessRate: 'delivery_success_rate', netMargin: 'net_margin' } as const;
export const DEFAULT_CONFIRMATION = 70;
export const DEFAULT_DELIVERY_SUCCESS = 60;
export const DEFAULT_NET_MARGIN = 35;

/** [year, month] of a 'YYYY-MM' string, or 400. */
const monthParts = (month: string): [number, number] => {
  const m = MONTH_RE.exec(month);
  if (!m) throw new AppError(`Invalid month "${month}"`, 400, 'INVALID_PERIOD');
  return [Number(m[1]), Number(m[2])];
};

const todayYmd = () => localDate(new Date(), getStoreTimeZone(resolveTenantId()));

// ---- Driver targets ------------------------------------------------------------------------------------------------

const driverRow = (metric: string, year: number) =>
  prisma.target.findFirst({
    where: { scope: 'north_star', metric, roleId: null, userId: null, periodStart: utcDate(year, 1) }, orderBy: { createdAt: 'desc' },
  });

/** The planned AOV in use: the owner's edit, else the default from the last 30 days, else empty (and required). */
export async function plannedAov(year: number) {
  const tenantId = resolveTenantId();
  const [manual, window] = await Promise.all([driverRow(DRIVER_METRICS.plannedAov, year), plannedAovWindow(tenantId, todayYmd())]);
  const auto = autoPlannedAov(window);
  const kept = manual && manual.source === 'manual' && manual.value.gt(0) ? manual.value : null;
  return {
    value: kept ? Money.toApi(kept) : auto ? Money.toApi(auto) : null,
    source: (kept ? 'manual' : 'auto') as 'manual' | 'auto',
    /** The default from the last 30 days, so the screen can offer "Reset to last 30 days". */
    last30Days: auto ? Money.toApi(auto) : null,
    deliveredOrders: window.deliveredOrders.value,
    required: !kept && !auto,
  };
}

const rateOf = async (metric: string, year: number, fallback: number) => {
  const row = await driverRow(metric, year);
  return { value: row ? Number(row.value) : fallback, source: (row ? 'target' : 'default') as 'target' | 'default' };
};

export async function getDrivers(year: number) {
  const [aov, confirmation, delivery, margin] = await Promise.all([
    plannedAov(year),
    rateOf(DRIVER_METRICS.confirmationRate, year, DEFAULT_CONFIRMATION),
    rateOf(DRIVER_METRICS.deliverySuccessRate, year, DEFAULT_DELIVERY_SUCCESS),
    rateOf(DRIVER_METRICS.netMargin, year, DEFAULT_NET_MARGIN),
  ]);
  return { year, plannedAov: aov, confirmationRate: confirmation, deliverySuccessRate: delivery, netMargin: margin };
}

export interface DriverInput {
  /** A number is an owner edit (source manual). null clears it: back to the last-30-days default. */
  plannedAov?: number | null;
  /** Percent, more than 0 and up to 100. */
  confirmationRate?: number;
  deliverySuccessRate?: number;
  netMargin?: number;
}

/** A percent rate must be more than 0 and up to 100 (RATE_INVALID). */
const assertPercent = (value: number): void => { assertRate(Money.div(value, 100)); };

const assertAov = (value: number): void => {
  if (!(value > 0)) throw new AppError('The planned AOV must be more than 0', 400, 'AOV_INVALID');
};

/** An owner edit of the planned AOV, stored as manual. */
const aovInput = (value: number, year: number): TargetInput =>
  ({ scope: 'north_star', metric: DRIVER_METRICS.plannedAov, unit: 'money', value, period: String(year), source: 'manual' });

/** Save the driver targets in one transaction: all of them or none. A plannedAov of null removes the manual edit. */
export async function saveDrivers(year: number, input: DriverInput) {
  const percents: Array<[string, number | undefined]> = [
    [DRIVER_METRICS.confirmationRate, input.confirmationRate], [DRIVER_METRICS.deliverySuccessRate, input.deliverySuccessRate], [DRIVER_METRICS.netMargin, input.netMargin],
  ];
  const saves: TargetInput[] = [];
  for (const [metric, v] of percents) {
    if (v === undefined) continue;
    assertPercent(v);
    saves.push({ scope: 'north_star', metric, unit: 'percent', value: v, period: String(year) });
  }
  const removeIds: number[] = [];
  if (input.plannedAov === null) {
    const row = await driverRow(DRIVER_METRICS.plannedAov, year);
    if (row) removeIds.push(row.id);
  } else if (input.plannedAov !== undefined) {
    assertAov(input.plannedAov);
    saves.push(aovInput(input.plannedAov, year));
  }
  await saveTargets(saves, removeIds);
  return getDrivers(year);
}

// ---- The tree -------------------------------------------------------------------------------------------------------

export interface NorthStarInput {
  year: number;
  annual: number;
  mode: GrowthMode;
  /** Four quarter values for mode custom. They must add up to `annual`. */
  customQuarters?: number[];
  /** An owner edit of the planned AOV, saved with the tree. */
  plannedAov?: number;
}

/**
 * Create or re-plan the year's tree. Months that are past (before this store month) or closed, and exist, keep their value; a
 * quarter whose three months are all kept keeps its value; the rest of the annual figure is spread over the other quarters in
 * the chosen mode, and the months of a quarter share what is left of it evenly. Blocked, with nothing saved, when custom quarters
 * do not add up (TARGET_SUM_MISMATCH) or when there is no planned AOV (AOV_REQUIRED). An AOV typed with the tree is saved in the
 * same transaction.
 */
export async function saveNorthStar(input: NorthStarInput) {
  if (!(input.annual > 0)) throw new AppError('The North Star must be more than 0', 400);
  if (input.plannedAov === undefined) {
    if ((await plannedAov(input.year)).required) {
      throw new AppError('Set the planned AOV: no orders were delivered in the last 30 days, so there is no default', 400, 'AOV_REQUIRED');
    }
  } else {
    assertAov(input.plannedAov);
  }

  const today = parseYmd(todayYmd());
  const firstOpenMonth = utcDate(today.year, today.month);
  const result = await replanYear(REVENUE_METRIC, 'money', input.year, (existing) => {
    const monthAt = (i: number) => existing.find((r) => r.scope === 'month' && r.periodStart.getTime() === utcDate(input.year, i).getTime());
    const fixedMonths = [0, 1, 2, 3].map((q) => [1, 2, 3].map((i) => {
      const r = monthAt(q * 3 + i);
      return r && (r.closedAt !== null || r.periodStart < firstOpenMonth) ? r.value : null;
    }));
    const fixedQuarters = fixedMonths.map((ms) => (ms.every((v) => v !== null) ? Money.sum(ms as Money.Money[]) : null));
    const quarters = planQuarters(input.annual, input.mode, input.customQuarters, fixedQuarters);
    return {
      annual: Money.parse(input.annual),
      quarters: quarters.map((value, q) => ({ value, months: monthSplit(value, fixedMonths[q]) })),
      extra: fixedMonths.flat().filter((v) => v !== null).length,
    };
  }, input.plannedAov === undefined ? [] : [aovInput(input.plannedAov, input.year)]);
  return {
    year: input.year, metric: REVENUE_METRIC, northStar: view(result.northStar), quarters: result.quarters.map(view), months: result.months.map(view),
    pastMonthsKept: result.extra,
  };
}

const view = (t: Target) => ({
  id: t.id, scope: t.scope, metric: t.metric, unit: t.unit, value: Money.toApi(t.value), periodStart: ymdOfUtc(t.periodStart), periodEnd: ymdOfUtc(t.periodEnd),
  parentId: t.parentId, closed: t.closedAt !== null,
});

/**
 * The year's tree (North Star, quarters, months). For the revenue tree each node also carries `actuals`: delivered revenue, margin and
 * status for a past or current period, nothing for a future one (F-1101). With `month` ('YYYY-MM'): every role (not the Owner) with
 * its target for that month, pool and holders; a role with no holder reads as vacant on the page.
 */
export async function getTree(year: number, month?: string, metric = REVENUE_METRIC) {
  const monthStart = month === undefined ? null : monthParts(month);
  if (monthStart && monthStart[0] !== year) throw new AppError(`Invalid month "${month}" for ${year}`, 400, 'INVALID_PERIOD');
  const [rows, marginTarget, roles] = await Promise.all([
    prisma.target.findMany({
      where: { metric, roleId: null, userId: null, scope: { in: ['north_star', 'quarter', 'month'] }, periodStart: { gte: utcDate(year, 1), lte: utcDate(year, 12, 31) } },
      orderBy: [{ periodStart: 'asc' }, { createdAt: 'asc' }],
    }),
    rateOf(DRIVER_METRICS.netMargin, year, DEFAULT_NET_MARGIN).then((r) => r.value),
    monthStart ? prisma.role.findMany({ select: { id: true, name: true, presetRole: true }, orderBy: { name: 'asc' } }) : [],
  ]);
  const [measured, views] = await Promise.all([
    metric === REVENUE_METRIC ? actualsOf(rows, year, marginTarget) : null,
    month !== undefined ? roleViews(roles.filter((r) => !isOwnerRole(r)).map((r) => r.id), month) : [],
  ]);
  const node = (t: Target) => ({ ...view(t), ...(measured && { actuals: measured.actuals.get(t.id) }) });
  const of = (scope: string) => rows.filter((r) => r.scope === scope).map(node);
  const names = new Map(roles.map((r) => [r.id, r.name]));
  return {
    year, metric, currency: measured?.currency ?? null, marginTarget, northStar: of('north_star')[0] ?? null, quarters: of('quarter'), months: of('month'),
    roles: month === undefined ? undefined : views.map(({ target, ...rest }) => ({
      ...rest, roleName: names.get(rest.roleId) ?? null, target: target ? view(target) : null
    })),
  };
}

/** The North Star and its driver rows change only through `saveNorthStar` and `saveDrivers` (the Owner's routes). */
export const NORTH_STAR_ONLY = () => new AppError('The North Star and its drivers are set with the North Star routes', 403, 'USE_NORTH_STAR');

/** Change the value of one saved role, person or daily target by id. A quarter or month goes through its set. */
export async function updateTargetValue(id: number, value: number, unit?: string) {
  const t = await prisma.target.findFirst({ where: { id } });
  if (!t) throw new AppError('Target not found', 404);
  if (t.scope === 'north_star') throw NORTH_STAR_ONLY();
  const period = t.scope === 'daily' ? ymdOfUtc(t.periodStart) : ymdOfUtc(t.periodStart).slice(0, 7);
  return saveTarget({
    scope: t.scope, metric: t.metric, unit: unit ?? t.unit, value, period,
    ...(t.roleId !== null && { roleId: t.roleId }), ...(t.userId !== null && { userId: t.userId }),
  });
}

/** Delete a role, person or daily target by id (the North Star and its drivers are refused). */
export async function removeTarget(id: number) {
  const t = await prisma.target.findFirst({ where: { id }, select: { scope: true } });
  if (!t) throw new AppError('Target not found', 404);
  if (t.scope === 'north_star') throw NORTH_STAR_ONLY();
  await deleteTarget(id);
}

// ---- Calculators ----------------------------------------------------------------------------------------------------

export interface CalculatorInput {
  /** 'YYYY-MM'; default the current month. */
  month?: string;
  aov?: number;
  /** Percent (70). Default: the driver targets. */
  confirmationRate?: number;
  deliverySuccessRate?: number;
  /** Month revenue target; default the saved month target. */
  revenueTarget?: number;
  /** Profit per delivered order before ads; default the top product's over the last 30 days (Marketing). */
  profitPerOrder?: number;
}

/** The driver tiles (F-1113): orders delivered, orders to take in, orders a day, max cost per order. Nothing is saved. */
export async function calculators(input: CalculatorInput) {
  const tenantId = resolveTenantId();
  const month = input.month ?? todayYmd().slice(0, 7);
  const [year, monthNo] = monthParts(month);
  const monthStart = utcDate(year, monthNo);

  const [aov, confirmation, delivery, monthTarget, profit] = await Promise.all([
    input.aov !== undefined ? null : plannedAov(year),
    input.confirmationRate ?? rateOf(DRIVER_METRICS.confirmationRate, year, DEFAULT_CONFIRMATION).then((r) => r.value),
    input.deliverySuccessRate ?? rateOf(DRIVER_METRICS.deliverySuccessRate, year, DEFAULT_DELIVERY_SUCCESS).then((r) => r.value),
    input.revenueTarget !== undefined ? null : prisma.target.findFirst({
      where: { scope: 'month', metric: REVENUE_METRIC, roleId: null, userId: null, periodStart: monthStart }, orderBy: { createdAt: 'desc' },
    }),
    input.profitPerOrder !== undefined ? input.profitPerOrder : profitPerOrder(tenantId),
  ]);

  const aovValue = input.aov ?? (aov?.value ? Number(aov.value) : null);
  if (aovValue === null) throw new AppError('Set the planned AOV: no orders were delivered in the last 30 days', 400, 'AOV_REQUIRED');
  const revenueTarget = input.revenueTarget ?? monthTarget?.value;
  if (revenueTarget === undefined) throw new AppError(`No revenue target is set for ${month}`, 400, 'NO_MONTH_TARGET');
  // The one rate check: percents become fractions here, and the math functions check them again only as their own guard.
  const conf = assertRate(Money.div(confirmation, 100));
  const success = assertRate(Money.div(delivery, 100));

  const days = daysInMonth(year, monthNo);
  const delivered = ordersDelivered(revenueTarget, aovValue);
  const takeIn = ordersToTakeIn(delivered, conf, success);
  return {
    month, daysInMonth: days, revenueTarget: Money.toApi(revenueTarget), plannedAov: Money.toApi(aovValue), plannedAovSource: aov?.source ?? 'input',
    confirmationRate: confirmation, deliverySuccessRate: delivery,
    ordersDelivered: delivered, ordersToTakeIn: takeIn, ordersPerDay: ordersPerDay(takeIn, days),
    maxCostPerOrder: profit === null ? null : maxCostPerOrder(profit, conf, success),
    profitPerOrder: profit === null ? null : Money.toApi(profit),
  };
}

/** The top product's profit per delivered order over the same 30 days as the default AOV (the Marketing figure), or null. */
async function profitPerOrder(tenantId: string): Promise<string | null> {
  const { from, to } = plannedAovBounds(tenantId, todayYmd());
  return (await topProductByDelivered(from, to))?.profitPerOrder ?? null;
}
