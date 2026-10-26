/** M5 UI fixes 2 and 3: the tab counts read the same answers as the tabs (one call each), and skip reps the user cannot see. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTabCounts } from '../../pages/financial/tabCounts';
import { useDeposits } from '../../pages/financial/profit/blocks';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';

const svc = vi.hoisted(() => ({ deposits: vi.fn(), repsOwed: vi.fn() }));
vi.mock('../../services/collections.service', async (orig) => ({ ...(await orig<typeof import('../../services/collections.service')>()), collectionsService: { deposits: svc.deposits } }));
vi.mock('../../services/payouts.service', () => ({ payoutsService: { repsOwed: svc.repsOwed } }));

beforeEach(() => {
  clearBlockCache();
  svc.deposits.mockReset().mockResolvedValue([{ id: 1, status: 'pending' }, { id: 2, status: 'pending' }, { id: 3, status: 'rejected' }]);
  svc.repsOwed.mockReset().mockResolvedValue({ totals: { repsOwed: 3 } });
});

describe('useTabCounts', () => {
  it('counts the pending pay-ins from the answer the Agent collections tab uses, with one request', async () => {
    const { result } = renderHook(() => ({ counts: useTabCounts(true), tab: useDeposits() }));
    await waitFor(() => expect(result.current.counts.collections).toBe(2));
    expect(result.current.counts.reps).toBe(3);
    expect(result.current.tab.data).toHaveLength(3);
    expect(svc.deposits).toHaveBeenCalledTimes(1);
  });

  it('does not ask for the reps owed when the user cannot see reps', async () => {
    const { result } = renderHook(() => useTabCounts(false));
    await waitFor(() => expect(result.current.collections).toBe(2));
    expect(result.current.reps).toBeUndefined();
    expect(svc.repsOwed).not.toHaveBeenCalled();
  });

  it('leaves a count out when its call fails, never 0', async () => {
    svc.deposits.mockReset().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTabCounts(true));
    await waitFor(() => expect(result.current.reps).toBe(3));
    expect(result.current.collections).toBeUndefined();
  });
});
