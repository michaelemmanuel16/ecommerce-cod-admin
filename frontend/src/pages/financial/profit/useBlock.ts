import { useCallback, useEffect, useRef, useState } from 'react';

/** How long an answer is reused for the same key (Finance figures move slowly; a retry or a new range asks again). */
const STALE_MS = 60_000;

const results = new Map<string, { data: unknown; at: number }>();
const inflight = new Map<string, Promise<unknown>>();

/** Forgets every cached answer. A test calls it between cases; nothing in the app needs it. */
export function clearBlockCache(): void {
  results.clear();
  inflight.clear();
}

/** The answer for `key`: the cached one while it is fresh, the call already on its way, or a new call. `fresh` skips the first two. */
function answer<T>(key: string, load: () => Promise<T>, fresh: boolean): { now: T } | { later: Promise<T> } {
  if (!fresh) {
    const hit = results.get(key);
    if (hit && Date.now() - hit.at < STALE_MS) return { now: hit.data as T };
    const running = inflight.get(key);
    if (running) return { later: running as Promise<T> };
  }
  const call = load()
    .then((data) => { results.set(key, { data, at: Date.now() }); return data; })
    .finally(() => { if (inflight.get(key) === call) inflight.delete(key); });
  inflight.set(key, call);
  return { later: call };
}

/** One independent block of a screen: its own status, so one bad call never blanks the rest (F-200). */
export interface FinanceBlock<T> {
  /** The answer for the key, or the last one while a new key loads (the card dims). */
  data: T | undefined;
  /** loading: no answer yet or a new key on its way; ready: `data` is for this key; failed: the call failed. */
  status: 'loading' | 'ready' | 'failed';
  retry: () => void;
}

/**
 * Loads `load()` when `key` changes, through a module-level cache shared by every screen: the Finance cards and the Reports
 * tab asking for the same range share one call. A late answer for an older key is dropped. `load` may change on every
 * render: only `key` decides when to ask again.
 */
export function useBlock<T>(key: string, load: () => Promise<T>): FinanceBlock<T> {
  const [state, setState] = useState<{ data: T | undefined; status: FinanceBlock<T>['status'] }>({ data: undefined, status: 'loading' });
  const latest = useRef(load);
  latest.current = load;
  const seq = useRef(0);

  const run = useCallback((askKey: string, fresh: boolean) => {
    const id = ++seq.current;
    const got = answer(askKey, () => latest.current(), fresh);
    if ('now' in got) {
      setState({ data: got.now, status: 'ready' });
      return;
    }
    setState((s) => ({ ...s, status: 'loading' }));
    got.later.then(
      (data) => { if (id === seq.current) setState({ data, status: 'ready' }); },
      () => { if (id === seq.current) setState((s) => ({ ...s, status: 'failed' })); },
    );
  }, []);

  useEffect(() => {
    run(key, false);
    return () => { seq.current += 1; };
  }, [key, run]);

  return { ...state, retry: () => run(key, true) };
}
