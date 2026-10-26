/**
 * Pure rules of settlement matching (M5-T11; F-906). No database: the service reads the candidate orders, these
 * functions decide which line goes to which order and what the settlement status is. Generic: no partner-specific rule.
 */
import { CollectionStatus, SettlementStatus } from '@prisma/client';
import * as Money from '../utils/money';
import { OPEN_COLLECTION_STATUSES } from '../utils/collectionCash';
import { looksLikePhone, phoneLookupVariants } from '../utils/phone';

/** A charge more than this share away from the fee booked at delivery opens a charge_variance Finding (decided at task time: 5 percent). */
export const CHARGE_VARIANCE_LIMIT = 0.05;

export type MatchedBy = 'order_id' | 'order_number' | 'external_ref' | 'phone_amount';

/** An order of the partner as the matcher sees it. `gross` is the cash the customer owed: cod amount, else total. */
export interface OrderCandidate {
  id: number;
  deliveryAgentId: number | null;
  status: string;
  gross: Money.Money;
  /** Fee stamped on the order; null when it was never stamped (an order closed before M5). */
  deliveryFee: Money.Money | null;
  externalOrderId: string | null;
  phone: string | null;
  collection: { id: number; status: CollectionStatus; amount: Money.Money; allocatedAmount: Money.Money; collectionDate: Date } | null;
}

export interface MatchIndex {
  byId: Map<number, OrderCandidate>;
  byExternalId: Map<string, OrderCandidate[]>;
  /** Keyed by every stored form of the customer phone (`phoneLookupVariants`). */
  byPhone: Map<string, OrderCandidate[]>;
}

export interface LineToMatch {
  orderId?: number;
  externalOrderRef: string;
  expAmount: Money.Money;
  charge: Money.Money;
}

export interface LineVerdict {
  order: OrderCandidate | null;
  matchedBy: MatchedBy | null;
  /** Why the line did not match (shown on the line and in the Finding). */
  note: string | null;
}

const unmatched = (note: string): LineVerdict => ({ order: null, matchedBy: null, note });

/** The order id in "1042" or "#1042" (the order number on screen, F-300). Null for anything else. */
export function parseOrderNumber(ref: string): number | null {
  const m = /^#?\s*(\d{1,9})$/.exec(ref.trim());
  return m ? Number(m[1]) : null;
}

/** Why this order cannot take the line, or null when it can. */
function refusalFor(order: OrderCandidate, line: LineToMatch, partnerId: number, taken: ReadonlySet<number>): string | null {
  if (order.deliveryAgentId !== partnerId) return 'The order belongs to another delivery partner';
  if (order.status !== 'delivered') return `The order is ${order.status.replace(/_/g, ' ')}, not delivered`;
  if (!order.collection) return 'No cash collection is recorded for this order yet';
  if (!OPEN_COLLECTION_STATUSES.includes(order.collection.status)) return 'The cash for this order is already settled';
  if (taken.has(order.id)) return 'The order is already matched by another line';
  // A real charge replaces the fee booked at delivery. It must still fit in the cash left on the order.
  const diff = Money.sub(line.charge, order.deliveryFee ?? Money.ZERO);
  if (Money.sub(order.collection.amount, diff).lt(order.collection.allocatedAmount)) return 'The charge is more than the cash left on the order';
  return null;
}

/**
 * Match one line. Order of keys: the order id; else the order number in the reference; else the external order id;
 * else customer phone and amount (needs exactly one order). A line that names an order it cannot take is not
 * matched by a weaker key. `taken` holds the orders earlier lines already matched.
 */
export function matchLine(line: LineToMatch, partnerId: number, index: MatchIndex, taken: ReadonlySet<number>): LineVerdict {
  const accept = (order: OrderCandidate, matchedBy: MatchedBy): LineVerdict => {
    const refusal = refusalFor(order, line, partnerId, taken);
    return refusal ? unmatched(refusal) : { order, matchedBy, note: null };
  };

  if (line.orderId !== undefined) {
    const order = index.byId.get(line.orderId);
    return order ? accept(order, 'order_id') : unmatched(`Order ${line.orderId} was not found`);
  }
  const number = parseOrderNumber(line.externalOrderRef);
  if (number !== null) {
    const order = index.byId.get(number);
    if (order) return accept(order, 'order_number');
  }
  const external = index.byExternalId.get(line.externalOrderRef.trim());
  if (external?.length === 1) return accept(external[0], 'external_ref');

  if (looksLikePhone(line.externalOrderRef)) {
    const seen = new Set<number>();
    const candidates: OrderCandidate[] = [];
    for (const variant of phoneLookupVariants(line.externalOrderRef)) {
      for (const order of index.byPhone.get(variant) ?? []) {
        if (!seen.has(order.id) && order.gross.eq(line.expAmount)) { seen.add(order.id); candidates.push(order); }
      }
    }
    const open = candidates.filter((o) => refusalFor(o, line, partnerId, taken) === null);
    if (open.length === 1) return { order: open[0], matchedBy: 'phone_amount', note: null };
    if (open.length > 1) return unmatched('More than one order has this phone and amount');
  }
  return unmatched(number !== null ? `Order ${number} was not found` : 'No order matches this line');
}

/** True when `charge` is more than `limit` away from the fee booked on the order. A booked fee of 0 treats any charge as a variance. */
export function isChargeVariance(booked: Money.MoneyInput, charge: Money.MoneyInput, limit: number = CHARGE_VARIANCE_LIMIT): boolean {
  const gap = Money.sub(charge, booked).abs();
  if (gap.isZero()) return false;
  return gap.gt(Money.mul(Money.parse(booked).abs(), limit));
}

/**
 * Status of a settlement. `unmatched` when any line matched no order; otherwise `short`, `over` or `matched` by the payout
 * against the expected net, compared to the cent. `shortAmount` and `overAmount` are filled whatever the status says.
 */
export function settlementOutcome(p: { unmatchedLines: number; payout: Money.MoneyInput; expectedNet: Money.MoneyInput }): {
  status: SettlementStatus; shortAmount: Money.Money; overAmount: Money.Money;
} {
  const gap = Money.roundHalfUp(Money.sub(p.payout, p.expectedNet), 2);
  const shortAmount = gap.lt(0) ? gap.abs() : Money.ZERO;
  const overAmount = gap.gt(0) ? gap : Money.ZERO;
  const status: SettlementStatus = p.unmatchedLines > 0 ? 'unmatched' : shortAmount.gt(0) ? 'short' : overAmount.gt(0) ? 'over' : 'matched';
  return { status, shortAmount, overAmount };
}
