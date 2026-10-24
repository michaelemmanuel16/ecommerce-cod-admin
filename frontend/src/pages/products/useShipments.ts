import { useCallback, useEffect, useRef, useState } from 'react';
import { shipmentsService, type Shipment, type ShipmentSummary } from '../../services/shipments.service';

/** The shipments pane reads: the three tiles and every shipment (the tabs filter the list on the page, the counts come from it). */
export function useShipments() {
  const [state, setState] = useState<{ list: Shipment[] | null; summary: ShipmentSummary | null; loading: boolean; error: string | null }>({
    list: null, summary: null, loading: true, error: null,
  });
  const ticket = useRef(0);

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    const [list, summary] = await Promise.allSettled([shipmentsService.list(undefined, true), shipmentsService.summary(true)]);
    if (mine !== ticket.current) return;
    setState((s) => ({
      list: list.status === 'fulfilled' ? list.value : s.list,
      summary: summary.status === 'fulfilled' ? summary.value : s.summary,
      loading: false,
      error: list.status === 'rejected' ? 'The shipments could not load.' : null,
    }));
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);
  return { ...state, refetch };
}
