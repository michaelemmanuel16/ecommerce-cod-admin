import { describe, it, expect } from '@jest/globals';
import '../mocks/prisma.mock';
import { allocateOldestFirst, summarize } from '../../services/payoutService';
import { CommissionKind } from '@prisma/client';
import * as Money from '../../utils/money';

const entry = (id: number, amount: number, day: number | null, status: string = 'earned', kind: CommissionKind = 'base') => ({
  id, amount: Money.parse(amount), earnedAt: day === null ? null : new Date(Date.UTC(2026, 9, day)), status, kind,
});
const view = (rows: ReturnType<typeof allocateOldestFirst>) => rows.map((r) => [r.entryId, r.pay.toString(), r.remainder.toString()]);

describe('allocateOldestFirst (F-913 partial payment, COD-193 return deductions)', () => {
  it('pays whole entries oldest first, whatever the input order', () => {
    const out = allocateOldestFirst([entry(3, 30, 3), entry(1, 10, 1), entry(2, 20, 2)], Money.parse(30));
    expect(view(out)).toEqual([[1, '10', '0'], [2, '20', '0']]);
  });

  it('splits the last entry and leaves the rest earned', () => {
    const out = allocateOldestFirst([entry(1, 104, 1), entry(2, 30, 2)], Money.parse(120));
    expect(view(out)).toEqual([[1, '104', '0'], [2, '16', '14']]);
  });

  it('pays everything when the amount equals what the entries hold', () => {
    const out = allocateOldestFirst([entry(1, 1424, 2), entry(2, 610, 3)], Money.parse(2034));
    expect(out.reduce((s, r) => s.plus(r.pay), Money.ZERO).toString()).toBe('2034');
    expect(out.every((r) => r.remainder.isZero())).toBe(true);
  });

  it('puts an entry with no date first, and breaks a tie by id', () => {
    expect(view(allocateOldestFirst([entry(2, 5, 1), entry(1, 5, 1), entry(3, 5, null)], Money.parse(10)))).toEqual([[3, '5', '0'], [1, '5', '0']]);
  });

  it('throws when the amount is above what the entries hold', () => {
    expect(() => allocateOldestFirst([entry(1, 10, 1)], Money.parse(11))).toThrow(RangeError);
  });

  it('applies negative entries first in full: [+8, +5, -5] pay 8 -> all three paid (COD-193)', () => {
    const out = allocateOldestFirst([entry(1, 8, 1), entry(2, 5, 2), entry(3, -5, 3)], Money.parse(8));
    expect(view(out)).toEqual([[3, '-5', '0'], [1, '8', '0'], [2, '5', '0']]);
  });

  it('applies negative entries first in full: [+8, -5] pay 3 -> both paid (COD-193)', () => {
    const out = allocateOldestFirst([entry(1, 8, 1), entry(2, -5, 2)], Money.parse(3));
    expect(view(out)).toEqual([[2, '-5', '0'], [1, '8', '0']]);
  });

  it('summarize computes negative owed for [-5] alone (COD-193)', () => {
    const sum = summarize([entry(1, -5, 1)]);
    expect(sum.owed.toString()).toBe('-5');
  });
});

describe('Money.format for the owed message', () => {
  const owed = (v: Money.MoneyInput, code: string, symbol?: string) => Money.format(v, code, { symbol, wholeIfZero: true });

  it('writes the currency sign, thousands and no decimals for a whole amount', () => {
    expect(owed('2034.0000', 'GHS', 'GH₵')).toBe('GH₵2,034');
    expect(owed(134, 'GHS', 'GH₵')).toBe('GH₵134');
  });

  it('keeps the decimals when the amount has them, and falls back to the code', () => {
    expect(owed('2034.5', 'GHS', 'GH₵')).toBe('GH₵2,034.50');
    expect(owed(5000, 'NGN', '₦')).toBe('₦5,000');
    expect(owed(12, 'USD')).toBe('USD 12');
    expect(Money.format(1234.5, 'GHS')).toBe('GHS 1,234.50');
  });
});
