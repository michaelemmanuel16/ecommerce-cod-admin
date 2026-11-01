import { describe, it, expect } from '@jest/globals';
import * as Money from '../../utils/money';
import {
  averageDaysToPay, beatTargetBy20, contractReviewFlag, daysByMonth, hitTargetStreak, periodNote, rankByPercent, topOfMonth, windowTarget,
} from '../../services/leaderboardMath';
import { resolvePeriod } from '../../services/leaderboardService';

const m = (v: string | number) => Money.parse(v);

describe('rankByPercent (F-1104)', () => {
  it('ranks by percent, ties share a rank and the next one skips (1, 1, 3)', () => {
    const ranks = rankByPercent([
      { id: 'a', percent: 60 }, { id: 'b', percent: 73.5 }, { id: 'c', percent: 60 }, { id: 'd', percent: 26 }, { id: 'e', percent: 73.5 },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ b: 1, e: 1, a: 3, c: 3, d: 5 });
  });

  it('a person with no target is not ranked and does not take a place', () => {
    const ranks = rankByPercent([{ id: 'x', percent: null }, { id: 'y', percent: 10 }, { id: 'z', percent: 5 }]);
    expect(Object.fromEntries(ranks)).toEqual({ x: null, y: 1, z: 2 });
  });

  it('ranks by percent of own target, not by raw count: a small target beats a big count', () => {
    // 60 of 100 = 60 percent; 130 of 300 = 43.3 percent
    const pct = (actual: number, target: number) => Number(m(actual).mul(100).div(target).toDecimalPlaces(1, 1));
    const ranks = rankByPercent([{ id: 'big', percent: pct(130, 300) }, { id: 'small', percent: pct(60, 100) }]);
    expect(ranks.get('small')).toBe(1);
    expect(ranks.get('big')).toBe(2);
  });

  it('an empty list ranks nothing', () => {
    expect(rankByPercent([]).size).toBe(0);
  });
});

