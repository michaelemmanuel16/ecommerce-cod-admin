import { describe, it, expect } from 'vitest';
import { currencyUntested, effectiveToggles, methodMatrix, unsupportedCurrencyMessage } from '../../lib/paymentMatrix';

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

describe('unsupportedCurrencyMessage (the server\'s words)', () => {
  it('names a currency the account cannot take, in upper case', () => {
    expect(unsupportedCurrencyMessage(conn(['NGN']), 'ghs')).toBe('This payment account cannot take GHS. Connect another account or provider.');
    expect(unsupportedCurrencyMessage(conn(['NGN', 'GHS']), 'ghs')).toBeNull();
  });
  it('does not block an account that was never tested', () => {
    expect(unsupportedCurrencyMessage(conn([]), 'GHS')).toBeNull();
    expect(currencyUntested(conn([]))).toBe(true);
  });
  it('has nothing to say without a connection', () => {
    expect(unsupportedCurrencyMessage(null, 'GHS')).toBeNull();
    expect(currencyUntested(null)).toBe(false);
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
