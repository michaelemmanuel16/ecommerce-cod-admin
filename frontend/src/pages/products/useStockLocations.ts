import { useEffect, useState } from 'react';
import { productsService, type StockLocationOption } from '../../services/products.service';
import { shipmentsService, type Shipment } from '../../services/shipments.service';

/** The holders change rarely: one answer for the life of the page. A failure is not kept, so the next ask tries again. */
let cached: Promise<StockLocationOption[]> | null = null;
export function stockLocations(): Promise<StockLocationOption[]> {
  cached ??= productsService.stockLocations().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}
/** For tests. */
export const resetStockLocations = (): void => {
  cached = null;
};

/**
 * Where stock was last received, for any product: the destination of the most recently received shipment, if it is still an
 * active holder. With none there is no default and the user picks.
 */
export function defaultLocation(locations: StockLocationOption[], received: Shipment[]): number | null {
  const last = received
    .filter((s) => s.destinationLocation && s.receivedAt)
    .sort((a, b) => b.receivedAt!.localeCompare(a.receivedAt!))[0];
  const id = last?.destinationLocation?.id;
  return id != null && locations.some((l) => l.id === id) ? id : null;
}

/** The holders and the default one, loaded when `enabled`. `defaultId` is null until known, and when there is none. */
export function useStockLocations(enabled = true) {
  const [state, setState] = useState<{ locations: StockLocationOption[]; defaultId: number | null; error: boolean }>({ locations: [], defaultId: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    Promise.all([stockLocations(), shipmentsService.list('received', true).catch(() => [] as Shipment[])]).then(
      ([locations, received]) => live && setState({ locations, defaultId: defaultLocation(locations, received), error: false }),
      () => live && setState((s) => ({ ...s, error: true })),
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return state;
}
