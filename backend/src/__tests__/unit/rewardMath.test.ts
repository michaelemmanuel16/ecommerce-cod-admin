import { describe, it, expect } from '@jest/globals';
import { attainmentPercent, countDistance, displayPercent, rateDistance, tierReached } from '../../services/rewardMath';

describe('reward tier pick (F-1110)', () => {
  it.each([
    ['99.9', 'none'],
    ['100', '100'],
    ['119.9', '100'],
    ['120', '120'],
    ['250', '120'],
    ['0', 'none'],
  ])('%s percent earns tier %s', (percent, tier) => {
    expect(tierReached(percent)).toBe(tier);
  });

  it('no target gives no tier', () => {
    expect(attainmentPercent(5, 0)).toBeNull();
    expect(tierReached(null)).toBe('none');
  });

  it('is decided on the exact percent, not the rounded one', () => {
    const p = attainmentPercent(999, 1000)!; // 99.9
    expect(tierReached(p)).toBe('none');
    const almost = attainmentPercent('99.96', 100)!;
    expect(tierReached(almost)).toBe('none');
    expect(displayPercent(almost)).toBe(99.9); // cut down, never "100.0" without the tier
  });

  it('reaches 100 and 120 exactly on whole and fractional targets', () => {
    expect(tierReached(attainmentPercent(423, 423))).toBe('100');
    expect(tierReached(attainmentPercent(36, 30))).toBe('120');
    expect(tierReached(attainmentPercent(35, 30))).toBe('100');
  });
});

describe('distance for a count target (F-1108)', () => {
  it('counts the orders still needed for 100 and for 120 percent', () => {
    expect(countDistance(253, 423)).toEqual({ to100: 170, to120: 255 }); // 507.6 rounds up to 508
  });

  it('rounds up and stops at zero', () => {
    expect(countDistance(9, 10)).toEqual({ to100: 1, to120: 3 });
    expect(countDistance(10, 10)).toEqual({ to100: 0, to120: 2 });
    expect(countDistance(30, 10)).toEqual({ to100: 0, to120: 0 });
    expect(countDistance(0, 2.5)).toEqual({ to100: 3, to120: 3 });
  });
});

describe('distance for the delivery success rate (F-1108)', () => {
  it('counts deliveries with no failure to reach the rate', () => {
    // 3 delivered of 5 closed is 60 percent. 72 percent needs 3 more: 6 of 8 is 75, 5 of 7 is 71.4.
    expect(rateDistance(3, 5, 60, 120)).toBe(3);
    // 2 of 5 is 40. 60 percent needs 3 more: 5 of 8 is 62.5, 4 of 7 is 57.
    expect(rateDistance(2, 5, 60, 100)).toBe(3);
  });

  it('is zero when the rate is already there', () => {
    expect(rateDistance(3, 5, 60, 100)).toBe(0);
    expect(rateDistance(5, 5, 60, 120)).toBe(0);
  });

  it('one delivery is enough when nothing is closed yet', () => {
    expect(rateDistance(0, 0, 60, 100)).toBe(1);
  });

  it('is null when the rate cannot be reached: above 100 percent, or 100 percent with a failure on record', () => {
    expect(rateDistance(4, 4, 90, 120)).toBeNull();
    expect(rateDistance(4, 5, 100, 100)).toBeNull();
  });
});
