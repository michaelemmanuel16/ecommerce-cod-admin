/**
 * Leadership numbers (M1-T19, F-253, F-205): pace, projection, orders needed a day, planned AOV, target
 * attainment and the delivery-success lever. They read revenue from revenue.ts, rates from rates.ts and
 * targets from `Target`.
 *
 * All dates are store-zone calendar days. `asOf` is a day 'YYYY-MM-DD'; "so far" runs to the END of that day.
 * `daysGone` = the day of the month (17 on 17 October), so today counts as a day gone.
 *
 *  - Pace marker      = days gone / days in the period, for month, quarter and year. Straight days (F-202; the owner
 *                       confirms "straight days or stepped plan" at T38). Year on 17 Oct 2026: 290 / 365 = 79.5%.
 *  - Projected month  = revenue so far / days gone x days in the month. Projected percent = projected / month target.
 *  - Needed a day     = (month target - revenue so far) / (days in month - days gone). 0 when the target is hit.
 *                       Null when there is no month target or no day is left.
 *  - Orders needed    = month target / planned AOV / (confirmation target x success target) / REAL days in the month
 *                       (R2: October 31, September 30, February 28 or 29; never a flat 30). Rounded half up to a whole
 *                       order; the unrounded figure is in `detail.exact`.
 *  - Planned AOV      = a `planned_aov` Target covering asOf (source 'manual'), else the delivered AOV of the last 30
 *                       store days ending asOf (R12, source 'auto'): delivered revenue / delivered orders, rounded
 *                       half up to the whole currency unit (GH 244.68 -> 245; unrounded, the fixture's October
 *                       needs 56.50 orders a day, which rounds the wrong way).
 *  - Attainment       = delivered revenue in the period / the period's `revenue` target.
 *  - lever()          = F-205: the rate with the largest gap under its target, and what +5 points of it is worth this
 *                       month at today's pace (see lever()).
 *
 * Targets (`Target` rows with no role and no person): metric `revenue` for scope month, quarter and north_star (the
 * year), matched on the period start; metrics `confirmation_rate` and `delivery_success_rate` (percent) and
 * `planned_aov` (money) matched on the period that covers asOf, newest first. Defaults when no row: 70 and 60.
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { getCurrency } from '../../utils/currency';
import { Prisma } from '@prisma/client';
import { addDays, DAY_MS, daysInMonth, endOfDay, getStoreTimeZone, localDate, monthRange, parseYmd } from './dates';
import { deliveredRevenue, revenueScope } from './revenue';
import { rates, ratePercent } from './rates';
import { kpiMeta, type KpiResult } from './types';

const DEFAULT_CONFIRMATION_TARGET = 70;
export const DEFAULT_SUCCESS_TARGET = 60;
/** The lever asks "what is +5 points of this rate worth". */
const LEVER_POINTS = 5;
/** Days of delivered orders behind the default planned AOV (R12). */
const PLANNED_AOV_DAYS = 30;

export type Period = 'month' | 'quarter' | 'year';

/** The calendar period a tenant-wide target stands for (a north star is the year); null for any other scope. */
const PERIOD_OF_SCOPE: Record<string, Period> = { month: 'month', quarter: 'quarter', north_star: 'year' };
export const periodOfTarget = (target: { scope: string }): Period | null => PERIOD_OF_SCOPE[target.scope] ?? null;

export interface Attainment extends KpiResult<number | null> {
  period: Period;
  /** Delivered revenue in the period up to the end of asOf (money string). */
  actual: string;
  /** Period revenue target (money string), null when none is set. */
  target: string | null;
  /** Pace marker of the period, percent. */
  pace: number;
}

export interface PlannedAov extends KpiResult<string | null> {
  source: 'auto' | 'manual';
}

export type LeverRate = 'deliverySuccessRate' | 'confirmationRate';

export interface Lever extends KpiResult<string | null> {
  /** The rate with the largest gap to its target; null when no rate is under its target. */
  rate: LeverRate | null;
  points: number;
}

export interface Leadership {
  /** The asOf day, 'YYYY-MM-DD' in the store zone. */
  asOfDate: string;
  daysGone: number;
  daysInMonth: number;
  pace: Record<Period, KpiResult<number>>;
  revenueSoFar: KpiResult<string>;
  projectedMonth: KpiResult<string>;
  /** Projected month / month target, percent. Null when there is no month target. */
  projectedPercent: KpiResult<number | null>;
  neededPerDay: KpiResult<string | null>;
  ordersNeededPerDay: KpiResult<number | null>;
  plannedAov: PlannedAov;
  attainment: Record<Period, Attainment>;
  lever: Lever;
}

