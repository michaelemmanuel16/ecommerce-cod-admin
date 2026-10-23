/** M3-T62 (F-1054): a whole percent is rounded once from the counts, so .5 cases do not round twice. */
import { describe, it, expect } from '@jest/globals';
import { ratePercent, wholeRate } from '../../services/kpi/rates';

describe('wholeRate', () => {
  it('1,469 of 2,000 is 73.45: one decimal gives 73.5, the whole percent is 73 (not 74)', () => {
    expect(ratePercent(1469, 2000)).toBe(73.5);
    expect(Math.round(ratePercent(1469, 2000) as number)).toBe(74);
    expect(wholeRate(1469, 2000)).toBe(73);
  });
  it('rounds half up from the counts', () => {
    expect(wholeRate(147, 200)).toBe(74); // exactly 73.5
    expect(wholeRate(640, 871)).toBe(73);
    expect(wholeRate(1, 3)).toBe(33);
    expect(wholeRate(2, 3)).toBe(67);
  });
  it('null for a zero denominator, 0 for no numerator', () => {
    expect(wholeRate(5, 0)).toBeNull();
    expect(wholeRate(0, 5)).toBe(0);
  });
});
