/** M6-T07: year pace on the quarter plan (owner decision GATE 1). */
import { describe, it, expect } from '@jest/globals';
import { yearPace } from '../../services/kpi/yearPace';
import { paceChip } from '../../services/kpi/status';

const GROW = [360_000, 420_000, 480_000, 540_000];

describe('yearPace', () => {
  it('17 Oct fixture: 1,260,000 + 17/92 x 540,000 = 1,359,783 = 75.5%', () => {
    const r = yearPace({ quarterTargets: GROW, quarterIndex: 3, daysGone: 17, daysInQuarter: 92, annualTarget: 1_800_000 });
    expect(Math.round(Number(r.expected))).toBe(1_359_783);
    expect(r.percent).toBe(75.5);
  });

  it('done 76.7% reads "1 pt ahead" against that pace', () => {
    const r = yearPace({ quarterTargets: GROW, quarterIndex: 3, daysGone: 17, daysInQuarter: 92, annualTarget: 1_800_000 });
    expect(paceChip(76.7, r.percent as number)).toEqual({ points: 1, tag: 'ahead' });
  });

  it('first day of the year: 1/90 of Q1 only', () => {
    const r = yearPace({ quarterTargets: GROW, quarterIndex: 0, daysGone: 1, daysInQuarter: 90, annualTarget: 1_800_000 });
    expect(r.percent).toBe(0.2);
  });

  it('last day of the year: 100%', () => {
    const r = yearPace({ quarterTargets: GROW, quarterIndex: 3, daysGone: 92, daysInQuarter: 92, annualTarget: 1_800_000 });
    expect(r).toEqual({ expected: '1800000.00', percent: 100 });
  });

  it('annual target 0 gives no percent', () => {
    expect(yearPace({ quarterTargets: [0, 0, 0, 0], quarterIndex: 1, daysGone: 5, daysInQuarter: 91, annualTarget: 0 }).percent).toBeNull();
  });
});