export interface LeadershipOptions {
  /** Role scope: only this rep's or this partner's orders (see revenue.ts, rates.ts). */
  scope?: { repId?: number; partnerId?: number };
}

interface Ymd { year: number; month: number; day: number }

const utcDay = ({ year, month, day }: Ymd) => Date.UTC(year, month - 1, day);

/** Calendar parts of a period containing asOf: [startYear, startMonth] and the number of months. */
function periodSpan(day: Ymd, period: Period): { startMonth: number; months: number } {
  if (period === 'month') return { startMonth: day.month, months: 1 };
  if (period === 'quarter') return { startMonth: Math.floor((day.month - 1) / 3) * 3 + 1, months: 3 };
  return { startMonth: 1, months: 12 };
}

/** Pace marker, percent to 1 decimal: days gone in the period / days in the period (straight days). */
export function paceMarker(day: Ymd, period: Period): { percent: number; daysGone: number; daysInPeriod: number } {
  const { startMonth, months } = periodSpan(day, period);
  let daysInPeriod = 0;
  for (let m = startMonth; m < startMonth + months; m++) daysInPeriod += daysInMonth(day.year, m);
  const daysGone = Math.round((utcDay(day) - Date.UTC(day.year, startMonth - 1, 1)) / DAY_MS) + 1;
  return { percent: ratePercent(daysGone, daysInPeriod) as number, daysGone, daysInPeriod };
}

const dayStart = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));

/** The tenant-wide target of `metric` whose period covers `day`: the latest period start, then the newest row. */
export const coveringTarget = (tenantId: string, metric: string, day: Date) =>
  prisma.target.findFirst({
    where: { tenantId, roleId: null, userId: null, metric, periodStart: { lte: day }, periodEnd: { gte: day } },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
  });

