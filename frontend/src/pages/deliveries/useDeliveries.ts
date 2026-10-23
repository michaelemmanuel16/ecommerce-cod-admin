import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deliveryPartnersService,
  type FailureReasons,
  type PartnerList,
  type PartnerSummary,
  type PartnerTab,
  type RangeParams,
  type WaitingList,
} from '../../services/delivery-partners.service';
import { getSocket } from '../../services/socket';
import { ORDER_EVENTS, SOCKET_REFRESH_MS } from '../orders/useOrderList';

/** The waiting list is a short card on the page; the full list is in Orders. */
const WAITING_LIMIT = 5;
const PARTNER_EVENTS = ['agent:availability_changed', 'agent:updated'] as const;

interface DeliveriesState {
  list: PartnerList | null;
  summary: PartnerSummary | null;
  reasons: FailureReasons | null;
  /** null: the role may not see it (the API answered 403) or it has not loaded. */
  waiting: WaitingList | null;
  /** True until the first answer for the current view. */
  loading: boolean;
  error: string | null;
}

/**
 * Everything the Deliveries page reads for one view: the table (tab = the API `type`), the five tiles, the reasons card
 * and the waiting list. One answer replaces the last, the newest ask wins. Order and availability events refresh it quietly.
 */
export function useDeliveries(range: RangeParams, tab: PartnerTab) {
  const [state, setState] = useState<DeliveriesState>({ list: null, summary: null, reasons: null, waiting: null, loading: true, error: null });
  const latest = useRef({ range, tab });
  latest.current = { range, tab };
  const ticket = useRef(0);
  const viewKey = `${range.from}|${range.to}|${tab}`;

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    const wanted = latest.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    const [list, summary, reasons, waiting] = await Promise.allSettled([
      deliveryPartnersService.list(wanted.range, wanted.tab, quiet),
      deliveryPartnersService.summary(wanted.range, quiet),
      deliveryPartnersService.failureReasons(wanted.range, quiet),
      deliveryPartnersService.waiting(WAITING_LIMIT, quiet),
    ]);
    if (mine !== ticket.current) return; // a newer view asked meanwhile
    setState((s) => ({
      list: list.status === 'fulfilled' ? list.value : s.list,
      summary: summary.status === 'fulfilled' ? summary.value : s.summary,
      reasons: reasons.status === 'fulfilled' ? reasons.value : s.reasons,
      waiting: waiting.status === 'fulfilled' ? waiting.value : null,
      loading: false,
      error: list.status === 'rejected' ? 'The delivery partners could not load.' : null,
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
    const events = [...ORDER_EVENTS, ...PARTNER_EVENTS];
    events.forEach((e) => socket.on(e, refresh));
    return () => {
      clearTimeout(timer);
      // this page's handler only: the toast and the other stores listen to the same events
      events.forEach((e) => socket.off(e, refresh));
    };
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);
  return { ...state, refetch };
}
