import { useCallback, useEffect, useRef, useState } from 'react';

/** One independent block of a screen: its own loading and its own failure (F-200), so one bad call never blanks the rest. */
export interface Block<T> {
  data: T | undefined;
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

/**
 * Loads `load()` when `key` changes. The figures already on screen stay while a new range loads (the card dims); a late
 * answer for an older key is dropped. `load` may change on every render: only `key` decides when to ask again.
 */
export function useBlock<T>(key: string, load: () => Promise<T>, enabled = true): Block<T> {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; failed: boolean }>({ data: undefined, loading: enabled, failed: false });
  const latest = useRef(load);
  latest.current = load;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, failed: false }));
    try {
      const data = await latest.current();
      if (id === seq.current) setState({ data, loading: false, failed: false });
    } catch {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, failed: true }));
    }
  }, []);

  useEffect(() => {
    if (enabled) void run();
    return () => { seq.current += 1; };
  }, [key, enabled, run]);

  return { ...state, retry: () => void run() };
}
