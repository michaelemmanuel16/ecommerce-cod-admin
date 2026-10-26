import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, EmptyState } from '../../../components/ui-v2';
import { useConfigStore } from '../../../stores/configStore';
import { DateRange } from '../../orders/DateRange';
import { parseRange, presetRange, rangePhrase } from '../../orders/urlState';
import { ReconciliationCard } from './ReconciliationCard';
import { TileSkeletons, Tiles } from './Tiles';
import { useFinanceOverview } from './useFinanceOverview';

/**
 * The Finance Overview tab (M5-T34, F-902, F-907, F-927), built from docs/mockups/v2/finance.html#p-overview.
 * Six tiles, then the payout reconciliation. The dates are in the URL (`from`, `to`), so a copied link opens the same view;
 * no dates means this month. Each tile and the reconciliation fail on their own.
 */
export function FinanceOverview() {
  const [search, setSearch] = useSearchParams();
  const range = useMemo(() => {
    const dated = parseRange(search.get('from'), search.get('to'));
    return dated && dated.from <= dated.to ? dated : presetRange('month');
  }, [search]);
  const { data, loading, error, refetch } = useFinanceOverview(range);
  const storeCurrency = useConfigStore((s) => s.currency);
  const currency = data?.currency ?? storeCurrency ?? 'GHS';

  const setRange = useCallback((r: { from: string; to: string }) => {
    const next = new URLSearchParams(search);
    next.set('from', r.from);
    next.set('to', r.to);
    setSearch(next, { replace: true });
  }, [search, setSearch]);

  return (
    <div className={`fov${loading && data ? ' busy' : ''}`} aria-busy={loading}>
      <div className="fov-bar">
        <p className="ink3">Cash and profit {rangePhrase(range)}. Cash outstanding and runway are as of today.</p>
        <div className="hd-actions"><DateRange range={range} onRange={setRange} /></div>
      </div>

      {error && !data ? (
        <div className="card" role="alert">
          <EmptyState title={error} action={<Button onClick={refetch}>Try again</Button>} />
        </div>
      ) : (
        <>
          <div className="grid kpis k6">
            {data ? <Tiles tiles={data.tiles} currency={currency} onRetry={refetch} /> : <TileSkeletons />}
          </div>
          {data && <ReconciliationCard data={data.reconciliation} range={{ from: data.from, to: data.to }} currency={currency} onRetry={refetch} />}
        </>
      )}
    </div>
  );
}
