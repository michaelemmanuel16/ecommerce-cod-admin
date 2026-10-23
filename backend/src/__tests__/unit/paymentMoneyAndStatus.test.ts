/** M3b-T03 (F-401): toMinor / fromMinor and the Paystack status map. */
import { describe, it, expect } from '@jest/globals';
import { mapPaystackStatus, toMinor, paystackAdapter } from '../../services/payments/paystackAdapter';
import * as Money from '../../utils/money';

describe('Paystack toMinor (the provider owns the conversion)', () => {
  it.each([
    [249.0, 'GHS', 24900],
    [59.0, 'NGN', 5900],
    [0.01, 'GHS', 1],
    ['249.005', 'GHS', 24901], // half up
    [174.3, 'GHS', 17430],
  ])('toMinor(%s, %s) is %s', (amount, currency, expected) => {
    expect(toMinor(amount, currency as string)).toBe(expected);
  });

  it('is x100 whatever the currency, as the checkout always did', () => {
    expect(toMinor(500, 'JPY')).toBe(50000);
    expect(paystackAdapter.toMinor(Money.parse('10.50'), 'GHS')).toBe(1050);
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
