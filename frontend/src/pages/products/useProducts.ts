import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { productsService, type ProductList, type ProductsSummary, type ProductTab } from '../../services/products.service';
import { getSocket } from '../../services/socket';
import { ORDER_EVENTS, SOCKET_REFRESH_MS } from '../orders/useOrderList';

/**
 * The Products page reads: the table (server tab and month) and the four tiles (month only). One answer replaces the last, the
 * newest ask wins. Order events refresh both quietly (a delivery moves stock and the delivered figures).
 */
export function useProducts(tab: ProductTab, month: string | null) {
  const [list, setList] = useState<ProductList | null>(null);
  /** null: the role may not see cost (403) or it has not loaded. */
  const [summary, setSummary] = useState<ProductsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listTicket = useRef(0);
  const summaryTicket = useRef(0);

  const loadList = useCallback(async (quiet: boolean) => {
    const mine = ++listTicket.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const next = await productsService.list(tab, month, quiet);
      if (mine !== listTicket.current) return;
      setList(next);
      setError(null);
    } catch {
      if (mine === listTicket.current) setError('The products could not load.');
    } finally {
      if (mine === listTicket.current) setLoading(false);
    }
  }, [tab, month]);

  const loadSummary = useCallback(async (quiet: boolean) => {
    const mine = ++summaryTicket.current;
    try {
      const next = await productsService.summary(month, quiet);
      if (mine === summaryTicket.current) setSummary(next);
    } catch (e) {
      if (mine === summaryTicket.current && axios.isAxiosError(e) && e.response?.status === 403) setSummary(null);
    }
  }, [month]);

  useEffect(() => {
    void loadList(false);
  }, [loadList]);
  useEffect(() => {
    void loadSummary(false);
  }, [loadSummary]);

  const refetch = useCallback(() => Promise.all([loadList(true), loadSummary(true)]).then(() => undefined), [loadList, loadSummary]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refetch(), SOCKET_REFRESH_MS);
    };
    ORDER_EVENTS.forEach((e) => socket.on(e, refresh));
    return () => {
      clearTimeout(timer);
      ORDER_EVENTS.forEach((e) => socket.off(e, refresh));
    };
  }, [refetch]);

  return { list, summary, loading, error, refetch };
}
