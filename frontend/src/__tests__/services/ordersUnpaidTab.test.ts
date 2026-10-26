import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listParams, DEFAULT_VIEW } from '../../pages/orders/urlState';
import { isViewTab, tabCount, visibleTabs } from '../../pages/orders/model';
import type { OrderCounts } from '../../services/orders.service';

const COUNTS = { all: 5, byStatus: {}, waitingToDispatch: 0 } as unknown as OrderCounts;
beforeEach(() => vi.useRealTimers());

describe('Unpaid by agent view tab (M5-T35)', () => {
  it('sends tab=unpaid_by_agent with no dates and no status', () => {
    const p = listParams({ ...DEFAULT_VIEW, tab: 'unpaid_by_agent' }, 25);
    expect(p.tab).toBe('unpaid_by_agent');
    for (const k of ['startDate', 'endDate', 'dateBasis', 'status'] as const) expect(p).not.toHaveProperty(k);
    expect(listParams(DEFAULT_VIEW, 25)).toHaveProperty('startDate');
  });

  it('is a view tab; its count is unpaidByAgent from the counts call, and it is not drawn when that is null', () => {
    expect(isViewTab('unpaid_by_agent')).toBe(true);
    expect(isViewTab('confirmed')).toBe(false);
    expect(tabCount('unpaid_by_agent', { ...COUNTS, unpaidByAgent: 38 })).toBe(38);
    expect(visibleTabs({ ...COUNTS, unpaidByAgent: 0 }, 'all').some((t) => t.id === 'unpaid_by_agent')).toBe(true);
    expect(visibleTabs({ ...COUNTS, unpaidByAgent: null }, 'all').some((t) => t.id === 'unpaid_by_agent')).toBe(false);
  });
});
