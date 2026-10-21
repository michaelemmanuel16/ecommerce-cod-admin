import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardService } from '../../services/dashboard.service';
import { getSocket } from '../../services/socket';
import type { DashboardRange, OwnerDashboardData } from './types';

/** A socket event refetches at most once in this time (F-201). */
export const SOCKET_REFETCH_MS = 5000;
/** Events that change a Dashboard figure. `order:created` also feeds the recent orders list (F-207). */
export const REFETCH_EVENTS = ['order:status_changed', 'delivery:completed', 'payment:received', 'bulk_import_completed', 'order:created'] as const;

interface State {
  data: OwnerDashboardData | null;
  /** The request itself failed (network, 401, 403): no block data at all. */
  failed: boolean;
  loading: boolean;
}

/**
 * One call returns every block (F-200). `refetch` is the Refresh button and the retry button of a failed block.
 * Socket events refetch through a 5 second throttle: the first event goes out at once, later ones inside the window
 * collapse into one trailing fetch.
 */
export function useOwnerDashboard(range: DashboardRange) {
  const [state, setState] = useState<State>({ data: null, failed: false, loading: true });
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const lastFetch = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (fresh: boolean) => {
    const id = ++requestId.current;
    lastFetch.current = Date.now();
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await dashboardService.getOwner(rangeRef.current, fresh);
      if (id === requestId.current) setState({ data, failed: false, loading: false });
    } catch {
      // keep what is on screen; only a first load with no data shows the error
      if (id === requestId.current) setState((s) => ({ ...s, failed: true, loading: false }));
    }
  }, []);

  // Range change and first load.
  useEffect(() => {
    void load(false);
  }, [range, load]);

  const refetch = useCallback(() => load(true), [load]);

  // Socket refetch, at most every 5 seconds.
  useEffect(() => {
    const onEvent = () => {
      const wait = lastFetch.current + SOCKET_REFETCH_MS - Date.now();
      if (wait <= 0) {
        void load(true);
      } else if (!trailing.current) {
        trailing.current = setTimeout(() => {
          trailing.current = null;
          void load(true);
        }, wait);
      }
    };
    let bound: ReturnType<typeof getSocket> = null;
    const bind = () => {
      const socket = getSocket();
      if (!socket || socket === bound) return;
      if (bound) REFETCH_EVENTS.forEach((e) => bound?.off(e, onEvent));
      bound = socket;
      REFETCH_EVENTS.forEach((e) => socket.on(e, onEvent));
    };
    bind();
    // The socket may connect after the page opens (reload on the Dashboard): look again until it is there.
    const poll = setInterval(bind, 2000);
    return () => {
      clearInterval(poll);
      if (trailing.current) clearTimeout(trailing.current);
      trailing.current = null;
      if (bound) REFETCH_EVENTS.forEach((e) => bound?.off(e, onEvent));
    };
  }, [load]);

  return { ...state, refetch };
}
