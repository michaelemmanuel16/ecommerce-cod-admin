import { describe, it, expect } from '@jest/globals';
import { mapFailureText } from '../../utils/failureReasonText';
import { reasonOf } from '../../services/failureReasonBackfill';

describe('mapFailureText (M4-T18, F-705)', () => {
  it.each([
    ['Customer not reachable', 'not_reachable'],
    ['no answer after 3 calls', 'not_reachable'],
    ["Didn't pick up the phone", 'not_reachable'],
    ['phone switched off', 'not_reachable'],
    ['Customer refused the parcel', 'refused'],
    ['declined at the door', 'refused'],
    ['not interested anymore', 'refused'],
    ['Wrong address given', 'wrong_address'],
    ["couldn't find the house", 'wrong_address'],
    ['customer asked to reschedule', 'rescheduled'],
    ['call back tomorrow', 'rescheduled'],
    ['rain, rider fell ill', 'other'],
    ['', 'other'],
  ])('%s is %s', (text, expected) => {
    expect(mapFailureText(text)).toBe(expected);
  });

  it('null and undefined are other', () => {
    expect(mapFailureText(null)).toBe('other');
    expect(mapFailureText(undefined)).toBe('other');
  });

  it('the first rule wins when words from two rules appear', () => {
    expect(mapFailureText('refused, will not be reachable')).toBe('refused');
    expect(mapFailureText('wrong address, reschedule')).toBe('wrong_address');
  });
});

describe('reasonOf (backfill)', () => {
  const order = (notes: string | null, metadata: unknown, deliveryNotes: string | null = null) => ({
    id: 1,
    orderHistory: [{ notes, metadata: metadata as any }],
    delivery: deliveryNotes === null ? null : { notes: deliveryNotes },
  });

  it('reads the history note, the metadata reason and the delivery note', () => {
    expect(reasonOf(order('Delivery failed: customer refused', {}))).toBe('refused');
    expect(reasonOf(order(null, { reason: 'wrong address' }))).toBe('wrong_address');
    expect(reasonOf(order(null, {}, 'Failed delivery attempt: not reachable'))).toBe('not_reachable');
  });

  it('a reschedule flag wins over the text', () => {
    expect(reasonOf(order('Delivery failed: refused', { reschedule: true }))).toBe('rescheduled');
  });

  it('no text at all is other', () => {
    expect(reasonOf(order(null, null))).toBe('other');
    expect(reasonOf({ id: 2, orderHistory: [], delivery: null })).toBe('other');
  });
});
