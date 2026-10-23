import { useCallback, useEffect, useRef, useState } from 'react';
import { customersService, type CustomerFilterParams, type CustomerListParams, type CustomerRow, type CustomerSummary } from '../../services/customers.service';
import type { PaginationMeta } from '../../types';

interface ListState {
  rows: CustomerRow[];
  pagination: PaginationMeta;
  summary: CustomerSummary | null;
  /** True until the first answer for the current view. */
  loading: boolean;
  error: string | null;
}

const EMPTY: PaginationMeta = { page: 1, limit: 25, total: 0, pages: 0 };

/** The list, and the tiles and tab counts for the same filters (F-351). One answer replaces the last, newest ask wins. */
export function useCustomerList(params: CustomerListParams, filters: CustomerFilterParams) {
  const [state, setState] = useState<ListState>({ rows: [], pagination: EMPTY, summary: null, loading: true, error: null });
  const latest = useRef({ params, filters });
  latest.current = { params, filters };
  const ticket = useRef(0);
  const viewKey = JSON.stringify(params);

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    const wanted = latest.current;
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    const [list, summary] = await Promise.allSettled([
      customersService.listCustomers(wanted.params, quiet),
      customersService.getSummary(wanted.filters, quiet),
    ]);
    if (mine !== ticket.current) return; // a newer view asked meanwhile
    setState((s) => ({
      rows: list.status === 'fulfilled' ? list.value.rows : s.rows,
      pagination: list.status === 'fulfilled' ? list.value.pagination : s.pagination,
      summary: summary.status === 'fulfilled' ? summary.value : s.summary,
      loading: false,
      error: list.status === 'rejected' ? 'The customers could not load.' : null,
    }));
  }, []);

  useEffect(() => {
    void load(false);
  }, [viewKey, load]);

  const refetch = useCallback(() => load(true), [load]);
  return { ...state, refetch };
}
