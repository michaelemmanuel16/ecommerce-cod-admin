import { Target } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { daysInMonth, localDate, getStoreTimeZone, MONTH_RE, utcDate, ymdOfUtc } from './kpi/dates';
import { autoPlannedAov, plannedAovWindow } from './kpi/leadership';
import { topProductByDelivered } from './finance/profitService';
import { deleteTarget, replanYear, roleHolderTargets, rolePool, saveTarget } from './targetService';
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

const percentRate = (value: number): Money.Money => {
  assertRate(Money.div(value, 100)); // RATE_INVALID for 0, below 0 and above 100
  return Money.parse(value);
};

export async function saveDrivers(year: number, input: DriverInput) {
  const percents: Array<[string, number | undefined]> = [
    [DRIVER_METRICS.confirmationRate, input.confirmationRate], [DRIVER_METRICS.deliverySuccessRate, input.deliverySuccessRate], [DRIVER_METRICS.netMargin, input.netMargin],
  ];
  for (const [, v] of percents) if (v !== undefined) percentRate(v); // check all before saving any
  if (typeof input.plannedAov === 'number' && !(input.plannedAov > 0)) throw new AppError('The planned AOV must be more than 0', 400, 'AOV_INVALID');

  for (const [metric, v] of percents) {
    if (v !== undefined) await saveTarget({ scope: 'north_star', metric, unit: 'percent', value: v, period: String(year) });
  }
  if (input.plannedAov === null) {
    const row = await driverRow(DRIVER_METRICS.plannedAov, year);
    if (row) await deleteTarget(row.id);
  } else if (input.plannedAov !== undefined) {
    await saveTarget({ scope: 'north_star', metric: DRIVER_METRICS.plannedAov, unit: 'money', value: input.plannedAov, period: String(year), source: 'manual' });
  }
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
 * Create or re-plan the year's tree. Months that are past or closed (and exist) keep their value; a quarter whose three months
 * are all kept keeps its value; the rest of the annual figure is spread over the other quarters in the chosen mode, and the
 * months of a quarter share what is left of it evenly. Blocked, with nothing saved, when custom quarters do not add up
 * (TARGET_SUM_MISMATCH) or when there is no planned AOV (AOV_REQUIRED).
 */
export async function saveNorthStar(input: NorthStarInput) {
  if (!(input.annual > 0)) throw new AppError('The North Star must be more than 0', 400);
  const aov = input.plannedAov !== undefined ? null : await plannedAov(input.year);
  if (input.plannedAov === undefined && aov?.required) {
    throw new AppError('Set the planned AOV: no orders were delivered in the last 30 days, so there is no default', 400, 'AOV_REQUIRED');
  }
  if (input.plannedAov !== undefined && !(input.plannedAov > 0)) throw new AppError('The planned AOV must be more than 0', 400, 'AOV_INVALID');

  const firstOpenMonth = utcDate(startOfUtcDay().getUTCFullYear(), startOfUtcDay().getUTCMonth() + 1);
  let kept = 0;
  await replanYear(REVENUE_METRIC, 'money', input.year, (existing) => {
    const monthAt = (m: number) => existing.find((r) => r.scope === 'month' && r.periodStart.getTime() === utcDate(input.year, m).getTime());
    const isKept = (r: Target | undefined): r is Target => !!r && (r.closedAt !== null || r.periodStart < firstOpenMonth);
    const fixedMonths = [0, 1, 2, 3].map((q) => [1, 2, 3].map((i) => { const r = monthAt(q * 3 + i); return isKept(r) ? r.value : null; }));
    kept = fixedMonths.flat().filter((v) => v !== null).length;
    const fixedQuarters = fixedMonths.map((ms) => (ms.every((v) => v !== null) ? Money.sum(ms as Money.Money[]) : null));
    const quarters = planQuarters(input.annual, input.mode, input.customQuarters, fixedQuarters);
    return { annual: Money.parse(input.annual), quarters: quarters.map((value, q) => ({ value, months: monthSplit(value, fixedMonths[q]) })) };
  });
  if (input.plannedAov !== undefined) await saveDrivers(input.year, { plannedAov: input.plannedAov });
  return { ...(await getTree(input.year)), pastMonthsKept: kept };
}

const view = (t: Target) => ({
  id: t.id, scope: t.scope, metric: t.metric, unit: t.unit, value: Money.toApi(t.value), periodStart: ymdOfUtc(t.periodStart), periodEnd: ymdOfUtc(t.periodEnd),
  parentId: t.parentId, closed: t.closedAt !== null,
});

/** The year's tree (revenue North Star, quarters, months). With `month` ('YYYY-MM'): the role targets of that month with their pool and holders. */
export async function getTree(year: number, month?: string, metric = REVENUE_METRIC) {
  if (month !== undefined && (!MONTH_RE.test(month) || Number(month.slice(0, 4)) !== year)) throw new AppError(`Invalid month "${month}" for ${year}`, 400, 'INVALID_PERIOD');
  const rows = await prisma.target.findMany({
    where: { metric, roleId: null, userId: null, scope: { in: ['north_star', 'quarter', 'month'] }, periodStart: { gte: utcDate(year, 1), lte: utcDate(year, 12, 31) } },
    orderBy: [{ periodStart: 'asc' }, { createdAt: 'asc' }],
  });
  const of = (scope: string) => rows.filter((r) => r.scope === scope).map(view);
  const tree = { year, metric, northStar: of('north_star')[0] ?? null, quarters: of('quarter'), months: of('month'), roles: undefined as undefined | unknown[] };
  if (month !== undefined) {
    const roleTargets = await prisma.target.findMany({
      where: { scope: 'role', periodStart: utcDate(year, Number(month.slice(5))) }, include: { role: { select: { id: true, name: true } } }, orderBy: { id: 'asc' },
    });
    tree.roles = await Promise.all(roleTargets.map(async (t) => ({
      roleId: t.roleId, roleName: t.role?.name ?? null, target: view(t),
      pool: await rolePool(t.roleId!, month, t.metric).then((p) => p && { total: p.total, allocated: p.allocated, pool: p.pool }),
      holders: await roleHolderTargets(t.roleId!, month),
    })));
  }
  return tree;
}

/** Change the value of one saved North Star, role, person or daily target by id. A quarter or month goes through its set. */
export async function updateTargetValue(id: number, value: number, unit?: string) {
  const t = await prisma.target.findFirst({ where: { id } });
  if (!t) throw new AppError('Target not found', 404);
  const period = t.scope === 'north_star' ? String(t.periodStart.getUTCFullYear()) : t.scope === 'daily' ? ymdOfUtc(t.periodStart) : ymdOfUtc(t.periodStart).slice(0, 7);
  return saveTarget({
    scope: t.scope, metric: t.metric, unit: unit ?? t.unit, value, period,
    ...(t.roleId !== null && { roleId: t.roleId }), ...(t.userId !== null && { userId: t.userId }),
  });
}

// ---- Calculators ----------------------------------------------------------------------------------------------------

export interface CalculatorInput {
  /** 'YYYY-MM'; default the current month. */
  month?: string;
  /** Percent. Defaults: the driver targets. */
  aov?: number;
  confirmationRate?: number;
  deliverySuccessRate?: number;
  /** Month revenue target; default the saved month target. */
  revenueTarget?: number;
  /** Profit per delivered order before ads; default the top product's over the last 30 days (Marketing). */
  profitPerOrder?: number;
}

/** The driver tiles (F-1113): orders delivered, orders to take in, orders a day, max cost per order. Nothing is saved. */
export async function calculators(input: CalculatorInput) {
  const month = input.month ?? todayYmd().slice(0, 7);
  if (!MONTH_RE.test(month)) throw new AppError(`Invalid month "${month}"`, 400, 'INVALID_PERIOD');
  const year = Number(month.slice(0, 4));
  const drivers = await getDrivers(year);
  const aov = input.aov ?? (drivers.plannedAov.value === null ? null : Number(drivers.plannedAov.value));
  if (aov === null) throw new AppError('Set the planned AOV: no orders were delivered in the last 30 days', 400, 'AOV_REQUIRED');
  const conf = Money.div(input.confirmationRate ?? drivers.confirmationRate.value, 100);
  const success = Money.div(input.deliverySuccessRate ?? drivers.deliverySuccessRate.value, 100);
  assertRate(conf);
  assertRate(success);

  let revenueTarget = input.revenueTarget;
  if (revenueTarget === undefined) {
    const row = (await getTree(year)).months.find((m) => m.periodStart.slice(0, 7) === month);
    if (!row) throw new AppError(`No revenue target is set for ${month}`, 400, 'NO_MONTH_TARGET');
    revenueTarget = Number(row.value);
  }
  const days = daysInMonth(year, Number(month.slice(5)));
  const delivered = ordersDelivered(revenueTarget, aov);
  const takeIn = ordersToTakeIn(delivered, conf, success);

  let profit: Money.MoneyInput | null | undefined = input.profitPerOrder;
  if (profit === undefined) {
    const to = new Date();
    profit = (await topProductByDelivered(new Date(to.getTime() - 30 * 86_400_000), to))?.profitPerOrder ?? null;
  }
  return {
    month, daysInMonth: days, revenueTarget: Money.toApi(revenueTarget), plannedAov: Money.toApi(aov), plannedAovSource: input.aov !== undefined ? 'input' : drivers.plannedAov.source,
    confirmationRate: conf.mul(100).toNumber(), deliverySuccessRate: success.mul(100).toNumber(),
    ordersDelivered: delivered, ordersToTakeIn: takeIn, ordersPerDay: ordersPerDay(takeIn, days),
    maxCostPerOrder: profit === null ? null : maxCostPerOrder(profit, conf, success),
    profitPerOrder: profit === null ? null : Money.toApi(profit),
  };
}
