import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Gauge, Hourglass, PackageCheck, Truck } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, EmptyState, Skeleton, Table, Tabs, Tag, Tile } from '../components/ui-v2';
import { formatCurrency } from '../utils/format';
import { DateRange } from './orders/DateRange';
import { presetOf, rangePhrase } from './orders/urlState';
import { buildColumns } from './deliveries/columns';
import { count, PARTNER_TABS } from './deliveries/model';
import { parseView, rangeOf, writeView, type DeliveriesView } from './deliveries/urlState';
import { useDeliveries } from './deliveries/useDeliveries';

/**
 * The Deliveries page (M4-T30, F-700 to F-702, F-710), built from docs/mockups/v2/deliveries.html.
 * Agents and 3PLs share one table. The tab, the dates and the open partner are in the URL, so a copied link opens the same view.
 */
export function Deliveries() {
  useV2Page();
  const [search, setSearch] = useSearchParams();
  const view = useMemo(() => parseView(search), [search]);
  const range = useMemo(() => rangeOf(view), [view]);
  const data = useDeliveries(range, view.tab);

  const go = useCallback((next: DeliveriesView, replace = false) => setSearch(writeView(next), { replace }), [setSearch]);

  const { list, summary } = data;
  const target = summary?.deliverySuccess.target ?? 60;
  const phrase = rangePhrase(range);
  const columns = useMemo(
    () => buildColumns({ target, total: list?.total ?? null, canSwitch: false, onSwitch: () => undefined }),
    [target, list?.total],
  );

  const tiles = summary;
  const rate = tiles?.deliverySuccess.rate;
  const gap = tiles?.deliverySuccess.gapPoints ?? null;
  const delivered = tiles?.delivered;

  return (
    <section className="deliveries">
      <div className="head">
        <div>
          <h1>Deliveries</h1>
          <p>Delivery agents and 3PL companies do the same job, so they share one list.</p>
        </div>
        <div className="hd-actions">
          <DateRange range={range} onRange={(r) => go({ ...view, from: r.from, to: r.to })} />
        </div>
      </div>

      <div className="grid kpis k5" style={{ marginTop: 0 }}>
        <Tile
          icon={<Truck />}
          tone="pine"
          value={count(tiles?.outNow.orders)}
          label="Out for delivery now"
          footer={<><span>{tiles ? `Across ${tiles.outNow.partners} ${tiles.outNow.partners === 1 ? 'partner' : 'partners'}` : '—'}</span><Tag>Live</Tag></>}
        />
        <Tile
          icon={<Clock />}
          tone="gold"
          value={count(tiles?.waiting.orders)}
          label="Waiting to dispatch"
          footer={
            <>
              <span>{tiles?.waiting.oldestDays == null ? 'None waiting' : `Oldest ${tiles.waiting.oldestDays} ${tiles.waiting.oldestDays === 1 ? 'day' : 'days'}`}</span>
              {tiles && tiles.waiting.orders > 0 && <Tag tone="warn">Dispatch</Tag>}
            </>
          }
        />
        <Tile
          icon={<PackageCheck />}
          tone="mint"
          value={count(delivered?.orders)}
          label={presetOf(range) === 'month' ? 'Delivered this month' : `Delivered ${phrase}`}
          footer={<span>{delivered?.revenue === undefined ? 'Delivery date' : `${formatCurrency(delivered.revenue, delivered.currency)} revenue`}</span>}
        />
        <Tile
          icon={<Gauge />}
          tone="coral"
          value={rate?.value == null ? '—' : `${Math.round(rate.value)}%`}
          label="Delivery success"
          footer={
            <>
              <span>{rate?.value == null ? 'No closed orders yet' : `Target ${target}%, closed orders`}</span>
              {gap !== null && (gap > 0 ? <Tag tone="bad">{Math.round(gap)} pts under</Tag> : <Tag tone="ok">On target</Tag>)}
            </>
          }
        />
        <Tile
          icon={<Hourglass />}
          tone="gold"
          value="—"
          label="Cash still with agents and 3PLs"
          footer={<span>Shows once payouts are recorded</span>}
        />
      </div>

      <div className="card dtwrap">
        <div className="ct">
          <h3>Delivery partners</h3>
          <span>Orders placed {phrase}</span>
        </div>
        <Tabs
          label="Partner type"
          className="ptabs"
          items={PARTNER_TABS.map((t) => ({ id: t.id, label: t.label, count: list ? count(list.counts[t.id]) : undefined }))}
          value={view.tab}
          onChange={(id) => go({ ...view, tab: id as DeliveriesView['tab'] })}
        />

        {data.loading && !list ? (
          <div style={{ padding: 20 }} aria-busy="true" aria-label="Loading delivery partners">
            <Skeleton height={44} />
            <Skeleton height={44} className="skelgap" />
            <Skeleton height={44} className="skelgap" />
          </div>
        ) : data.error && !list ? (
          <EmptyState title={data.error} action={<Button onClick={() => void data.refetch()}>Try again</Button>} />
        ) : list && list.rows.length === 0 ? (
          <EmptyState title="No delivery partners match." />
        ) : list ? (
          <Table label="Delivery partners" className="dt" columns={columns} rows={list.rows} rowKey={(r) => r.partnerId} />
        ) : null}

        <p className="dnote">
          <b>Delivery fee</b> is what we pay whoever delivers the order. Each partner has one fee rule. The partner keeps the fee from the cash it collects and hands in the rest, so expected cash = cash collected &minus; fees.
          Delivery success counts closed orders only: delivered &divide; (delivered + failed + returned).
        </p>
      </div>
    </section>
  );
}
