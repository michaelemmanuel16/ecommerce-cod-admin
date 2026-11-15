import { useCallback, useEffect, useRef, useState } from 'react';

interface State<T> {
  data: T | null;
  loading: boolean;
  failed: boolean;
}

/** One GET that reloads when `key` changes. A newer request wins: an old answer arriving late is dropped. */
export function useLoad<T>(load: () => Promise<T>, key: string, enabled = true) {
  const [state, setState] = useState<State<T>>({ data: null, loading: enabled, failed: false });
  const id = useRef(0);
  const latest = useRef(load);
  latest.current = load;

  const run = useCallback(async () => {
    const mine = ++id.current;
    setState((s) => ({ ...s, loading: true, failed: false }));
    try {
      const data = await latest.current();
      if (mine === id.current) setState({ data, loading: false, failed: false });
    } catch {
      if (mine === id.current) setState((s) => ({ ...s, loading: false, failed: true }));
    }
  }, []);

  useEffect(() => {
    if (enabled) void run();
  }, [enabled, key, run]);

  return { ...state, reload: run };
}
