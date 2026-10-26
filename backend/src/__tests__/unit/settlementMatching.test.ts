/**
 * M5-T11 (COD-49): the pure rules of settlement matching: order keys, refusals, status, charge variance (F-906).
 */
import { describe, it, expect } from '@jest/globals';
import { Prisma } from '@prisma/client';
import {
  isChargeVariance, matchLine, MatchIndex, OrderCandidate, settlementOutcome,
} from '../../services/settlementMatching';
import { parseOrderNumber } from '../../utils/orderNumber';

const D = (n: number | string) => new Prisma.Decimal(n);
const PARTNER = 7;

const order = (id: number, extra: Partial<OrderCandidate> = {}): OrderCandidate => ({
  id, deliveryAgentId: PARTNER, status: 'delivered', gross: D(200), deliveryFee: D(25), externalOrderId: null, phone: null,
  collection: { id: id * 10, status: 'draft', amount: D(175), allocatedAmount: D(0), collectionDate: new Date('2026-10-01') },
  ...extra,
});
const indexOf = (orders: OrderCandidate[]): MatchIndex => {
  const index: MatchIndex = { byId: new Map(), byExternalId: new Map(), byPhone: new Map() };
  for (const o of orders) {
    index.byId.set(o.id, o);
    if (o.externalOrderId) index.byExternalId.set(o.externalOrderId, [...(index.byExternalId.get(o.externalOrderId) ?? []), o]);
    if (o.phone) index.byPhone.set(o.phone, [...(index.byPhone.get(o.phone) ?? []), o]);
  }
  return index;
};
const line = (extra: Record<string, unknown> = {}) => ({ externalOrderRef: 'x', expAmount: D(200), charge: D(25), ...extra }) as Parameters<typeof matchLine>[0];
const none = new Set<number>();

describe('parseOrderNumber', () => {
  it('reads 1042 and #1042 and nothing else', () => {
    expect(parseOrderNumber('1042')).toBe(1042);
    expect(parseOrderNumber(' #1042 ')).toBe(1042);
    expect(parseOrderNumber('ORD-1042')).toBeNull();
    expect(parseOrderNumber('0244123456789')).toBeNull();
    expect(parseOrderNumber('')).toBeNull();
  });
});

