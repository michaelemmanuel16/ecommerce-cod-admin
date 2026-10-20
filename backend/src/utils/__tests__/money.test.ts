import { Prisma } from '@prisma/client';
import * as Money from '../money';

describe('Money helper', () => {
  it('adds 0.1 a thousand times to exactly "100.00"', () => {
    let total: Prisma.Decimal = Money.ZERO;
    for (let i = 0; i < 1000; i++) total = Money.add(total, 0.1);
    expect(Money.toApi(total)).toBe('100.00');
    // plain number arithmetic would not be exact
    let n = 0;
    for (let i = 0; i < 1000; i++) n += 0.1;
    expect(n).not.toBe(100);
  });

  it('rounds half up: 1.005 at 2 decimals is "1.01"', () => {
    expect(Money.toApi(Money.roundHalfUp('1.005', 2))).toBe('1.01');
    expect(Money.toApi(Money.fromNumber(1.005))).toBe('1.01');
    expect(Money.toApi('2.675')).toBe('2.68');
  });

  it('throws on values of 1e15 and above', () => {
    expect(() => Money.fromNumber(1e15)).toThrow(RangeError);
    expect(() => Money.parse('1000000000000000.00')).toThrow(RangeError);
    expect(() => Money.mul('999999999999', '1000000')).toThrow(RangeError);
    expect(() => Money.add('999999999999999', '2')).toThrow(RangeError);
    expect(Money.toApi(Money.fromNumber(999999999999999))).toBe('999999999999999.00');
  });

  it('rejects bad input', () => {
    expect(() => Money.fromNumber(NaN)).toThrow(TypeError);
    expect(() => Money.fromNumber(Infinity)).toThrow(TypeError);
    expect(() => Money.parse('12abc')).toThrow(TypeError);
    expect(() => Money.parse('')).toThrow(TypeError);
    expect(() => Money.div(1, 0)).toThrow(RangeError);
  });

  it('does sub, mul, div and compare', () => {
    expect(Money.toApi(Money.sub('249.00', '74.70'))).toBe('174.30');
    expect(Money.toApi(Money.roundHalfUp(Money.mul('249.00', '0.3'), 2))).toBe('74.70');
    expect(Money.toApi(Money.roundHalfUp(Money.div(10, 3), 2))).toBe('3.33');
    expect(Money.compare('1.10', 1.1)).toBe(0);
    expect(Money.compare('0.30', Money.add(0.1, 0.2))).toBe(0);
    expect(Money.gt(2, 1)).toBe(true);
    expect(Money.lt(1, 2)).toBe(true);
    expect(Money.toApi(Money.sum([0.1, 0.2, '0.3']))).toBe('0.60');
  });

  it('accepts a Prisma Decimal and formats negatives and zero', () => {
    expect(Money.toApi(new Prisma.Decimal('249'))).toBe('249.00');
    expect(Money.toApi('-1350')).toBe('-1350.00');
    expect(Money.toApi(0)).toBe('0.00');
  });

  it('converts at the Paystack boundary (minor units)', () => {
    expect(Money.toMinor('74.70')).toBe(7470);
    expect(Money.toMinor(249)).toBe(24900);
    expect(Money.toMinor('0.285')).toBe(29);
    expect(Money.toApi(Money.fromMinor(7470))).toBe('74.70');
  });

  it('tryParse returns null for empty or bad input', () => {
    expect(Money.tryParse('')).toBeNull();
    expect(Money.tryParse(undefined)).toBeNull();
    expect(Money.tryParse('abc')).toBeNull();
    expect(Money.tryParse(1e16)).toBeNull();
    expect(Money.toApi(Money.tryParse('12.5')!)).toBe('12.50');
  });
  it('orZero treats null and undefined as zero', () => {
    expect(Money.toApi(Money.orZero(null))).toBe('0.00');
    expect(Money.toApi(Money.orZero(undefined))).toBe('0.00');
    expect(Money.toApi(Money.orZero(new Prisma.Decimal('12.5')))).toBe('12.50');
  });

  it('jsonReplacer turns every Decimal into a 2-decimal string and leaves other values alone', () => {
    const body = {
      total: new Prisma.Decimal('249'),
      nested: { amounts: [new Prisma.Decimal('0.1'), new Prisma.Decimal('1234.5678')] },
      rate: 12.5,
      count: 3,
      name: 'x',
      missing: null,
      date: new Date('2024-01-01T00:00:00Z'),
    };
    expect(JSON.parse(JSON.stringify(body, Money.jsonReplacer))).toEqual({
      total: '249.00',
      nested: { amounts: ['0.10', '1234.57'] },
      rate: 12.5,
      count: 3,
      name: 'x',
      missing: null,
      date: '2024-01-01T00:00:00.000Z',
    });
  });
});
