import { format } from 'date-fns';
import { financeOverviewService } from '../../../services/finance-overview.service';
import { useConfigStore } from '../../../stores/configStore';
import { BlockError } from '../../dashboard/blocks/Frame';
import { rangePhrase } from '../../orders/urlState';
import { useBlock } from '../profit/useBlock';
import { useFinanceRange } from '../profit/range';
import { ReconciliationCard } from './ReconciliationCard';
import { TileSkeletons, Tiles } from './Tiles';

/** The Finance range can hold the store default's end of day as an instant; the overview API takes store days. */
const asDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : format(new Date(v), 'yyyy-MM-dd'));

/**
 * The Finance Overview tab (M5-T34, F-902, F-907, F-927), built from docs/mockups/v2/finance.html#p-overview.
 * Six tiles, then the payout reconciliation. The dates are the Finance date control of the page (this month when none is chosen),
 * the same range the cards below it use. Each tile and the reconciliation fail on their own.
 */
export function FinanceOverview() {
  const range = useFinanceRange();
  const from = asDay(range.from);
  const to = asDay(range.to);
  const block = useBlock(`overview|${from}|${to}`, () => financeOverviewService.get({ from, to }));
  const storeCurrency = useConfigStore((s) => s.currency);
  const { data } = block;
  const currency = data?.currency ?? storeCurrency ?? 'GHS';

  return (
    <div className={`fov${block.status === 'loading' && data ? ' busy' : ''}`} aria-busy={block.status === 'loading'}>
      <p className="ink3 fov-note">Cash and profit {rangePhrase({ from, to })}. Cash outstanding and runway are as of today.</p>

      {block.status === 'failed' && !data ? (
        <BlockError name="The Finance overview" onRetry={block.retry} />
      ) : (
        <>
          <div className="grid kpis k6">
            {data ? <Tiles tiles={data.tiles} currency={currency} onRetry={block.retry} /> : <TileSkeletons />}
          </div>
          {data && <ReconciliationCard data={data.reconciliation} range={{ from: data.from, to: data.to }} currency={currency} onRetry={block.retry} />}
        </>
      )}
    </div>
  );
}
