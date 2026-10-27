import { financeOverviewService } from '../../../services/finance-overview.service';
import { UnpaidByAgeCard } from '../../../components/financial/UnpaidByAgeCard';
import { useConfigStore } from '../../../stores/configStore';
import { BlockError } from '../../dashboard/blocks/Frame';
import { useBlock } from '../profit/useBlock';
import { useFinanceRange } from '../profit/range';
import { ReconciliationCard } from './ReconciliationCard';
import { TileSkeletons, Tiles } from './Tiles';

/**
 * The Finance Overview tab (M5-T34, F-902, F-907, F-927), built from docs/mockups/v2/finance.html#p-overview.
 * Six tiles, then the payout reconciliation beside the unpaid orders by age. The dates are the Finance date control of the page (this month when none is chosen),
 * the same range the cards below it use. Each tile and the reconciliation fail on their own.
 */
export function FinanceOverview() {
  const range = useFinanceRange();
  const { from, to } = range;
  const block = useBlock(`overview|${from}|${to}`, () => financeOverviewService.get({ from, to }));
  const storeCurrency = useConfigStore((s) => s.currency);
  const { data } = block;
  // The card reads the overview's own answer (the one the Cash outstanding tile uses): no second aging request on this tab
  const unpaid = data && 'basis' in data.unpaidByAge ? data.unpaidByAge : null;
  const currency = data?.currency ?? storeCurrency ?? 'GHS';

  return (
    <div className={`fov vstack${block.status === 'loading' && data ? ' busy' : ''}`} aria-busy={block.status === 'loading'}>
      {block.status === 'failed' && !data ? (
        <BlockError name="The Finance overview" onRetry={block.retry} />
      ) : (
        <>
          <div className="grid kpis k6">
            {data ? <Tiles tiles={data.tiles} currency={currency} onRetry={block.retry} /> : <TileSkeletons />}
          </div>
          <div className="grid two">
            {data ? <ReconciliationCard data={data.reconciliation} range={{ from: data.from, to: data.to }} currency={currency} onRetry={block.retry} /> : <div />}
            <UnpaidByAgeCard data={unpaid} failed={!!data && !unpaid} onRetry={block.retry} />
          </div>
        </>
      )}
    </div>
  );
}
