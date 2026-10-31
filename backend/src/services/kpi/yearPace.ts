/**
 * Year pace on the quarter plan (M6-T07, owner decision GATE 1). Not straight days: the owner planned the year in four
 * quarter targets (360k / 420k / 480k / 540k on "grow"), so the pace follows that plan.
 *
 *   expected year to date = sum of the quarters already gone + (days gone in this quarter / days in it) x this quarter's target
 *   pace (percent)        = expected year to date / annual target
 *
 * Quarter and month pace stay straight days inside their period (`paceMarker` in leadership.ts, which calls this for a year). Pure: no database.
 */
import * as Money from '../../utils/money';

export interface YearPaceInput {
  /** The four quarter targets, Q1 first (money). */
  quarterTargets: Money.MoneyInput[];
  /** 0 to 3: the quarter that holds the day. */
  quarterIndex: number;
  /** Days gone in the current quarter, today included (17 on 17 October). */
  daysGone: number;
  daysInQuarter: number;
  /** The annual target the percent is taken of. */
  annualTarget: Money.MoneyInput;
}

export interface YearPace {
  /** Expected year to date, money to 2 places. */
  expected: string;
  /** Expected / annual, percent to 1 decimal. Null when the annual target is 0. */
  percent: number | null;
}

export function yearPace({ quarterTargets, quarterIndex, daysGone, daysInQuarter, annualTarget }: YearPaceInput): YearPace {
  const closed = Money.sum(quarterTargets.slice(0, quarterIndex));
  const partial = Money.mul(Money.div(daysGone, daysInQuarter), quarterTargets[quarterIndex]);
  const expected = Money.add(closed, partial);
  const annual = Money.parse(annualTarget);
  return {
    expected: Money.toApi(Money.roundHalfUp(expected, 2)),
    percent: annual.gt(0) ? Money.roundHalfUp(Money.mul(Money.div(expected, annual), 100), 1).toNumber() : null,
  };
}
