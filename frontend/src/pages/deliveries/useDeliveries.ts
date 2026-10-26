import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deliveryPartnersService,
  type FailureReasons,
  type FeeRule,
  type PartnerList,
  type PartnerSummary,
  type PartnerTab,
  type ReturnsSummary,
  type RangeParams,
  type WaitingList,
} from '../../services/delivery-partners.service';
import { ORDER_EVENTS, useSocketRefresh } from '../orders/useOrderList';

/** The waiting list is a short card on the page; the full list is in Orders. */
const WAITING_LIMIT = 5;
const PARTNER_EVENTS = ['agent:availability_changed', 'agent:updated'] as const;
const DELIVERY_EVENTS = [...ORDER_EVENTS, ...PARTNER_EVENTS];

/**
 * Everything the Deliveries page reads for one view: the table (tab = the API `type`, so it follows the range and the tab),
 * the five tiles and the reasons card (range only), the waiting list (no view: loaded on mount) and the returns summary
 * (null when the role may not read stock; range only). One answer replaces the last, the newest ask wins. Order and
 * availability events refresh all of it quietly, except the returns line.
 */
export function useDeliveries(range: RangeParams, tab: PartnerTab) {
  const [list, setList] = useState<PartnerList | null>(null);
  const [summary, setSummary] = useState<PartnerSummary | null>(null);
  const [reasons, setReasons] = useState<FailureReasons | null>(null);
  /** null: the role may not see it (the API answered 403) or it has not loaded. */
  const [waiting, setWaiting] = useState<WaitingList | null>(null);
  /** True until the first answer for the current view of the table. */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ range, tab });
  latest.current = { range, tab };
  const listTicket = useRef(0);
  const tilesTicket = useRef(0);
  const waitingTicket = useRef(0);

  const loadList = useCallback(async (quiet: boolean) => {
    const mine = ++listTicket.current;
    const wanted = latest.current;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    const [next] = await Promise.allSettled([deliveryPartnersService.list(wanted.range, wanted.tab, quiet)]);
    if (mine !== listTicket.current) return; // a newer view asked meanwhile
    if (next.status === 'fulfilled') setList(next.value);
    setLoading(false);
    setError(next.status === 'rejected' ? 'The delivery partners could not load.' : null);
  }, []);

  const loadTiles = useCallback(async (quiet: boolean) => {
    const mine = ++tilesTicket.current;
    const wanted = latest.current.range;
    const [nextSummary, nextReasons] = await Promise.allSettled([
      deliveryPartnersService.summary(wanted, quiet),
      deliveryPartnersService.failureReasons(wanted, quiet),
    ]);
    if (mine !== tilesTicket.current) return;
    if (nextSummary.status === 'fulfilled') setSummary(nextSummary.value);
    if (nextReasons.status === 'fulfilled') setReasons(nextReasons.value);
  }, []);

  const loadWaiting = useCallback(async (quiet: boolean) => {
    const mine = ++waitingTicket.current;
    const [next] = await Promise.allSettled([deliveryPartnersService.waiting(WAITING_LIMIT, quiet)]);
    if (mine === waitingTicket.current && next.status === 'fulfilled') setWaiting(next.value); // null: the role may not see it (403)
  }, []);

  useEffect(() => {
    void loadList(false);
  }, [range.from, range.to, tab, loadList]);
  useEffect(() => {
    void loadTiles(false);
  }, [range.from, range.to, loadTiles]);
  useEffect(() => {
    void loadWaiting(false);
  }, [loadWaiting]);

  // The returns line follows the dates only: an order or availability event does not change it.
  const [returns, setReturns] = useState<ReturnsSummary | null>(null);
  useEffect(() => {
    let live = true;
    deliveryPartnersService.returnsSummary(range, true).then((r) => live && setReturns(r), () => live && setReturns(null));
    return () => { live = false; };
  }, [range.from, range.to]);

  const refetch = useCallback(
    () => Promise.all([loadList(true), loadTiles(true), loadWaiting(true)]).then(() => undefined),
    [loadList, loadTiles, loadWaiting],
  );
  useSocketRefresh(DELIVERY_EVENTS, refetch);

  /** A fee rule save returns the rules in force: the partner's row takes them, with no refetch of the table. */
  const setFeeRule = useCallback(
    (partnerId: number, feeRule: FeeRule) =>
      setList((l) => l && { ...l, rows: l.rows.map((r) => (r.partnerId === partnerId ? { ...r, feeRule } : r)) }),
    [],
  );

  return { list, summary, reasons, waiting, returns, loading, error, refetch, setFeeRule };
}
