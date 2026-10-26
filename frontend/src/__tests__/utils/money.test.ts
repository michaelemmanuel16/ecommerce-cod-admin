import { describe, it, expect, beforeEach } from 'vitest';
import { parseMoney, normalizeMoney } from '../../utils/money';
import { formatCurrency, formatConverted, getStoreCurrency } from '../../utils/format';
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
  it('converts the per-order amount of a payout preview', () => {
    const data = { orders: [{ orderId: 101, applied: '200.00', clearsOrder: true }], unappliedAmount: '50.00' };
    normalizeMoney(data);
    expect(data.orders[0]).toEqual({ orderId: 101, applied: 200, clearsOrder: true });
    expect(data.unappliedAmount).toBe(50);
  });
  it('tolerates null and primitives', () => {
    expect(normalizeMoney(null)).toBeNull();
    expect(normalizeMoney('249.00')).toBe('249.00');
  });
});

describe('formatCurrency', () => {
  beforeEach(() => useConfigStore.setState({ currency: 'GHS' }));
  it('formats strings and numbers the same', () => {
    expect(formatCurrency('249.00', 'USD')).toBe('$249');
    expect(formatCurrency('0.00', 'USD')).toBe('$0');
    expect(formatCurrency('249', 'USD')).toBe('$249');
    expect(formatCurrency(249, 'USD')).toBe('$249');
  });
  it('renders null as zero, not NaN', () => {
    expect(formatCurrency(null, 'USD')).toBe('$0');
    expect(formatCurrency('249.5', 'USD')).toBe('$249.50');
    expect(formatCurrency(undefined, 'USD')).toBe('$0');
  });
});

describe('one money formatter (M3-T31)', () => {
  beforeEach(() => useConfigStore.setState({ currency: 'GHS' }));

  it('formats in the store currency, and follows a change at once', () => {
    expect(formatCurrency(249)).toBe('GH₵249');
    useConfigStore.setState({ currency: 'NGN' });
    expect(formatCurrency('8530000')).toBe('₦8,530,000');
    expect(getStoreCurrency()).toBe('NGN');
  });
  it('formats two currencies side by side', () => {
    expect(formatCurrency(1234.5, 'GHS')).toBe('GH₵1,234.50');
    expect(formatCurrency(1234.5, 'NGN')).toBe('₦1,234.50');
  });
  it('does not throw on an unknown or malformed currency code', () => {
    // Intl puts a no-break space after a bare code
    expect(formatCurrency(1234.5, 'XYZ').replace(/\u00a0/g, ' ')).toBe('XYZ 1,234.50');
    expect(formatCurrency(1234.5, 'not-a-code')).toBe('not-a-code 1,234.50');
  });
  it('converts a foreign amount at the day rate and shows the rate used', () => {
    expect(formatConverted(11200, 'NGN', 112)).toEqual({ text: 'GH₵100', rateText: '₦112 = GH₵1' });
    expect(formatConverted('8530000', 'NGN', 112).text).toBe('GH₵76,160.71');
  });
  it('leaves a foreign amount unconverted when there is no rate, and a store-currency amount alone', () => {
    expect(formatConverted(11200, 'NGN', null)).toEqual({ text: '₦11,200', rateText: '' });
    expect(formatConverted(11200, 'NGN', 0)).toEqual({ text: '₦11,200', rateText: '' });
    expect(formatConverted(50, 'GHS', 112)).toEqual({ text: 'GH₵50', rateText: '' });
  });
});
