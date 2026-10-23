import { OrderStatus, PaymentStatus } from '@prisma/client';

/**
 * Payment tag of an order (F-323). Derived from order status, payment status, method and the delivery date; never stored.
 * The tag only reads. Payment status moves through collections and settlements, not through this block.
 */

export type PaymentTagCode = 'pay_on_delivery' | 'cash_with_agent' | 'overdue_from_agent' | 'paid_in' | 'paid' | 'no_payment';

export const PAYMENT_TAG_LABELS: Record<PaymentTagCode, string> = {
  pay_on_delivery: 'Pay on delivery',
  cash_with_agent: 'Cash with agent',
  overdue_from_agent: 'Overdue from agent',
  paid_in: 'Paid in',
  paid: 'Paid',
  no_payment: 'No payment',
};

/**
 * The partner's days to pay arrives with the partner profile (Deliveries, M5) and the Settings → Operations default.
 * Until then every partner pays within this many days.
 */
export const DEFAULT_DAYS_TO_PAY = 7;

const DAY = 24 * 60 * 60 * 1000;

export interface PaymentTagInput {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  deliveryDate?: Date | null;
  /** A deposit order (paystack_deposit) owes this on delivery. */
  balanceDue?: { gt(n: number): boolean } | null;
}

/** First matching rule wins. A cancelled order, or a returned one nobody paid, has no payment. */
export function paymentTagOf(
  order: PaymentTagInput,
  { daysToPay = DEFAULT_DAYS_TO_PAY, now = new Date() }: { daysToPay?: number; now?: Date } = {},
): { code: PaymentTagCode; label: string } {
  const tag = (code: PaymentTagCode) => ({ code, label: PAYMENT_TAG_LABELS[code] });
  const { status, paymentStatus } = order;

  if (status === 'cancelled') return tag('no_payment');
  if (status === 'returned' && paymentStatus === 'pending') return tag('no_payment');
  if (paymentStatus === 'deposited' || paymentStatus === 'reconciled') return tag('paid_in');
  if (paymentStatus === 'collected') {
    const overdue = !!order.deliveryDate && now.getTime() - order.deliveryDate.getTime() > daysToPay * DAY;
    return tag(overdue ? 'overdue_from_agent' : 'cash_with_agent');
  }
  if (paymentStatus === 'paid') return tag('paid');
  // pending: cash is still due on delivery for a COD order or a deposit order; an online order nobody paid has no payment
  return tag(order.paymentMethod === 'cod' || order.balanceDue?.gt(0) ? 'pay_on_delivery' : 'no_payment');
}