export async function leadership(tenantId: string, asOf?: string, options: LeadershipOptions = {}): Promise<Leadership> {
  const zone = getStoreTimeZone(tenantId);
  const asOfDate = asOf ?? localDate(new Date(), zone);
  const day = parseYmd(asOfDate);
  const computedAt = new Date().toISOString();
  const revScope = revenueScope(options.scope ?? {});

  const spans = (['month', 'quarter', 'year'] as Period[]).map((period) => {
    const { startMonth, months } = periodSpan(day, period);
    return { period, startMonth, months, from: monthRange(day.year, startMonth, zone).from, pace: paceMarker(day, period) };
  });
  const to = endOfDay(asOfDate, zone);
  const month = spans[0];
  const { daysGone, daysInPeriod: monthDays } = month.pace;

  const thirtyDaysFrom = addDays(to, -PLANNED_AOV_DAYS);

  return runInTenant(tenantId, async () => {
    const asOfDay = new Date(utcDay(day));
    const targetBase = { tenantId, roleId: null, userId: null };
    const periodRevenueTarget = (scope: 'month' | 'quarter' | 'north_star', startMonth: number) =>
      prisma.target.findFirst({
        where: { ...targetBase, scope, metric: 'revenue', periodStart: dayStart(day.year, startMonth) },
        orderBy: { createdAt: 'desc' },
      });

    const [currency, quarterTarget, monthTarget, yearTarget, confTarget, successTarget, aovTarget,
      monthRevenue, quarterRevenue, yearRevenue, aovWindow, monthRates] = await Promise.all([
      getCurrency(),
      periodRevenueTarget('quarter', spans[1].startMonth),
      periodRevenueTarget('month', month.startMonth),
      periodRevenueTarget('north_star', 1),
      coveringTarget(tenantId, 'confirmation_rate', asOfDay),
      coveringTarget(tenantId, 'delivery_success_rate', asOfDay),
      coveringTarget(tenantId, 'planned_aov', asOfDay),
      deliveredRevenue(tenantId, month.from, to, revScope),
      deliveredRevenue(tenantId, spans[1].from, to, revScope),
      deliveredRevenue(tenantId, spans[2].from, to, revScope),
      deliveredRevenue(tenantId, thirtyDaysFrom, to, revScope),
      rates(tenantId, month.from, to, { basis: 'cohort', repId: options.scope?.repId, partnerId: options.scope?.partnerId }),
    ]);

    const meta = (basis: KpiResult<unknown>['dateBasis'], from: Date, formulaId: string) =>
      kpiMeta(from, to, { dateBasis: basis, formulaId, asOf: computedAt });
    const money = (target: { value: Prisma.Decimal } | null) => (target ? Money.toApi(target.value) : null);

    const confTargetPct = confTarget ? Money.parse(confTarget.value).toNumber() : DEFAULT_CONFIRMATION_TARGET;
    const successTargetPct = successTarget ? Money.parse(successTarget.value).toNumber() : DEFAULT_SUCCESS_TARGET;

    // Pace
    const paceResult = (s: (typeof spans)[number]): KpiResult<number> => ({
      name: `Pace marker, ${s.period}`, value: s.pace.percent, unit: 'percent',
      ...meta('deliveryDate', s.from, `leadership.pace.${s.period}.v1`),
      detail: { daysGone: s.pace.daysGone, daysInPeriod: s.pace.daysInPeriod },
    });
    const pace: Leadership['pace'] = { month: paceResult(spans[0]), quarter: paceResult(spans[1]), year: paceResult(spans[2]) };

    // Revenue so far, projection, needed a day
    const soFar = Money.parse(monthRevenue.total.value);
    const projected = Money.mul(Money.div(soFar, daysGone), monthDays);
    const monthTargetValue = monthTarget ? Money.parse(monthTarget.value) : null;
    const hasTarget = monthTargetValue !== null && monthTargetValue.gt(0);
    const daysLeft = monthDays - daysGone;
    const neededPerDay = hasTarget && daysLeft > 0
      ? Money.toApi(Money.roundHalfUp(Money.div(Prisma.Decimal.max(Money.sub(monthTargetValue, soFar), 0), daysLeft), 2))
      : null;

    // Planned AOV
    const aovDelivered = aovWindow.deliveredOrders.value;
    const aovAuto = aovDelivered > 0
      ? Money.roundHalfUp(Money.div(aovWindow.total.value, aovDelivered), 0)
      : null;
    const aovManual = aovTarget && Money.parse(aovTarget.value).gt(0) ? Money.parse(aovTarget.value) : null;
    const plannedAovValue = aovManual ?? aovAuto;
    const plannedAov: PlannedAov = {
      name: 'Planned AOV', value: plannedAovValue ? Money.toApi(plannedAovValue) : null, unit: 'money', currency,
      source: aovManual ? 'manual' : 'auto',
      ...meta('deliveryDate', thirtyDaysFrom, 'leadership.plannedAov.v1'),
      detail: { deliveredOrders: aovDelivered },
    };

    // Orders needed a day: real days in the month (R2).
    let ordersNeeded: number | null = null;
    let exact: number | null = null;
    if (hasTarget && plannedAovValue && confTargetPct > 0 && successTargetPct > 0) {
      const yieldTarget = Money.mul(Money.div(confTargetPct, 100), Money.div(successTargetPct, 100));
      const perDay = Money.div(Money.div(Money.div(monthTargetValue, plannedAovValue), yieldTarget), monthDays);
      exact = Money.roundHalfUp(perDay, 2).toNumber();
      ordersNeeded = Money.roundHalfUp(perDay, 0).toNumber();
    }

    // Attainment
    const attain = (s: (typeof spans)[number], revenue: typeof monthRevenue, target: { value: Prisma.Decimal } | null): Attainment => {
      const t = target ? Money.parse(target.value) : null;
      return {
        name: `Target attainment, ${s.period}`,
        value: t && t.gt(0) ? ratePercent(Money.parse(revenue.total.value).toNumber(), t.toNumber()) : null,
        unit: 'percent', period: s.period, actual: revenue.total.value, target: money(target), pace: s.pace.percent,
        ...meta('deliveryDate', s.from, 'leadership.attainment.v1'),
      };
    };

    const projectedValue = Money.toApi(projected);
    const projectedPercent = hasTarget ? ratePercent(projected.toNumber(), monthTargetValue.toNumber()) : null;

    return {
      asOfDate,
      daysGone,
      daysInMonth: monthDays,
      pace,
      revenueSoFar: {
        name: 'Delivered revenue so far', value: monthRevenue.total.value, unit: 'money', currency,
        ...meta('deliveryDate', month.from, 'revenue.delivered.v1'),
      },
      projectedMonth: {
        name: 'Projected month', value: projectedValue, unit: 'money', currency,
        ...meta('deliveryDate', month.from, 'leadership.projectedMonth.v1'),
        detail: { daysGone, daysInMonth: monthDays },
      },
      projectedPercent: {
        name: 'Projected month, percent of target', value: projectedPercent, unit: 'percent',
        ...meta('deliveryDate', month.from, 'leadership.projectedPercent.v1'),
      },
      neededPerDay: {
        name: 'Needed a day', value: neededPerDay, unit: 'money', currency,
        ...meta('deliveryDate', month.from, 'leadership.neededPerDay.v1'),
        detail: { daysLeft },
      },
      ordersNeededPerDay: {
        name: 'Orders needed a day', value: ordersNeeded, unit: 'count',
        ...meta('deliveryDate', month.from, 'leadership.ordersNeededPerDay.v1'),
        detail: {
          daysInMonth: monthDays, confirmationTarget: confTargetPct, successTarget: successTargetPct,
          ...(exact !== null ? { exact } : {}),
        },
      },
      plannedAov,
      attainment: {
        month: attain(month, monthRevenue, monthTarget),
        quarter: attain(spans[1], quarterRevenue, quarterTarget),
        year: attain(spans[2], yearRevenue, yearTarget),
      },
      lever: {
        ...lever({
          confirmed: monthRates.confirmationRate.detail?.confirmed ?? 0,
          placed: monthRates.confirmationRate.detail?.placed ?? 0,
          daysGone, daysInMonth: monthDays,
          successRate: monthRates.deliverySuccessRate.value,
          confirmationTarget: confTargetPct, successTarget: successTargetPct,
          aov: plannedAov.value,
        }),
        currency,
        ...meta('cohort', month.from, 'leadership.lever.v1'),
      },
    };
  });
}

