import { create } from 'zustand';
import { inboxService, type InboxCounts, type InboxItem } from '../services/inbox.service';
import { getSocket } from '../services/socket';

/**
 * Inbox counts and the bell's list (M9-T38). Every figure comes from the database API (`GET /api/inbox/counts`,
 * `GET /api/inbox`); nothing is counted here. The socket events `inbox:counts` and `inbox:new` only save a fetch.
 * While the socket is down the counts are read again every 60 seconds; the poll stops when it reconnects.
 */

export const POLL_MS = 60_000;
const BELL_ROWS = 10;
/** Ids of new rows already handled: a row that arrives twice (event, then poll, then event) is shown once. */
const SEEN_LIMIT = 500;

interface InboxState {
  /** null until the first answer. A failed read keeps the last counts on screen. */
  counts: InboxCounts | null;
  /** The latest open rows, for the bell. */
  recent: InboxItem[];
  connected: boolean;
  /** Goes up on every poll and every reconnect: an open Inbox screen reads its list again. */
  refreshTick: number;
  fetchCounts: () => Promise<void>;
  fetchRecent: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Listen to new rows; returns the unsubscribe. */
  subscribeNew: (fn: (item: InboxItem) => void) => () => void;
  start: () => void;
  stop: () => void;
}

const listeners = new Set<(item: InboxItem) => void>();
const seen = new Set<number>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

const stopPoll = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

export const useInboxStore = create<InboxState>((set, get) => {
  const poll = () => {
    void get().fetchCounts();
    set((s) => ({ refreshTick: s.refreshTick + 1 }));
  };
  const startPoll = () => {
    if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
  };

  const onCounts = (counts: InboxCounts) => set({ counts });
  const onNew = (item: InboxItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as number);
    set((s) => ({ recent: [item, ...s.recent.filter((r) => r.id !== item.id)].slice(0, BELL_ROWS) }));
    listeners.forEach((fn) => fn(item));
  };
  const onConnect = () => {
    stopPoll();
    set((s) => ({ connected: true, refreshTick: s.refreshTick + 1 }));
    void get().fetchCounts(); // events sent while the socket was down are gone: read the truth
  };
  const onDisconnect = () => {
    set({ connected: false });
    startPoll();
  };

  const detach = () => {
    const socket = getSocket();
    if (!socket) return;
    socket.off('inbox:counts', onCounts);
    socket.off('inbox:new', onNew);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
  };

  return {
    counts: null,
    recent: [],
    connected: false,
    refreshTick: 0,

    fetchCounts: async () => {
      try {
        set({ counts: await inboxService.counts() });
      } catch {
        /* keep the last counts: the bell never shows a wrong zero because the network blinked */
      }
    },

    fetchRecent: async () => {
      try {
        const page = await inboxService.list({ view: 'all', status: 'open', limit: BELL_ROWS });
        set({ recent: page.items });
      } catch {
        /* keep what is on screen */
      }
    },

    markRead: async (id) => {
      try {
        const { item, counts } = await inboxService.patch(id, { read: true });
        set((s) => ({ counts, recent: s.recent.map((r) => (r.id === id ? item : r)) }));
      } catch {
        await Promise.all([get().fetchCounts(), get().fetchRecent()]); // the server is the truth
      }
    },

    markAllRead: async () => {
      try {
        const { counts } = await inboxService.markAll('all');
        set({ counts });
      } catch {
        /* the next read shows what is true */
      }
      await get().fetchRecent();
    },

    subscribeNew: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    start: () => {
      detach();
      stopPoll();
      void get().fetchCounts();
      const socket = getSocket();
      if (!socket) {
        set({ connected: false });
        startPoll();
        return;
      }
      socket.on('inbox:counts', onCounts);
      socket.on('inbox:new', onNew);
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      set({ connected: socket.connected });
      if (!socket.connected) startPoll();
    },

    stop: () => {
      detach();
      stopPoll();
      seen.clear();
      set({ counts: null, recent: [], connected: false, refreshTick: 0 });
    },
  };
});
