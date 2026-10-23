/** M3b-T03 (F-401): toMinor / fromMinor and the Paystack status map. */
import { describe, it, expect } from '@jest/globals';
import { toMinor, fromMinor } from '../../services/payments';
import { mapPaystackStatus } from '../../services/payments/paystackAdapter';
import * as Money from '../../utils/money';

describe('toMinor', () => {
  it.each([
    [249.0, 'GHS', 24900],
    [59.0, 'NGN', 5900],
    [0.01, 'GHS', 1],
    ['249.005', 'GHS', 24901], // half up
    [174.3, 'GHS', 17430],
  ])('toMinor(%s, %s) is %s', (amount, currency, expected) => {
    expect(toMinor(amount, currency as string)).toBe(expected);
  });

  it('follows the currency: a zero-decimal currency has no minor unit', () => {
    expect(toMinor(500, 'JPY')).toBe(500);
  });

  it('takes Decimal input and falls back to two digits for an unknown code', () => {
    expect(toMinor(Money.parse('10.50'), 'GHS')).toBe(1050);
    expect(toMinor(10, 'ZZ')).toBe(1000);
  });

  it('fromMinor is the inverse', () => {
    expect(Money.toApi(fromMinor(24900, 'GHS'))).toBe('249.00');
    expect(Money.toApi(fromMinor(1, 'NGN'))).toBe('0.01');
  });
});

describe('mapPaystackStatus', () => {
  it.each([
    ['success', 'success'],
    ['abandoned', 'abandoned'],
    ['failed', 'failed'],
    ['reversed', 'failed'],
    ['pending', 'pending'],
    ['ongoing', 'pending'],
    ['processing', 'pending'],
    ['queued', 'pending'],
    ['something_new', 'pending'],
    [undefined, 'pending'],
  ])('%s becomes %s', (status, expected) => {
    expect(mapPaystackStatus(status as string | undefined)).toBe(expected);
  });
});
