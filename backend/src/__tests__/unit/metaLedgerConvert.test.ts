import { describe, it, expect } from '@jest/globals';
import { convertSpend } from '../../services/marketing/metaLedgerService';

describe('convertSpend', () => {
  it('NGN 100,000 at 0.0089 gives GHS 890.00', () => {
    expect(convertSpend('100000', '0.0089').toFixed(2)).toBe('890.00');
  });

  it('rounds half up to 2 dp', () => {
    expect(convertSpend('12345.67', '0.0089').toFixed(2)).toBe('109.88'); // 109.876463
    expect(convertSpend('0.5', '0.01').toFixed(2)).toBe('0.01'); // 0.005 rounds up
    expect(convertSpend('0.4', '0.01').toFixed(2)).toBe('0.00');
  });

  it('rate 1 keeps the amount', () => {
    expect(convertSpend('250.10', 1).toFixed(2)).toBe('250.10');
  });
});
