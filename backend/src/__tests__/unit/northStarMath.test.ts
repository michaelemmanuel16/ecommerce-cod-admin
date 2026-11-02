/** M6-T08: the North Star arithmetic on the fixture (annual 1,800,000; October 180,000; AOV 249; 70% x 60%). */
import { describe, it, expect } from '@jest/globals';
import {
  assertRate, maxCostPerOrder, monthSplit, ordersDelivered, ordersPerDay, ordersToTakeIn, planQuarters, quarterSplit,
} from '../../services/northStarMath';
import * as Money from '../../utils/money';

const nums = (parts: Money.Money[]) => parts.map((p) => Number(p));

describe('quarterSplit', () => {
  it('grow: one thirtieth of the annual figure per step gives 360/420/480/540k', () => {
    expect(nums(quarterSplit(1_800_000, 'grow'))).toEqual([360_000, 420_000, 480_000, 540_000]);
  });
  it('even: annual / 4', () => {
    expect(nums(quarterSplit(1_800_000, 'even'))).toEqual([450_000, 450_000, 450_000, 450_000]);
  });
  it('parts always add up to the annual figure to the cent', () => {
    for (const mode of ['even', 'grow'] as const) {
      expect(Money.sum(quarterSplit(1_000_003.33, mode)).toFixed(2)).toBe('1000003.33');
    }
  });
  it('custom quarters that do not add up are blocked with the difference', () => {
    expect(() => quarterSplit(1_800_000, 'custom', [300_000, 400_000, 500_000, 500_000])).toThrow(/Difference: 100000\.00/);
    expect(() => quarterSplit(1_800_000, 'custom', [300_000, 400_000, 500_000, 500_000])).toThrow(expect.objectContaining({ errorCode: 'TARGET_SUM_MISMATCH' }));
    expect(nums(quarterSplit(1_800_000, 'custom', [100_000, 200_000, 500_000, 1_000_000]))).toEqual([100_000, 200_000, 500_000, 1_000_000]);
  });
});

describe('planQuarters and monthSplit (past months keep their value)', () => {
  it('a fully kept quarter keeps its value; the rest of the annual figure goes to the others in the mode proportions', () => {
    const q = planQuarters(2_000_000, 'even', undefined, [Money.parse(360_000), null, null, null]);
    expect(nums(q)).toEqual([360_000, 546_666.67, 546_666.67, 546_666.66]);
    expect(Money.sum(q).toFixed(2)).toBe('2000000.00');
  });
  it('months: equal split; kept months stay and the others share what is left', () => {
    expect(nums(monthSplit(540_000, [null, null, null]))).toEqual([180_000, 180_000, 180_000]);
    expect(nums(monthSplit(740_000, [Money.parse(180_000), null, null]))).toEqual([180_000, 280_000, 280_000]);
  });
  it('months kept above the quarter are blocked with the difference', () => {
    expect(() => monthSplit(300_000, [Money.parse(200_000), Money.parse(200_000), null])).toThrow(/Difference: 100000\.00/);
  });
});

describe('calculators', () => {
  it('October fixture: 180,000 / 249 = 723; / (0.70 x 0.60) = 1,721; / 31 = 56', () => {
    const delivered = ordersDelivered(180_000, 249);
    const takeIn = ordersToTakeIn(delivered, 0.7, 0.6);
    expect([delivered, takeIn, ordersPerDay(takeIn, 31)]).toEqual([723, 1721, 56]);
  });
  it('a 30-day month gives 58 a day, February 28 days 62', () => {
    expect(ordersPerDay(1721, 30)).toBe(58);
    expect(ordersPerDay(1721, 28)).toBe(62);
  });
  it('max cost per order = profit x planned yield (42%)', () => {
    expect(maxCostPerOrder(20_720, 0.7, 0.6)).toBe('8702.40');
  });
  it('rates of 0, below 0 and above 1 are rejected', () => {
    for (const bad of [0, -0.1, 1.01]) {
      expect(() => assertRate(bad)).toThrow(expect.objectContaining({ errorCode: 'RATE_INVALID' }));
      expect(() => ordersToTakeIn(723, bad, 0.6)).toThrow(/rate/);
    }
    expect(() => assertRate(1)).not.toThrow();
  });
  it('a target or AOV of 0 is refused', () => {
    expect(() => ordersDelivered(180_000, 0)).toThrow(/AOV/);
  });
});
