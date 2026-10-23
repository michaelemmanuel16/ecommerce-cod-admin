import { useCallback, useEffect, useRef, useState } from 'react';
import { ordersService, type OrderCounts, type OrderListParams, type OrderListRow } from '../../services/orders.service';
import { getSocket } from '../../services/socket';
import type { PaginationMeta } from '../../types';

/** The events the backend emits for orders (sockets/index.ts), all tenant-scoped. Any of them refreshes the list. */
export const ORDER_EVENTS = ['order:created', 'order:updated', 'order:status_changed', 'order:assigned', 'orders:deleted'] as const;
/** Several events often arrive together (a bulk change): one refresh answers them all. */
export const SOCKET_REFRESH_MS = 400;

interface ListState {
  rows: OrderListRow[];
  pagination: PaginationMeta;
  counts: OrderCounts | null;
  /** True until the first answer for the current view. */
  loading: boolean;
  error: string | null;
}

const EMPTY: PaginationMeta = { page: 1, limit: 25, total: 0, pages: 0 };

/** The list and the tab counts for one view, refreshed on socket events without the table flashing. */
export function useOrderList(params: OrderListParams) {
  const [state, setState] = useState<ListState>({ rows: [], pagination: EMPTY, counts: null, loading: true, error: null });
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const ticket = useRef(0);
  const viewKey = JSON.stringify(params);

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    const wanted = paramsRef.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    const [list, counts] = await Promise.allSettled([
      ordersService.listOrders(wanted, quiet),
      ordersService.getCounts(wanted, quiet),
    ]);
    if (mine !== ticket.current) return; // a newer view asked meanwhile
    setState((s) => ({
      rows: list.status === 'fulfilled' ? list.value.rows : s.rows,
      pagination: list.status === 'fulfilled' ? list.value.pagination : s.pagination,
      counts: counts.status === 'fulfilled' ? counts.value : s.counts,
      loading: false,
      error: list.status === 'rejected' ? 'The orders could not load.' : null,
    }));
  }, []);

  useEffect(() => {
    void load(false);
  }, [viewKey, load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(true), SOCKET_REFRESH_MS);
    };
    ORDER_EVENTS.forEach((e) => socket.on(e, refresh));
    return () => {
      clearTimeout(timer);
      // this page's handler only: the toast and the other stores listen to the same events
      ORDER_EVENTS.forEach((e) => socket.off(e, refresh));
    };
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);
  return { ...state, refetch };
}
