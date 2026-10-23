import { describe, it, expect } from 'vitest';
import { currencyCheck, effectiveToggles, methodMatrix } from '../../lib/paymentMatrix';

const conn = (supportedCurrencies: string[]) => ({ provider: 'paystack', mode: 'live' as const, isEnabled: true, supportedCurrencies, lastCheckedAt: null });

describe('methodMatrix (mirror of the server rule)', () => {
  it('physical, flag off: COD only', () => {
    expect(methodMatrix('physical', false)).toEqual({ cod: true, online_deposit: false, online_full: false });
  });
  it('physical, flag on: all three', () => {
    expect(methodMatrix('physical', true)).toEqual({ cod: true, online_deposit: true, online_full: true });
  });
  it('digital: online in full only, flag on or off', () => {
    const only = { cod: false, online_deposit: false, online_full: true };
    expect(methodMatrix('digital', false)).toEqual(only);
    expect(methodMatrix('digital', true)).toEqual(only);
  });
});

describe('currencyCheck', () => {
  it('flags a currency the account cannot take', () => {
    expect(currencyCheck(conn(['NGN']), 'GHS')).toBe('unsupported');
    expect(currencyCheck(conn(['NGN', 'GHS']), 'ghs')).toBeNull();
  });
  it('does not block an account that was never tested', () => {
    expect(currencyCheck(conn([]), 'GHS')).toBe('untested');
  });
  it('has nothing to say without a connection', () => {
    expect(currencyCheck(null, 'GHS')).toBeNull();
  });
});

describe('effectiveToggles', () => {
  const stored = { cod: true, deposit: false, full: false };
  it('digital is always online in full', () => {
    expect(effectiveToggles('digital', stored)).toEqual({ cod: false, deposit: false, full: true });
  });
  it('physical keeps what is stored', () => {
    expect(effectiveToggles('physical', { cod: false, deposit: true, full: false })).toEqual({ cod: false, deposit: true, full: false });
  });
});
