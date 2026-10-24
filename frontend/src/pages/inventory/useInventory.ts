import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryService, type LowStockProduct, type Overview, type PhysicalProduct, type Transfer } from '../../services/inventory.service';

/** The Recent transfers card is a short list; the full history is in the modal. */
export const RECENT_LIMIT = 6;

interface InventoryState {
  overview: Overview | null;
  recent: Transfer[] | null;
  products: PhysicalProduct[];
  /** Products under their days-of-cover limit. Empty when the role may not read them. */
  low: LowStockProduct[];
  /** True until the first answer. */
  loading: boolean;
  error: string | null;
}

/**
 * Everything the Inventory page reads: the cards and the table (one overview answer, filtered in the browser), the recent
 * transfers, the product list for the pickers and the low-stock list. The newest ask wins. `refetch` runs after every
 * stock change, so the cards, the table and the transfers move together (F-655).
 */
export function useInventory() {
  const [state, setState] = useState<InventoryState>({ overview: null, recent: null, products: [], low: [], loading: true, error: null });
  const ticket = useRef(0);

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    const [overview, recent, products, low] = await Promise.allSettled([
      inventoryService.overview(quiet),
      inventoryService.transfers({ limit: RECENT_LIMIT }, quiet),
      inventoryService.products(),
      inventoryService.lowStock(),
    ]);
    if (mine !== ticket.current) return;
    setState((s) => ({
      overview: overview.status === 'fulfilled' ? overview.value : s.overview,
      recent: recent.status === 'fulfilled' ? recent.value.transfers : s.recent,
      products: products.status === 'fulfilled' ? products.value : s.products,
      low: low.status === 'fulfilled' ? low.value : [],
      loading: false,
      error: overview.status === 'rejected' ? 'The stock figures could not load.' : null,
    }));
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);
  return { ...state, refetch };
}
