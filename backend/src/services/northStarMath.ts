import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { assertSum } from './targetService';

/**
 * M6-T08 (F-1112, F-1113): the North Star arithmetic. Pure: no database. Money is Decimal; rates are fractions (0.70).
 *
 * Rounding rules, fixed by the fixture (annual 1,800,000, October 180,000, AOV 249, 70% x 60%):
 *  - orders delivered = target / AOV, rounded UP            (722.89 -> 723)
 *  - orders to take in = delivered / (confirm x success), rounded to the NEAREST  (723 / 0.42 = 1721.43 -> 1,721; rounding up would give 1,722)
 *  - orders a day = take-in / real days in the month, rounded UP   (1,721 / 31 = 55.5 -> 56; / 30 = 57.4 -> 58, as F-1113 says)
 *  - max cost per order = profit per delivered order x confirm x success, to 2 places
 *  - money splits are to 2 places; the last part takes the remainder, so parts always add up exactly.
 */

export type GrowthMode = 'even' | 'grow' | 'custom';

const RATE_INVALID = () => new AppError('A rate must be more than 0 and not more than 1 (100%)', 400, 'RATE_INVALID');

export function assertRate(rate: Money.MoneyInput): Money.Money {
  const r = Money.tryParse(rate);
  if (r === null || r.lte(0) || r.gt(1)) throw RATE_INVALID();
  return r;
}

/** `total` cut into parts in the given proportions (2 places); the last part takes the rounding remainder. */
function share(total: Money.Money, weights: Money.Money[]): Money.Money[] {
  const sum = Money.sum(weights);
  const parts: Money.Money[] = [];
  let given = Money.ZERO;
  weights.forEach((w, i) => {
    const part = i === weights.length - 1 ? Money.sub(total, given) : Money.roundHalfUp(sum.isZero() ? Money.div(total, weights.length) : Money.mul(total, Money.div(w, sum)), 2);
    parts.push(part);
    given = Money.add(given, part);
  });
  return parts;
}

/** The four quarter targets before any past quarter is fixed. grow: annual / 4 + (i - 1.5) x annual / 30 (360/420/480/540k on 1.8M). */
export function quarterSplit(annual: Money.MoneyInput, mode: GrowthMode, custom?: Money.MoneyInput[]): Money.Money[] {
  const total = Money.parse(annual);
  if (total.lte(0)) throw new AppError('The North Star must be more than 0', 400);
  if (mode === 'custom') {
    if (!custom || custom.length !== 4) throw new AppError('Custom mode needs four quarter values', 400);
    const parts = custom.map((c) => {
      const v = Money.tryParse(c);
      if (v === null || v.lt(0)) throw new AppError('A quarter value must be a number of 0 or more', 400);
      return v;
    });
    assertSum('north_star', Money.sum(parts), total);
    return parts;
  }
  const weights = [0, 1, 2, 3].map((i) => (mode === 'even' ? Money.parse(1) : Money.add(Money.div(total, 4), Money.mul(Money.sub(i, 1.5), Money.div(total, 30)))));
  return share(total, weights);
}

/**
 * The open slots take what is left of `total` after the fixed ones, in the proportions of `weights`. With every slot fixed, the
 * fixed values must add up to `total`; with too much fixed, the difference is in the error.
 */
function fillOpen(parentScope: 'north_star' | 'quarter', total: Money.Money, fixed: Array<Money.Money | null>, weights: Money.Money[]): Money.Money[] {
  const kept = Money.sum(fixed.filter((f): f is Money.Money => f !== null));
  const open = fixed.map((f, i) => (f === null ? i : -1)).filter((i) => i >= 0);
  const left = Money.sub(total, kept);
  if (open.length === 0 || left.lt(0)) assertSum(parentScope, kept, total);
  const parts = share(left, open.map((i) => weights[i]));
  return fixed.map((f, i) => f ?? parts[open.indexOf(i)]);
}

/**
 * Quarters for a re-plan. A quarter in `fixed` (every month past or closed) keeps its value; the rest take what is left of the
 * annual figure in the proportions of the chosen mode. With nothing fixed this is `quarterSplit`.
 */
export function planQuarters(annual: Money.MoneyInput, mode: GrowthMode, custom: Money.MoneyInput[] | undefined, fixed: Array<Money.Money | null>): Money.Money[] {
  const wanted = quarterSplit(annual, mode, custom);
  return fixed.every((f) => f === null) ? wanted : fillOpen('north_star', Money.parse(annual), fixed, wanted);
}

/** The three months of a quarter. A month in `fixed` (past or closed) keeps its value; the open months share the rest evenly. */
export function monthSplit(quarter: Money.MoneyInput, fixed: Array<Money.Money | null>): Money.Money[] {
  return fillOpen('quarter', Money.parse(quarter), fixed, fixed.map(() => Money.parse(1)));
}

const positive = (v: Money.MoneyInput, what: string): Money.Money => {
  const n = Money.tryParse(v);
  if (n === null || n.lte(0)) throw new AppError(`${what} must be more than 0`, 400);
  return n;
};

/** Orders that must be delivered to reach a revenue target, rounded up. */
export const ordersDelivered = (revenueTarget: Money.MoneyInput, aov: Money.MoneyInput): number =>
  Money.div(positive(revenueTarget, 'The revenue target'), positive(aov, 'The planned AOV')).ceil().toNumber();

/** Orders to take in so that enough are delivered: delivered / (confirmation x delivery success), to the nearest whole order. */
export const ordersToTakeIn = (delivered: number, confirmationRate: Money.MoneyInput, deliverySuccessRate: Money.MoneyInput): number =>
  Money.roundHalfUp(Money.div(delivered, Money.mul(assertRate(confirmationRate), assertRate(deliverySuccessRate))), 0).toNumber();

/** Orders to take in a day over the real days of the month, rounded up. */
export const ordersPerDay = (takeIn: number, daysInMonth: number): number => Money.div(takeIn, daysInMonth).ceil().toNumber();

/** The most to pay for one order taken in: profit per delivered order before ads x planned yield (confirmation x delivery). */
export const maxCostPerOrder = (profitPerDelivered: Money.MoneyInput, confirmationRate: Money.MoneyInput, deliverySuccessRate: Money.MoneyInput): string =>
  Money.toApi(Money.mul(Money.parse(profitPerDelivered), Money.mul(assertRate(confirmationRate), assertRate(deliverySuccessRate))));