export interface LeverInput {
  /** Orders confirmed and placed so far this month (cohort basis, by order date). */
  confirmed: number;
  placed: number;
  daysGone: number;
  daysInMonth: number;
  /** Delivery success rate, percent, null when there is no data. */
  successRate: number | null;
  confirmationTarget: number;
  successTarget: number;
  /** Planned AOV (money string), null when unknown. */
  aov: string | null;
}

/**
 * Biggest lever (F-205). The rate with the largest gap UNDER its target (confirmation or delivery success; a rate at
 * or above target has no gap). The value is what +5 points of that rate is worth this month at today's pace:
 *   delivery success:  projected confirmed orders x 5 points x AOV
 *                      (fixture: 1,026 / 17 x 31 = 1,871 confirmed x 0.05 x 245 = GH 22.9k)
 *   confirmation:      projected placed orders x 5 points x delivery success rate x AOV
 * Projected = so far / days gone x days in month. GUESS (F-205 says the exact formula is not written anywhere): the
 * owner confirms. A tie goes to delivery success (the fulfilment lever). Null value when there is no rate under
 * target, no AOV, no data, or no day gone.
 */
export function lever(input: LeverInput): Pick<Lever, 'name' | 'value' | 'unit' | 'rate' | 'points' | 'detail'> {
  const confirmationRate = ratePercent(input.confirmed, input.placed);
  const gaps: Array<[LeverRate, number]> = [];
  if (input.successRate !== null) gaps.push(['deliverySuccessRate', input.successTarget - input.successRate]);
  if (confirmationRate !== null) gaps.push(['confirmationRate', input.confirmationTarget - confirmationRate]);
  const under = gaps.filter(([, gap]) => gap > 0).sort((a, b) => b[1] - a[1]);
  const none = { name: 'Biggest lever', value: null, unit: 'money' as const, rate: null, points: LEVER_POINTS };
  if (under.length === 0 || input.aov === null || input.daysGone <= 0) return none;

  const [rate, gap] = under[0];
  const step = Money.div(LEVER_POINTS, 100);
  const projectedConfirmed = Money.mul(Money.div(input.confirmed, input.daysGone), input.daysInMonth);
  const projectedPlaced = Money.mul(Money.div(input.placed, input.daysGone), input.daysInMonth);
  const value = rate === 'deliverySuccessRate'
    ? Money.mul(Money.mul(projectedConfirmed, step), input.aov)
    : Money.mul(Money.mul(Money.mul(projectedPlaced, step), Money.div(input.successRate ?? 0, 100)), input.aov);
  return {
    ...none,
    value: Money.toApi(value),
    rate,
    detail: { gapPoints: Money.roundHalfUp(gap, 1).toNumber(), projectedConfirmed: Money.roundHalfUp(projectedConfirmed, 0).toNumber() },
  };
}
