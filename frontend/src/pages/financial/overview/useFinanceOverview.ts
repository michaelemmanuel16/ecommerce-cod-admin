import { useCallback, useEffect, useRef, useState } from 'react';
import { financeOverviewService, type FinanceOverview, type RangeParams } from '../../../services/finance-overview.service';

/** One overview for one range. The newest ask wins; a range change keeps the old figures on screen until the answer arrives. */
export function useFinanceOverview(range: RangeParams) {
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ticket = useRef(0);

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++ticket.current;
    if (!quiet) { setLoading(true); setError(null); }
    try {
      const next = await financeOverviewService.get(range, quiet);
      if (mine !== ticket.current) return;
      setData(next);
      setError(null);
    } catch {
      if (mine !== ticket.current) return;
      setError('The overview could not load.');
    }
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { void load(false); }, [load]);
  // Stable between renders of one range, so a retry button does not re-render for nothing
  const refetch = useCallback(() => { void load(true); }, [load]);
  return { data, loading, error, refetch };
}
