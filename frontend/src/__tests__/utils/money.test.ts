import { describe, it, expect, beforeEach } from 'vitest';
import { parseMoney, normalizeMoney } from '../../utils/money';
import { formatCurrency } from '../../utils/format';
import { useConfigStore } from '../../stores/configStore';

describe('parseMoney', () => {
  it('parses API strings', () => {
    expect(parseMoney('249.00')).toBe(249);
    expect(parseMoney('0.00')).toBe(0);
    expect(parseMoney('249')).toBe(249);
    expect(parseMoney('-12.50')).toBe(-12.5);
  });
  it('passes numbers through', () => {
    expect(parseMoney(249.5)).toBe(249.5);
  });
  it('turns null, undefined, empty and junk into 0, never NaN', () => {
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('abc')).toBe(0);
    expect(parseMoney(NaN)).toBe(0);
  });
});

describe('normalizeMoney', () => {
  it('converts money keys deep, leaves phones, codes and ids alone', () => {
    const data = {
      orders: [{ id: '7', totalAmount: '249.00', phoneNumber: '0244123456', customer: { totalSpent: '10.00' } }],
      summary: { profit: '0.00', totalRevenue: 12, code: '1000', bucket_0_1: '5.00', depositPaid: '20.00', codPending: '3.50', customerId: '9' },
    };
    normalizeMoney(data);
    expect(data.orders[0].totalAmount).toBe(249);
    expect(data.orders[0].customer.totalSpent).toBe(10);
    expect(data.orders[0].phoneNumber).toBe('0244123456');
    expect(data.orders[0].id).toBe('7');
    expect(data.summary).toEqual({ profit: 0, totalRevenue: 12, code: '1000', bucket_0_1: 5, depositPaid: 20, codPending: 3.5, customerId: '9' });
  });
  it('tolerates null and primitives', () => {
    expect(normalizeMoney(null)).toBeNull();
    expect(normalizeMoney('249.00')).toBe('249.00');
  });
});

describe('formatCurrency', () => {
  beforeEach(() => useConfigStore.setState({ currency: 'GHS' }));
  it('formats strings and numbers the same', () => {
    expect(formatCurrency('249.00', 'USD')).toBe('$249.00');
    expect(formatCurrency('0.00', 'USD')).toBe('$0.00');
    expect(formatCurrency('249', 'USD')).toBe('$249.00');
    expect(formatCurrency(249, 'USD')).toBe('$249.00');
  });
  it('renders null as zero, not NaN', () => {
    expect(formatCurrency(null, 'USD')).toBe('$0.00');
    expect(formatCurrency(undefined, 'USD')).toBe('$0.00');
  });
});
