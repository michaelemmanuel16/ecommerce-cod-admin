import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryService, type LowStockProduct, type Overview, type PhysicalProduct, type Transfer } from '../../services/inventory.service';
import { ORDER_EVENTS, useSocketRefresh } from '../orders/useOrderList';

const RECENT_LIMIT = 6;

interface InventoryState {
  overview: Overview | null;
  recent: Transfer[] | null;
  /** Products under their days-of-cover limit. Empty when the role may not read them. */
  low: LowStockProduct[];
  /** True until the first answer. */
  loading: boolean;
  error: string | null;
  /** Goes up with every answer, so an open history modal reloads with the page. */
  revision: number;
}

/**
 * Everything the Inventory page reads: the cards and the table (one overview answer, filtered in the browser), the recent
 * transfers and the low-stock list, which reload together; and the product list for the pickers, which loads once. The
 * newest ask wins. `refetch` runs after every stock change, and the page refreshes quietly on the same order events as
 * Deliveries, because stock moves when an order is delivered or returned (F-657). The server sends no transfer event.
 */
export function useInventory() {
  const [state, setState] = useState<InventoryState>({ overview: null, recent: null, low: [], loading: true, error: null, revision: 0 });
  const [products, setProducts] = useState<PhysicalProduct[]>([]);
  const ticket = useRef(0);

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    const [overview, recent, low] = await Promise.allSettled([
      inventoryService.overview(quiet),
      inventoryService.transfers({ limit: RECENT_LIMIT }, quiet),
      inventoryService.lowStock(),
    ]);
    if (mine !== ticket.current) return;
    setState((s) => ({
      overview: overview.status === 'fulfilled' ? overview.value : s.overview,
      recent: recent.status === 'fulfilled' ? recent.value.transfers : s.recent,
      low: low.status === 'fulfilled' ? low.value : [],
      loading: false,
      error: overview.status === 'rejected' ? 'The stock figures could not load.' : null,
      revision: s.revision + 1,
    }));
  }, []);

  useEffect(() => {
    void load(false);
    inventoryService.products().then(setProducts).catch(() => undefined);
  }, [load]);

  useSocketRefresh(ORDER_EVENTS, () => load(true));

  const refetch = useCallback(() => load(true), [load]);
  return { ...state, products, refetch };
}
