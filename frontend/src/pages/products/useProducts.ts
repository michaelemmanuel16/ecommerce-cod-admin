import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { productsService, type ProductList, type ProductsSummary, type ProductTab } from '../../services/products.service';
import { getSocket } from '../../services/socket';
import { ORDER_EVENTS, SOCKET_REFRESH_MS } from '../orders/useOrderList';

interface ProductsState {
  list: ProductList | null;
  /** null: the role may not see cost (403) or it has not loaded. */
  summary: ProductsSummary | null;
  loading: boolean;
  error: string | null;
}

/**
 * The Products page reads: the table (server tab and month) and the four tiles. One answer replaces the last, the newest ask
 * wins. Order events refresh it quietly (a delivery moves stock and the delivered figures).
 */
export function useProducts(tab: ProductTab, month: string | null) {
  const [state, setState] = useState<ProductsState>({ list: null, summary: null, loading: true, error: null });
  const latest = useRef({ tab, month });
  latest.current = { tab, month };
  const ticket = useRef(0);
  const viewKey = `${tab}|${month ?? ''}`;

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    const wanted = latest.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    const [list, summary] = await Promise.allSettled([
      productsService.list(wanted.tab, wanted.month, quiet),
      productsService.summary(wanted.month, quiet),
    ]);
    if (mine !== ticket.current) return;
    setState((s) => ({
      list: list.status === 'fulfilled' ? list.value : s.list,
      summary: summary.status === 'fulfilled' ? summary.value : (summary.reason && axios.isAxiosError(summary.reason) && summary.reason.response?.status === 403 ? null : s.summary),
      loading: false,
      error: list.status === 'rejected' ? 'The products could not load.' : null,
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
      ORDER_EVENTS.forEach((e) => socket.off(e, refresh));
    };
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);
  return { ...state, refetch };
}
