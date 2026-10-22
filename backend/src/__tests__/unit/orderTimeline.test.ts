/** F-322: the timeline builder on a fixture with a forced move, a failed delivery and a planned re-delivery. */
import { describe, it, expect } from '@jest/globals';
import { buildTimeline, formatDuration, TimelineHistoryRow, TimelineOrder } from '../../services/orderTimeline';

const at = (iso: string) => new Date(`2026-10-${iso}Z`);
const names = new Map([[1, 'Adwoa Darko'], [2, 'Nana Kyei'], [3, 'Logiswift']]);

const order: TimelineOrder = {
  status: 'failed_delivery',
  createdAt: at('14T10:30:00'),
  createdById: 2,
  source: 'manual',
  confirmedAt: at('14T10:42:00'),
  deliveryDate: null,
  nextAttemptDate: at('25T09:00:00'),
};

const h = (over: Partial<TimelineHistoryRow>): TimelineHistoryRow => ({
  status: 'confirmed', fromStatus: 'pending_confirmation', notes: null, metadata: {}, createdAt: at('14T10:42:00'),
  changedBy: 1, actorKind: 'user', forced: false, ...over,
});

const history: TimelineHistoryRow[] = [
  h({ status: 'pending_confirmation', fromStatus: null, notes: 'Order created', createdAt: at('14T10:30:00'), changedBy: 2 }),
  h({}),
  h({ status: 'out_for_delivery', fromStatus: 'confirmed', createdAt: at('15T08:00:00'), changedBy: 3, actorKind: 'integration' }),
  h({ status: 'failed_delivery', fromStatus: 'out_for_delivery', notes: 'Not home', createdAt: at('16T14:00:00'), changedBy: 3, actorKind: 'integration' }),
  h({ status: 'delivered', fromStatus: 'failed_delivery', notes: 'Customer asked for delivery today', createdAt: at('17T09:00:00'), changedBy: 2, forced: true, metadata: { reason: 'Customer asked for delivery today' } }),
  h({ status: 'pending_confirmation', fromStatus: null, notes: 'Call rep set', createdAt: at('14T11:00:00'), changedBy: 2, metadata: { assignedRepId: 1 } }),
];

describe('buildTimeline', () => {
  const rows = buildTimeline({
    order, history,
    calls: [{ outcome: 'not_reachable', notes: 'Rang out', createdAt: at('14T10:35:00'), salesRepId: 1 }],
    edits: [{ createdAt: at('14T10:50:00'), userId: 2, fields: ['deliveryAddress'] }],
    names,
    now: at('20T08:00:00'),
  });

  it('is in time order, with the placing first and the planned re-delivery last', () => {
    expect(rows[0]).toMatchObject({ kind: 'placed', size: 'main', title: 'Order placed', actor: { kind: 'person', name: 'Nana Kyei' } });
    const times = rows.slice(0, -1).map((r) => r.at);
    expect([...times].sort()).toEqual(times);
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'planned', title: 'Re-delivery planned', at: at('25T09:00:00').toISOString() });
  });

  it('shows a forced move with its reason and the Override tag', () => {
    const forced = rows.find((r) => r.kind === 'status' && r.status === 'delivered')!;
    expect(forced).toMatchObject({ override: true, reason: 'Customer asked for delivery today', fromStatus: 'failed_delivery', actor: { kind: 'person', name: 'Nana Kyei' } });
    expect(forced.note).toBeNull();
  });

  it('shows a failed delivery with its note, and a partner move as a partner actor', () => {
    expect(rows.find((r) => r.status === 'failed_delivery')).toMatchObject({ title: 'Failed delivery', note: 'Not home', actor: { kind: 'partner', name: 'Logiswift' } });
  });

  it('puts edits, assignments and calls in as small rows', () => {
    const small = rows.filter((r) => r.size === 'small').map((r) => [r.kind, r.title]);
    expect(small).toEqual(expect.arrayContaining([
      ['call', 'Call: not reachable'],
      ['edit', 'Edited deliveryAddress'],
      ['assignment', 'Call rep set to Adwoa Darko'],
    ]));
  });

  it('adds duration chips: placed to confirmed, confirmed to delivered', () => {
    expect(rows.find((r) => r.status === 'confirmed')!.durationChip).toBe('Confirmed after 12 min');
    expect(rows.find((r) => r.status === 'delivered')!.durationChip).toBe('Delivered after 2.9 days');
  });

  it('an old order with no confirmedAt and no history shows only the placing row', () => {
    const only = buildTimeline({ order: { ...order, status: 'confirmed', confirmedAt: null, nextAttemptDate: null }, history: [], calls: [], edits: [], names });
    expect(only).toHaveLength(1);
    expect(only[0].kind).toBe('placed');
  });

  it('a past nextAttemptDate is not planned', () => {
    const past = buildTimeline({ order, history: [], calls: [], edits: [], names, now: at('26T00:00:00') });
    expect(past.find((r) => r.kind === 'planned')).toBeUndefined();
  });

  it('a move with no actor reads as system', () => {
    const sys = buildTimeline({ order: { ...order, createdById: null }, history: [h({ changedBy: null, actorKind: null })], calls: [], edits: [], names });
    expect(sys.find((r) => r.status === 'confirmed')!.actor).toEqual({ kind: 'system', userId: null, name: null });
  });
});

describe('formatDuration', () => {
  it('picks the unit', () => {
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(3.5 * 3_600_000)).toBe('3.5 hours');
    expect(formatDuration(4.1 * 86_400_000)).toBe('4.1 days');
    expect(formatDuration(-5)).toBe('1 min');
  });
});
