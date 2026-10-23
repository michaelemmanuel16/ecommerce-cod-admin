import { useCallback, useEffect, useRef, useState } from 'react';
import { reportsService } from '../../services/reports.service';
import { apiMessage } from '../orders/importText';
import type { ReportBody, ReportParams, ReportTabId } from './types';

interface State<T> {
  data: T | null;
  /** The params `data` was loaded for. */
  key: string | null;
  loading: boolean;
  /** The request itself failed (network, 401, 403, 400): no block data. */
  failed: boolean;
  /** The server's sentence for a failed request, for example "The range is over 366 days. Narrow it." */
  message: string | null;
}

const keyOf = (tab: ReportTabId, p: ReportParams) => `${tab}|${p.from}|${p.to}|${p.compare}`;

/**
 * One report tab. It loads when `enabled` and the range or compare switch changed; a tab that is not open does not
 * call the API. While a new range loads, the old figures stay on screen (dimmed by the page).
 */
export function useReport<T extends ReportBody>(tab: ReportTabId, params: ReportParams, enabled: boolean) {
  const [state, setState] = useState<State<T>>({ data: null, key: null, loading: enabled, failed: false, message: null });
  const requestId = useRef(0);
  /** The params the figures on screen were loaded for: a tab that is opened again with the same params does not reload. */
  const loaded = useRef<string | null>(null);
  const key = keyOf(tab, params);
  const latest = useRef(params);
  latest.current = params;

  const load = useCallback(async (fresh: boolean) => {
    const id = ++requestId.current;
    const asked = keyOf(tab, latest.current);
    setState((s) => ({ ...s, loading: true, failed: false, message: null }));
    try {
      const data = await reportsService.get<T>(tab, latest.current, fresh);
      if (id === requestId.current) {
        loaded.current = asked;
        setState({ data, key: asked, loading: false, failed: false, message: null });
      }
    } catch (err) {
      const message = await apiMessage(err, '');
      if (id === requestId.current) setState((s) => ({ ...s, loading: false, failed: true, message: message || null }));
    }
  }, [tab]);

  useEffect(() => {
    if (!enabled || loaded.current === key) return;
    void load(false);
  }, [enabled, key, load]);

  const refetch = useCallback(() => load(true), [load]);
  return { ...state, refetch, stale: state.key !== key };
}
