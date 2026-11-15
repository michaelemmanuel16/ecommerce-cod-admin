import { useCallback, useEffect, useRef, useState } from 'react';
import { inboxService, type InboxItem, type InboxStatus, type InboxView } from '../../services/inbox.service';
import { useInboxStore } from '../../stores/inboxStore';
import { matchesView } from './model';

export interface FeedQuery { view: InboxView; status: InboxStatus; scope: 'mine' | 'all' }

/**
 * One page of the feed, newest first, with "load more". It reads the database API; the socket and the 60 second poll
 * only say "something changed". A row that arrives twice (event, then a re-read) is listed once: rows are keyed by id.
 */
export function useInboxFeed({ view, status, scope }: FeedQuery) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);
  const tick = useInboxStore((s) => s.refreshTick);

  const load = useCallback(async (quiet = false) => {
    const mine = ++latest.current;
    if (!quiet) setState('loading');
    try {
      const page = await inboxService.list({ view, status, scope });
      if (mine !== latest.current) return; // an older answer arriving late
      setItems(page.items);
      setNext(page.nextCursor);
      setState('ready');
    } catch {
      if (mine === latest.current && !quiet) setState('failed');
    }
  }, [view, status, scope]);

  useEffect(() => { void load(); }, [load]);

  // A poll or a reconnect: read again without the loading state
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void load(true);
  }, [tick, load]);

  // A row that arrives by socket joins the open list of "mine" without a read
  useEffect(() => useInboxStore.getState().subscribeNew((item) => {
    if (status !== 'open' || scope !== 'mine') return;
    const fits = matchesView(item, view);
    if (fits === 'ask') { void load(true); return; }
    if (fits) setItems((prev) => (prev.some((r) => r.id === item.id) ? prev : [item, ...prev]));
  }), [view, status, scope, load]);

  const loadMore = useCallback(async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await inboxService.list({ view, status, scope, cursor: next });
      setItems((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]);
      setNext(page.nextCursor);
    } catch {
      /* the button stays: try again */
    } finally {
      setLoadingMore(false);
    }
  }, [next, loadingMore, view, status, scope]);

  const replace = useCallback((item: InboxItem) => setItems((prev) => prev.map((r) => (r.id === item.id ? item : r))), []);
  const remove = useCallback((id: number) => setItems((prev) => prev.filter((r) => r.id !== id)), []);

  return { items, state, hasMore: next !== null, loadingMore, loadMore, reload: () => load(), replace, remove };
}
