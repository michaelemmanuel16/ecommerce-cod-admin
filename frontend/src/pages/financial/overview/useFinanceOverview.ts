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
    const [next] = await Promise.allSettled([financeOverviewService.get(range, quiet)]);
    if (mine !== ticket.current) return;
    if (next.status === 'fulfilled') { setData(next.value); setError(null); }
    else setError('The overview could not load.');
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => { void load(false); }, [load]);
  return { data, loading, error, refetch: () => load(true) };
}