describe('window target (F-1107)', () => {
  it('daysByMonth counts the days of a window per month', () => {
    expect(Object.fromEntries(daysByMonth('2026-10-26', '2026-11-01'))).toEqual({ '2026-10': 6, '2026-11': 1 });
    expect(Object.fromEntries(daysByMonth('2026-10-17', '2026-10-17'))).toEqual({ '2026-10': 1 });
  });

  it('a count target is the share of the month the window covers; a month is the whole target', () => {
    const month = new Map([['2026-10', '620']]);
    expect(windowTarget('count', month, daysByMonth('2026-10-01', '2026-10-31'))!.toString()).toBe('620');
    expect(windowTarget('count', month, daysByMonth('2026-10-12', '2026-10-18'))!.toString()).toBe('140'); // 620 / 31 x 7
    expect(windowTarget('count', month, daysByMonth('2026-10-17', '2026-10-17'))!.toString()).toBe('20');
  });

  it('a week across two months takes each month by its days; a month with no target adds nothing', () => {
    const both = new Map([['2026-10', '310'], ['2026-11', '300']]);
    expect(windowTarget('count', both, daysByMonth('2026-10-26', '2026-11-01'))!.toString()).toBe('70'); // 6 x 10 + 1 x 10
    expect(windowTarget('count', new Map([['2026-10', '310']]), daysByMonth('2026-10-26', '2026-11-01'))!.toString()).toBe('60');
    expect(windowTarget('count', new Map(), daysByMonth('2026-10-26', '2026-11-01'))).toBeNull();
  });

  it('a year is the sum of its months', () => {
    const months = new Map(Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, '0')}`, '100'] as const));
    expect(windowTarget('count', months, daysByMonth('2026-01-01', '2026-12-31'))!.toString()).toBe('1200');
  });

  it('a success-rate target does not scale: it stays the rate, weighted by days across months', () => {
    expect(windowTarget('rate', new Map([['2026-10', '60']]), daysByMonth('2026-10-12', '2026-10-18'))!.toString()).toBe('60');
    expect(windowTarget('rate', new Map([['2026-10', '60'], ['2026-11', '70']]), daysByMonth('2026-10-31', '2026-11-03'))!.toString()).toBe('67.5');
  });
});

describe('period select (F-1107)', () => {
  const now = new Date('2026-10-17T10:00:00Z'); // a Saturday, Accra = UTC
  const zone = 'Africa/Accra';

  it('today, week, month and year follow the store calendar; October follows the current month name', () => {
    expect(resolvePeriod('today', zone, now)).toMatchObject({ kind: 'today', label: 'Today', first: '2026-10-17', last: '2026-10-17' });
    expect(resolvePeriod('week', zone, now)).toMatchObject({ kind: 'week', first: '2026-10-12', last: '2026-10-18' });
    expect(resolvePeriod('month', zone, now)).toMatchObject({ kind: 'month', label: 'October', month: '2026-10', first: '2026-10-01', last: '2026-10-31' });
    expect(resolvePeriod('year', zone, now)).toMatchObject({ kind: 'year', label: '2026', first: '2026-01-01', last: '2026-12-31', month: null });
  });

  it('a past month is YYYY-MM with the year in its label; anything else is refused', () => {
    expect(resolvePeriod('2026-09', zone, now)).toMatchObject({ kind: 'month', label: 'September 2026', month: '2026-09', last: '2026-09-30' });
    expect(() => resolvePeriod('2026-13', zone, now)).toThrow(/Period must be/);
    expect(() => resolvePeriod('yesterday', zone, now)).toThrow(/Period must be/);
  });
});

describe('notes and flags', () => {
  it('a day or week with little or no data carries a note; a month or year never does', () => {
    expect(periodNote('today', 0)).toMatch(/No orders/);
    expect(periodNote('week', 3)).toMatch(/Early in this period/);
    expect(periodNote('today', 40)).toBeNull();
    expect(periodNote('month', 0)).toBeNull();
    expect(periodNote('year', 1)).toBeNull();
  });

  it('only a company below 80 percent of its target is flagged for contract review', () => {
    expect(contractReviewFlag('company', 75)).toBe('contract_review');
    expect(contractReviewFlag('company', 79.9)).toBe('contract_review');
    expect(contractReviewFlag('company', 80)).toBeNull();
    expect(contractReviewFlag('person', 40)).toBeNull();
    expect(contractReviewFlag('company', null)).toBeNull();
  });

  it('days to pay is the average of the gaps in days, one decimal', () => {
    const day = 86_400_000;
    expect(averageDaysToPay([2 * day, 3 * day])).toBe(2.5);
    expect(averageDaysToPay([-day, 2 * day])).toBe(1);
    expect(averageDaysToPay([])).toBeNull();
  });
});

describe('badge rules (F-1109)', () => {
  it('Top of month: every tied rank 1 gets it; nobody at 0 percent or unranked does', () => {
    expect(topOfMonth([
      { userId: 1, rank: 1, percent: m(80) }, { userId: 2, rank: 1, percent: m(80) }, { userId: 3, rank: 3, percent: m(50) }, { userId: 4, rank: null, percent: null },
    ])).toEqual([1, 2]);
    expect(topOfMonth([{ userId: 1, rank: 1, percent: m(0) }])).toEqual([]);
    expect(topOfMonth([])).toEqual([]);
  });

  it('Hit target 3 months running: this month and the two before, each at 100 or more', () => {
    expect(hitTargetStreak(m(100), [m(105), m(130)])).toBe(true);
    expect(hitTargetStreak(m('99.99'), [m(105), m(130)])).toBe(false);
    expect(hitTargetStreak(m(100), [m(95), m(130)])).toBe(false);
    expect(hitTargetStreak(m(100), [null, m(130)])).toBe(false);
    expect(hitTargetStreak(m(100), [m(130)])).toBe(false); // only two months of history
  });

  it('Beat target by 20 percent: 120 or more', () => {
    expect(beatTargetBy20(m(120))).toBe(true);
    expect(beatTargetBy20(m('119.99'))).toBe(false);
    expect(beatTargetBy20(null)).toBe(false);
  });
});
