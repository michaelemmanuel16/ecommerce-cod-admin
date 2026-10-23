/** F-323 tag rules: one row per tag, plus the edges between rules. */
import { describe, it, expect } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { DEFAULT_DAYS_TO_PAY, paymentTagOf, PaymentTagInput } from '../../services/orderPaymentTag';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T12:00:00Z');
const base: PaymentTagInput = { status: 'confirmed', paymentStatus: 'pending', paymentMethod: 'cod', deliveryDate: null };
const tag = (o: Partial<PaymentTagInput>, daysToPay?: number) => paymentTagOf({ ...base, ...o }, { now: NOW, daysToPay }).code;

describe('paymentTagOf', () => {
  it('Pay on delivery: COD, not delivered, payment pending', () => {
    expect(paymentTagOf(base, { now: NOW })).toEqual({ code: 'pay_on_delivery', label: 'Pay on delivery' });
    expect(tag({ status: 'out_for_delivery' })).toBe('pay_on_delivery');
  });

  it('Pay on delivery: a deposit order still owes the balance', () => {
    expect(tag({ paymentMethod: 'paystack_deposit', balanceDue: new Prisma.Decimal(40) })).toBe('pay_on_delivery');
  });

  it('Cash with agent: collected, inside the days to pay', () => {
    const deliveryDate = new Date(NOW.getTime() - 3 * DAY);
    expect(paymentTagOf({ ...base, status: 'delivered', paymentStatus: 'collected', deliveryDate }, { now: NOW }))
      .toEqual({ code: 'cash_with_agent', label: 'Cash with agent' });
    // exactly on the last day is still inside
    expect(tag({ status: 'delivered', paymentStatus: 'collected', deliveryDate: new Date(NOW.getTime() - DEFAULT_DAYS_TO_PAY * DAY) })).toBe('cash_with_agent');
  });

  it('Overdue from agent: collected, past the partner days to pay', () => {
    const deliveryDate = new Date(NOW.getTime() - 10 * DAY);
    expect(paymentTagOf({ ...base, status: 'delivered', paymentStatus: 'collected', deliveryDate }, { now: NOW }))
      .toEqual({ code: 'overdue_from_agent', label: 'Overdue from agent' });
  });

  it('uses the partner days to pay when given', () => {
    const deliveryDate = new Date(NOW.getTime() - 10 * DAY);
    expect(tag({ status: 'delivered', paymentStatus: 'collected', deliveryDate }, 14)).toBe('cash_with_agent');
    expect(tag({ status: 'delivered', paymentStatus: 'collected', deliveryDate }, 5)).toBe('overdue_from_agent');
  });

  it('Paid in: deposited or reconciled', () => {
    expect(paymentTagOf({ ...base, status: 'delivered', paymentStatus: 'deposited' }, { now: NOW })).toEqual({ code: 'paid_in', label: 'Paid in' });
    expect(tag({ status: 'delivered', paymentStatus: 'reconciled' })).toBe('paid_in');
  });

  it('Paid: an online payment that is paid', () => {
    expect(paymentTagOf({ ...base, paymentMethod: 'paystack_full', paymentStatus: 'paid' }, { now: NOW })).toEqual({ code: 'paid', label: 'Paid' });
    expect(tag({ paymentMethod: 'paystack', status: 'digital_delivered', paymentStatus: 'paid' })).toBe('paid');
  });

  it('No payment: cancelled, or returned with no payment', () => {
    expect(paymentTagOf({ ...base, status: 'cancelled' }, { now: NOW })).toEqual({ code: 'no_payment', label: 'No payment' });
    expect(tag({ status: 'returned' })).toBe('no_payment');
  });

  it('No payment wins over a paid status on a cancelled order; a returned order with cash keeps its payment tag', () => {
    expect(tag({ status: 'cancelled', paymentStatus: 'paid' })).toBe('no_payment');
    expect(tag({ status: 'returned', paymentStatus: 'collected', deliveryDate: new Date(NOW.getTime() - DAY) })).toBe('cash_with_agent');
  });

  it('an online order nobody paid has no payment', () => {
    expect(tag({ status: 'payment_pending', paymentMethod: 'paystack_full' })).toBe('no_payment');
  });
});
