import { useState } from 'react';
import clsx from 'clsx';
import { useV2Page } from '../components/shell/useV2Page';
import { PageHeader } from './dashboard/blocks/Header';
import { BlockError, BlockFrame, SkeletonCard } from './dashboard/blocks/Frame';
import { LadderCard } from './dashboard/blocks/Ladder';
import { QuestsRow } from './dashboard/blocks/Quests';
import { TilesRow } from './dashboard/blocks/Tiles';
import { ChartCard } from './dashboard/blocks/ChartCard';
import { RecentOrdersCard } from './dashboard/blocks/RecentOrders';
import { useOwnerDashboard } from './dashboard/useOwnerDashboard';
import { isBlockError, type DashboardRange } from './dashboard/types';
import { Skeleton } from '../components/ui-v2';
import { getStoreCurrency } from '../utils/format';

/**
 * The owner Dashboard (M3-T39 to T41, F-200 to F-210), built from docs/mockups/v2/index.html#dash.
 * One call returns every block. Each block has its own skeleton and its own error with Retry. The page does no KPI
 * arithmetic: every figure, percentage, pace and tag comes from the API (services/dashboardService.ts).
 *
 * Not on the page yet because the API has no data for them: the margin chip (M5), the agent cards (M11) and
 * "Top this month" (M6). Their slots are left out, so the chart and the recent orders take the full width.
 */
export function Dashboard() {
  useV2Page();
  const [range, setRange] = useState<DashboardRange>('month');
  const { data, failed, loading, refetch } = useOwnerDashboard(range);

  const headerBlock = data?.header;
  const header = headerBlock && !isBlockError(headerBlock) ? headerBlock : null;
  const asOfDate = header?.asOfDate ?? null;
  const busy = loading && data !== null;
  // the store currency, for blocks that do not carry their own
  const currency = header?.currency ?? getStoreCurrency();
  const frame = { loading, failed, onRetry: refetch };
  // recentOrders is missing from the response when the viewer has no orders:view: the block is not shown at all
  const showOrders = !data || data.recentOrders !== undefined;

  return (
    <section className={clsx('dash', busy && 'busy')}>
      <PageHeader header={header} loading={loading} range={range} onRange={setRange} onRefresh={refetch} refreshing={loading} />
      {headerBlock && isBlockError(headerBlock) && <BlockError name="Header" onRetry={refetch} errorId={headerBlock.error.errorId} />}

      <BlockFrame name="Target ladder" block={data?.ladder} {...frame} skeleton={<SkeletonCard height={196} />}>
        {(ladder) => <LadderCard ladder={ladder} asOfDate={asOfDate} />}
      </BlockFrame>

      <BlockFrame name="Today's targets" block={data?.quests} {...frame} skeleton={<SkeletonCard height={92} />}>
        {(quests) => <QuestsRow quests={quests} currency={currency} />}
      </BlockFrame>

      <BlockFrame
        name="Driver tiles" block={data?.tiles} {...frame}
        skeleton={<div className="grid kpis">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={132} className="skelcard" />)}</div>}
      >
        {(tiles) => <TilesRow tiles={tiles} />}
      </BlockFrame>

      <ChartCard chart={data?.chart} drivers={data?.drivers} {...frame} asOfDate={asOfDate} />

      {showOrders && <RecentOrdersCard orders={data?.recentOrders} {...frame} />}
    </section>
  );
}
