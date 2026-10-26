import { describe, it, expect } from '@jest/globals';
import '../mocks/prisma.mock';
import { allocateOldestFirst, formatOwed, OpenEntry } from '../../services/payoutService';
import * as Money from '../../utils/money';

const entry = (id: number, amount: number, day: number | null, kind: OpenEntry['kind'] = 'base'): OpenEntry => ({
  id, orderId: null, kind, amount: Money.parse(amount), earnedAt: day === null ? null : new Date(Date.UTC(2026, 9, day)),
});
const view = (rows: ReturnType<typeof allocateOldestFirst>) => rows.map((r) => [r.entryId, r.pay.toString(), r.remainder.toString()]);

describe('allocateOldestFirst (F-913 partial payment)', () => {
  it('pays whole entries oldest first, whatever the input order', () => {
    const out = allocateOldestFirst([entry(3, 30, 3), entry(1, 10, 1), entry(2, 20, 2)], Money.parse(30));
    expect(view(out)).toEqual([[1, '10', '0'], [2, '20', '0']]);
  });

  it('splits the last entry and leaves the rest earned', () => {
    const out = allocateOldestFirst([entry(1, 104, 1), entry(2, 30, 2, 'upsell')], Money.parse(120));
    expect(view(out)).toEqual([[1, '104', '0'], [2, '16', '14']]);
  });

  it('pays everything when the amount equals what the entries hold', () => {
    const out = allocateOldestFirst([entry(1, 1424, 2), entry(2, 610, 3, 'upsell')], Money.parse(2034));
    expect(out.reduce((s, r) => s.plus(r.pay), Money.ZERO).toString()).toBe('2034');
    expect(out.every((r) => r.remainder.isZero())).toBe(true);
  });

  it('puts an entry with no date first, and breaks a tie by id', () => {
    expect(view(allocateOldestFirst([entry(2, 5, 1), entry(1, 5, 1), entry(3, 5, null)], Money.parse(10)))).toEqual([[3, '5', '0'], [1, '5', '0']]);
  });

  it('throws when the amount is above what the entries hold', () => {
    expect(() => allocateOldestFirst([entry(1, 10, 1)], Money.parse(11))).toThrow(RangeError);
  });
});

describe('formatOwed', () => {
  it('writes the store currency sign, thousands and no decimals for a whole amount', () => {
    expect(formatOwed('2034.0000', 'GHS')).toBe('GH₵2,034');
    expect(formatOwed(134, 'GHS')).toBe('GH₵134');
  });

  it('keeps the decimals when the amount has them, and knows Naira and other codes', () => {
    expect(formatOwed('2034.5', 'GHS')).toBe('GH₵2,034.50');
    expect(formatOwed(5000, 'NGN')).toBe('₦5,000');
    expect(formatOwed(12, 'USD')).toBe('USD 12');
  });
});
