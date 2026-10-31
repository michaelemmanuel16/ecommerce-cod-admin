import { describe, it, expect } from '@jest/globals';
import { attainmentPercent, countDistance, displayPercent, nextTier, rateDistance, rewardMessage, tierReached } from '../../services/rewardMath';

describe('reward tier pick (F-1110)', () => {
  it.each([
    ['99.9', null],
    ['100', 100],
    ['119.9', 100],
    ['120', 120],
    ['250', 120],
    ['0', null],
  ])('%s percent earns tier %s', (percent, tier) => {
    expect(tierReached(percent)).toBe(tier);
  });

  it('no target gives no tier', () => {
    expect(attainmentPercent(5, 0)).toBeNull();
    expect(tierReached(null)).toBeNull();
  });

  it('is decided on the exact percent, not the rounded one', () => {
    const p = attainmentPercent(999, 1000)!; // 99.9
    expect(tierReached(p)).toBeNull();
    const almost = attainmentPercent('99.96', 100)!;
    expect(tierReached(almost)).toBeNull();
    expect(displayPercent(almost)).toBe(99.9); // cut down, never "100.0" without the tier
  });

  it('reaches 100 and 120 exactly on whole and fractional targets', () => {
    expect(tierReached(attainmentPercent(423, 423))).toBe(100);
    expect(tierReached(attainmentPercent(36, 30))).toBe(120);
    expect(tierReached(attainmentPercent(35, 30))).toBe(100);
  });
});

describe('distance for a count target (F-1108)', () => {
  it('counts the orders still needed for 100 and for 120 percent', () => {
    expect(countDistance(253, 423)).toEqual({ 100: 170, 120: 255 }); // 507.6 rounds up to 508
  });

  it('rounds up and stops at zero', () => {
    expect(countDistance(9, 10)).toEqual({ 100: 1, 120: 3 });
    expect(countDistance(10, 10)).toEqual({ 100: 0, 120: 2 });
    expect(countDistance(30, 10)).toEqual({ 100: 0, 120: 0 });
    expect(countDistance(0, 2.5)).toEqual({ 100: 3, 120: 3 });
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

describe('next tier', () => {
  it('goes none, 100, 120, then nothing', () => {
    expect([nextTier(null), nextTier(100), nextTier(120)]).toEqual([100, 120, null]);
  });
});

describe('reward message (F-1108, F-1110)', () => {
  const base = { reward: null, distance: null, closed: false, human: true, percent: 90 };
  const reward = { amount: 'GH₵500', dayOff: true };

  it('no tier shows the distance, or a plain line without one', () => {
    expect(rewardMessage({ ...base, tier: null, distance: '1 more confirmed orders to reach 100%' })).toBe('1 more confirmed orders to reach 100%');
    expect(rewardMessage({ ...base, tier: null })).toBe('No tier reached yet');
  });

  it('an open month says On track, with the day off and the month close tail', () => {
    expect(rewardMessage({ ...base, tier: 100, reward: { amount: 'GH₵300', dayOff: false } })).toBe('On track to earn GH₵300 at month close');
    expect(rewardMessage({ ...base, tier: 120, reward })).toBe('Top tier reached. On track to earn GH₵500 and a paid day off at month close');
  });

  it('a closed month says Earned with no tail', () => {
    expect(rewardMessage({ ...base, tier: 100, reward: { amount: 'GH₵300', dayOff: false }, closed: true })).toBe('Earned GH₵300');
    expect(rewardMessage({ ...base, tier: 120, reward, closed: true })).toBe('Top tier reached. Earned GH₵500 and a paid day off');
  });

  it('a tier that pays nothing says the tier', () => {
    expect(rewardMessage({ ...base, tier: 120 })).toBe('Top tier reached');
    expect(rewardMessage({ ...base, tier: 100 })).toBe('100% reached');
  });

  it('an AI agent or a company gets no payout line with its attainment', () => {
    expect(rewardMessage({ ...base, tier: 120, human: false, percent: 120 })).toBe('No payout. Attainment 120%');
    expect(rewardMessage({ ...base, tier: null, human: false, percent: null })).toBe('No payout. Attainment 0%');
  });
});
