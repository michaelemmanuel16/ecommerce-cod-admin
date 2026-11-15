import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { POLL_MS, useInboxStore } from '../../stores/inboxStore';
import { inboxService } from '../../services/inbox.service';
import { getSocket } from '../../services/socket';
import { COUNTS, fakeSocket, item } from '../fixtures/inboxItems';

vi.mock('../../services/inbox.service', async (orig) => ({
  ...(await orig<typeof import('../../services/inbox.service')>()),
  inboxService: { counts: vi.fn(), list: vi.fn(), patch: vi.fn(), markAll: vi.fn() },
}));
vi.mock('../../services/socket', () => ({ getSocket: vi.fn() }));

const flush = () => act(async () => { await Promise.resolve(); });

describe('inboxStore (M9-T38)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useInboxStore.getState().stop();
    vi.mocked(inboxService.counts).mockResolvedValue(COUNTS);
    vi.mocked(inboxService.list).mockResolvedValue({ items: [], nextCursor: null });
  });
  afterEach(() => {
    useInboxStore.getState().stop();
    vi.useRealTimers();
  });

  it('reads the count from the database, and keeps the last count when a read fails', async () => {
    vi.mocked(getSocket).mockReturnValue(fakeSocket() as never);
    useInboxStore.getState().start();
    await flush();
    expect(useInboxStore.getState().counts?.all).toBe(3);
    vi.mocked(inboxService.counts).mockRejectedValue(new Error('down'));
    await act(() => useInboxStore.getState().fetchCounts());
    expect(useInboxStore.getState().counts?.all).toBe(3);
  });

  it('a socket event inbox:counts raises the count with no reload', async () => {
    const socket = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    useInboxStore.getState().start();
    await flush();
    act(() => socket.fire('inbox:counts', { ...COUNTS, all: 7 }));
    expect(useInboxStore.getState().counts?.all).toBe(7);
  });

  it('a socket drop starts a 60 second poll; reconnecting stops it', async () => {
    const socket = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    useInboxStore.getState().start();
    await flush();
    expect(inboxService.counts).toHaveBeenCalledTimes(1);

    // connected: no poll
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(inboxService.counts).toHaveBeenCalledTimes(1);

    act(() => socket.fire('disconnect'));
    expect(useInboxStore.getState().connected).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(inboxService.counts).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(inboxService.counts).toHaveBeenCalledTimes(3);

    act(() => socket.fire('connect')); // one read for what was missed, then no timer
    await flush();
    expect(useInboxStore.getState().connected).toBe(true);
    const afterReconnect = vi.mocked(inboxService.counts).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(inboxService.counts).toHaveBeenCalledTimes(afterReconnect);
  });

  it('with no socket at all the counts are polled every 60 seconds', async () => {
    vi.mocked(getSocket).mockReturnValue(null);
    useInboxStore.getState().start();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(inboxService.counts).toHaveBeenCalledTimes(2);
  });

  it('the same new row twice is handled once; a second start adds no second listener', async () => {
    const socket = fakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    useInboxStore.getState().start();
    useInboxStore.getState().start();
    expect(socket.count('inbox:new')).toBe(1);
    const seen = vi.fn();
    const off = useInboxStore.getState().subscribeNew(seen);
    act(() => { socket.fire('inbox:new', item(5)); socket.fire('inbox:new', item(5)); });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(useInboxStore.getState().recent.map((r) => r.id)).toEqual([5]);
    off();
  });

  it('mark read takes the counts the server answers with; mark all read re-reads the bell list', async () => {
    vi.mocked(getSocket).mockReturnValue(fakeSocket() as never);
    useInboxStore.setState({ counts: COUNTS, recent: [item(1), item(2)] });
    vi.mocked(inboxService.patch).mockResolvedValue({ item: item(1, { isRead: true }), counts: { ...COUNTS, all: 2 } });
    await act(() => useInboxStore.getState().markRead(1));
    expect(inboxService.patch).toHaveBeenCalledWith(1, { read: true });
    expect(useInboxStore.getState().counts?.all).toBe(2);
    expect(useInboxStore.getState().recent[0].isRead).toBe(true);

    vi.mocked(inboxService.markAll).mockResolvedValue({ updated: 2, counts: { ...COUNTS, all: 0 } });
    await act(() => useInboxStore.getState().markAllRead());
    expect(inboxService.markAll).toHaveBeenCalledWith('all');
    expect(useInboxStore.getState().counts?.all).toBe(0);
    expect(inboxService.list).toHaveBeenCalled();
  });
});
