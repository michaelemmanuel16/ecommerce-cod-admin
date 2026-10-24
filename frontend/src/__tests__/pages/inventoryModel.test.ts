import { describe, it, expect } from 'vitest';
import { canConfirmHere, canReturnToSource, cardNote, countTag, placeName, signedQuantity, signedValue, statusView } from '../../pages/inventory/model';
import { parseView, writeView } from '../../pages/inventory/urlState';
import { CARDS, KOFI, LOGISWIFT, transfer } from '../fixtures/inventory';

describe('count tag (F-652)', () => {
  it('a card says "12 units off"; a table row says "\u221212 units" (counted minus our records)', () => {
    expect(countTag({ isOld: false, difference: -12, wording: 'off' })).toEqual({ tone: 'bad', text: '12 units off' });
    expect(countTag({ isOld: false, difference: -12 })).toEqual({ tone: 'bad', text: '\u221212 units' });
    expect(countTag({ isOld: false, difference: 3 })).toEqual({ tone: 'bad', text: '+3 units' });
    expect(countTag({ isOld: false, difference: -1, wording: 'off' }).text).toBe('1 unit off');
  });
  it('Matches, and "Count is old" instead of a gap', () => {
    expect(countTag({ isOld: false, difference: 0 })).toEqual({ tone: 'ok', text: 'Matches' });
    expect(countTag({ isOld: true, difference: -12 })).toEqual({ tone: 'warn', text: 'Count is old' });
  });
  it('the note under a card names the source and the day, or says there is no count', () => {
    expect(cardNote(CARDS[0].latestCount)).toBe('3PL dashboard count, 15 Oct');
    expect(cardNote(null)).toBe('No stock count yet');
  });
});

describe('transfer status text (F-654)', () => {
  it('in transit, with the Overdue tag shown by the row', () => {
    expect(statusView(transfer({ id: 1 }))).toEqual({ tone: 'v', text: 'In transit', sub: null });
  });
  it('counted below sent reads "Received 2 short" with the count and the reason', () => {
    const v = statusView(transfer({ id: 2, status: 'disputed', quantity: 10, receivedQuantity: 8, shortQuantity: 2, reason: 'short_in_package' }));
    expect(v).toEqual({ tone: 'bad', text: 'Received 2 short', sub: 'Counted 8 of 10 · Short in package' });
  });
  it('received in full, and a resolved dispute', () => {
    expect(statusView(transfer({ id: 3, status: 'received', quantity: 30, receivedQuantity: 30 }))).toMatchObject({ tone: 'ok', text: 'Received', sub: 'Counted 30 of 30' });
    expect(statusView(transfer({ id: 4, status: 'received', quantity: 10, receivedQuantity: 8, reason: 'damaged' }))).toMatchObject({ tone: 'n', text: 'Resolved' });
    expect(statusView(transfer({ id: 5, status: 'cancelled' })).text).toBe('Cancelled');
  });
});

describe('rules for the receipt UI', () => {
  it('only a transfer still in transit to a 3PL or own store is confirmed here; agents confirm on their own screen', () => {
    expect(canConfirmHere(transfer({ id: 1, toLocation: { id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl' } }))).toBe(true);
    expect(canConfirmHere(transfer({ id: 1, toLocation: { id: 9, name: 'Shop', type: 'own_store' } }))).toBe(true);
    expect(canConfirmHere(transfer({ id: 1 }))).toBe(false);
    expect(canConfirmHere(transfer({ id: 1, status: 'received', toLocation: { id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl' } }))).toBe(false);
  });
  it('no "return to source" for a 3PL return that never arrived', () => {
    const fromThreePl = transfer({ id: 1, transferType: 'return_to_warehouse', fromLocation: { id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl' }, toLocation: { id: 9, name: 'Shop', type: 'own_store' } });
    expect(canReturnToSource(fromThreePl)).toBe(false);
    expect(canReturnToSource(transfer({ id: 2, transferType: 'return_to_warehouse', fromLocation: { id: KOFI, name: 'Kofi Appiah', type: 'agent' } }))).toBe(true);
    expect(canReturnToSource(transfer({ id: 3 }))).toBe(true);
  });
});

describe('names and signs in the history', () => {
  it('names the ends a move does not have', () => {
    const sale = transfer({ id: 1, transferType: 'order_fulfillment', toLocation: null });
    expect(placeName(sale, 'to')).toBe('Customer');
    expect(placeName(transfer({ id: 2, transferType: 'receipt', fromLocation: null }), 'from')).toBe('Supplier');
    expect(placeName(transfer({ id: 3, transferType: 'adjustment', toLocation: null }), 'to')).toBe('—');
  });
  it('an adjustment out of a place is negative, into a place positive', () => {
    expect(signedQuantity(transfer({ id: 1, transferType: 'adjustment', quantity: 2, toLocation: null }))).toBe('−2');
    expect(signedQuantity(transfer({ id: 2, transferType: 'count_adjustment', quantity: 3, fromLocation: null }))).toBe('+3');
    expect(signedQuantity(transfer({ id: 3, quantity: 20 }))).toBe('20');
    expect(signedValue(transfer({ id: 4, transferType: 'adjustment', quantity: 2, toLocation: null }))).toBe(-2);
    expect(signedValue(transfer({ id: 5, transferType: 'adjustment', quantity: 2, fromLocation: null }))).toBe(2);
  });
});

describe('Inventory URL state', () => {
  it('reads and writes the product pre-filter, type, differences and action', () => {
    const view = parseView(new URLSearchParams('product=3&type=agent&diff=1&action=allocate&location=11'));
    expect(view).toEqual({ product: 3, type: 'agent', diff: true, action: 'allocate', location: 11 });
    expect(writeView(view).toString()).toBe('product=3&type=agent&diff=1&action=allocate&location=11');
  });
  it('ignores values it does not know, and the plain page has a plain URL', () => {
    const view = parseView(new URLSearchParams('product=abc&type=moon&action=sell&location=-2'));
    expect(view).toEqual({ product: null, type: null, diff: false, action: null, location: null });
    expect(writeView(view).toString()).toBe('');
  });
});