describe('matchLine', () => {
  it('order id first', () => {
    const v = matchLine(line({ orderId: 5, externalOrderRef: 'whatever' }), PARTNER, indexOf([order(5)]), none);
    expect(v).toMatchObject({ matchedBy: 'order_id', order: { id: 5 }, note: null });
  });

  it('an order id that names an order it cannot take is not matched by a weaker key', () => {
    const index = indexOf([order(5, { deliveryAgentId: 99 }), order(6)]);
    const v = matchLine(line({ orderId: 5, externalOrderRef: '#6' }), PARTNER, index, none);
    expect(v.order).toBeNull();
    expect(v.note).toBe('This order is assigned to another delivery partner');
    expect(matchLine(line({ orderId: 404 }), PARTNER, index, none).note).toBe('Order 404 was not found');
  });

  it('order number, then external id, then phone and amount', () => {
    const index = indexOf([order(5), order(6, { externalOrderId: 'SHP-77' }), order(8, { phone: '+233245550101', gross: D(200) })]);
    expect(matchLine(line({ externalOrderRef: '#5' }), PARTNER, index, none)).toMatchObject({ matchedBy: 'order_number', order: { id: 5 } });
    expect(matchLine(line({ externalOrderRef: 'SHP-77' }), PARTNER, index, none)).toMatchObject({ matchedBy: 'external_ref', order: { id: 6 } });
    expect(matchLine(line({ externalOrderRef: '+233245550101' }), PARTNER, index, none)).toMatchObject({ matchedBy: 'phone_amount', order: { id: 8 } });
  });

  it('phone and amount need one order and the right amount', () => {
    const phone = '+233245550101';
    const two = indexOf([order(8, { phone }), order(9, { phone })]);
    expect(matchLine(line({ externalOrderRef: phone }), PARTNER, two, none).note).toBe('More than one order has this phone and amount');
    const one = indexOf([order(8, { phone })]);
    expect(matchLine(line({ externalOrderRef: phone, expAmount: D(150) }), PARTNER, one, none).order).toBeNull();
    // a second order of the phone that is already settled does not make it ambiguous
    const settled = order(9, { phone, collection: { id: 90, status: 'reconciled', amount: D(175), allocatedAmount: D(175), collectionDate: new Date() } });
    expect(matchLine(line({ externalOrderRef: phone }), PARTNER, indexOf([order(8, { phone }), settled]), none).order?.id).toBe(8);
  });

  it('refuses an order that is not delivered, has no collection, is settled, or is taken', () => {
    const cases: Array<[Partial<OrderCandidate>, string]> = [
      [{ status: 'out_for_delivery' }, 'The order is out for delivery, not delivered'],
      [{ collection: null }, 'No cash collection is recorded for this order yet'],
      [{ collection: { id: 1, status: 'reconciled', amount: D(175), allocatedAmount: D(175), collectionDate: new Date() } }, 'The cash for this order is already settled'],
      [{ collection: { id: 1, status: 'deposited', amount: D(175), allocatedAmount: D(175), collectionDate: new Date() } }, 'The cash for this order is already settled'],
    ];
    for (const [extra, note] of cases) {
      expect(matchLine(line({ orderId: 5 }), PARTNER, indexOf([order(5, extra)]), none).note).toBe(note);
    }
    expect(matchLine(line({ orderId: 5 }), PARTNER, indexOf([order(5)]), new Set([5])).note).toBe('The order is already matched by another line');
  });

  it('a part-paid collection can still be matched; a charge above the cash left cannot', () => {
    const part = order(5, { collection: { id: 50, status: 'draft', amount: D(175), allocatedAmount: D(100), collectionDate: new Date() } });
    expect(matchLine(line({ orderId: 5 }), PARTNER, indexOf([part]), none).order?.id).toBe(5);
    // a charge of 120 against a booked 25 leaves 175 - 95 = 80, below the 100 already paid
    expect(matchLine(line({ orderId: 5, charge: D(120) }), PARTNER, indexOf([part]), none).note).toBe('The charge is more than the cash left on the order');
  });

  it('an order never stamped with a fee counts as fee 0', () => {
    const v = matchLine(line({ orderId: 5, charge: D(30) }), PARTNER, indexOf([order(5, { deliveryFee: null, collection: { id: 50, status: 'draft', amount: D(200), allocatedAmount: D(0), collectionDate: new Date() } })]), none);
    expect(v.order?.id).toBe(5);
  });
});

describe('settlementOutcome', () => {
  const run = (payout: number | string, expectedNet: number | string, unmatchedLines = 0) =>
    settlementOutcome({ payout, expectedNet, unmatchedLines });

  it('matched, short and over by the payout against the expected net', () => {
    expect(run(515, 515)).toMatchObject({ status: 'matched' });
    expect(run(500, 515)).toMatchObject({ status: 'short', shortAmount: D(15) });
    expect(run(530.5, 515)).toMatchObject({ status: 'over', overAmount: D('15.5') });
  });

  it('any unmatched line makes it unmatched, and the amounts are still filled', () => {
    expect(run(500, 515, 2)).toMatchObject({ status: 'unmatched', shortAmount: D(15) });
    expect(run(515, 515, 1).status).toBe('unmatched');
  });

  it('compares to the cent', () => {
    expect(run('515.004', '515.00').status).toBe('matched');
    expect(run('515.01', '515.00').status).toBe('over');
  });
});

describe('isChargeVariance', () => {
  it('flags a charge more than 5 percent from the fee booked', () => {
    expect(isChargeVariance(25, 25)).toBe(false);
    expect(isChargeVariance(100, 105)).toBe(false);
    expect(isChargeVariance(100, 105.01)).toBe(true);
    expect(isChargeVariance(100, 94)).toBe(true);
    expect(isChargeVariance(25, 35)).toBe(true);
  });

  it('with a booked fee of 0 any charge is a variance, and 0 against 0 is not', () => {
    expect(isChargeVariance(0, 0)).toBe(false);
    expect(isChargeVariance(0, 0.5)).toBe(true);
  });
});
