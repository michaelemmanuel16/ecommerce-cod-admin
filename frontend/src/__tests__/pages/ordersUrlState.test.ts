import { describe, it, expect } from 'vitest';
import { DEFAULT_VIEW, listParams, MAX_IDS, parseView, presetOf, presetRange, rangePhrase, writeView } from '../../pages/orders/urlState';

const NOW = new Date('2026-10-22T10:00:00Z');

describe('Orders URL state (M3-T43)', () => {
  it('the plain page has a plain URL', () => {
    expect(writeView(DEFAULT_VIEW).toString()).toBe('');
    expect(parseView(new URLSearchParams(''))).toEqual(DEFAULT_VIEW);
  });

  it('round trips every field', () => {
    const view = {
      tab: 'payment_issues' as const, page: 3, q: '#24118', sort: { by: 'customer' as const, dir: 'asc' as const }, size: 75,
      from: '2026-09-01', to: '2026-09-30', basis: 'delivery' as const, product: 4, agent: 5, rep: 'none' as const, flagged: true, failure: 'refused' as const, ids: [7, 8, 9],
    };
    expect(parseView(writeView(view))).toEqual(view);
  });

  it('drops values it does not accept', () => {
    const v = parseView(new URLSearchParams('status=x&page=-2&sort=hack&size=30&from=2026-01-01&rep=abc&product=0&basis=nope'));
    expect(v).toEqual(DEFAULT_VIEW);
  });

  it('ids (the orders an import made): numbers only, at most 2,000, and they replace the date range', () => {
    expect(parseView(new URLSearchParams('ids=5,6,7')).ids).toEqual([5, 6, 7]);
    expect(parseView(new URLSearchParams('ids=5,x')).ids).toBeNull();
    expect(parseView(new URLSearchParams(`ids=${Array.from({ length: MAX_IDS + 1 }, (_, i) => i + 1).join(',')}`)).ids).toBeNull();
    const params = listParams(parseView(new URLSearchParams('ids=5,6')), 25, NOW);
    expect(params.ids).toBe('5,6');
    expect(params.startDate).toBeUndefined();
    expect(listParams(DEFAULT_VIEW, 25, NOW).ids).toBeUndefined();
  });

  it('failure (from the Deliveries reasons card): a known reason only, sent to the API as failureReason', () => {
    expect(parseView(new URLSearchParams('failure=not_reachable')).failure).toBe('not_reachable');
    expect(parseView(new URLSearchParams('failure=hack')).failure).toBeNull();
    expect(listParams(parseView(new URLSearchParams('failure=refused')), 25, NOW).failureReason).toBe('refused');
    expect(listParams(DEFAULT_VIEW, 25, NOW).failureReason).toBeUndefined();
  });

  it('presets, in Africa/Accra (UTC) dates', () => {
    expect(presetRange('today', NOW)).toEqual({ from: '2026-10-22', to: '2026-10-22' });
    expect(presetRange('yesterday', NOW)).toEqual({ from: '2026-10-21', to: '2026-10-21' });
    expect(presetRange('last7', NOW)).toEqual({ from: '2026-10-16', to: '2026-10-22' });
    expect(presetRange('month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('lastMonth', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('lastMonth', new Date('2026-01-05T00:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetOf({ from: '2026-10-01', to: '2026-10-31' }, NOW)).toBe('month');
    expect(presetOf({ from: '2026-10-02', to: '2026-10-31' }, NOW)).toBe('custom');
  });

  it('words the range for the page sub-line', () => {
    expect(rangePhrase(presetRange('month', NOW), NOW)).toBe('in October');
    expect(rangePhrase({ from: '2026-10-03', to: '2026-10-09' }, NOW)).toBe('from 3 Oct to 9 Oct');
  });
});
