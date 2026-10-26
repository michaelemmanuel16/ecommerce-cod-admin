import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Clock, Gauge, Hourglass, PackageCheck, Truck } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, EmptyState, Table, Tabs, Tag, Tile, useToast } from '../components/ui-v2';
import { formatCurrency } from '../utils/format';
import { wholePercent } from './dashboard/format';
import { DateRange } from './orders/DateRange';
import { presetOf, rangePhrase } from './orders/urlState';
import { buildColumns } from './deliveries/columns';
import { ListSkeleton } from './deliveries/ListSkeleton';
import { AddPartnerModal } from './deliveries/AddPartnerModal';
import { PartnerDrawer } from './deliveries/PartnerDrawer';
import { ReasonsCard } from './deliveries/ReasonsCard';
import { OutNowCard, WaitingCard } from './deliveries/WaitingCards';
import type { PartnerRow } from '../services/delivery-partners.service';
import { count, PARTNER_TABS } from './deliveries/model';
import { parseView, rangeOf, writeView, type DeliveriesView } from './deliveries/urlState';
import { useAvailabilitySwitch } from './deliveries/useAvailabilitySwitch';
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
  const { isAdmin, isManager } = usePermissions();
  const say = useToast();
  const [adding, setAdding] = useState(false);
  /** A partner just added: its drawer opens on Fees. */
  const [addedId, setAddedId] = useState<number | null>(null);

  const go = useCallback((next: DeliveriesView, replace = false) => setSearch(writeView(next), { replace }), [setSearch]);

  const { list, summary } = data;

  const setAvailability = useAvailabilitySwitch();
  const switchAvailability = useCallback(async (row: PartnerRow, on: boolean) => {
    if (await setAvailability({ id: row.partnerId, name: row.name }, on)) await data.refetch();
  }, [setAvailability, data.refetch]);
  const target = summary?.deliverySuccess.target ?? 60;
  const phrase = rangePhrase(range);
  const columns = useMemo(
    () => buildColumns({ target, total: list?.total ?? null, canSwitch: isManager, onSwitch: switchAvailability }),
    [target, list?.total, isManager, switchAvailability],
  );

  const rate = summary?.deliverySuccess.rate;
  const gap = summary?.deliverySuccess.gapPoints ?? null;
  const delivered = summary?.delivered;

  return (
    <section className="deliveries">
      <div className="head">
        <div>
          <h1>Deliveries</h1>
          <p>Delivery agents and 3PL companies do the same job, so they share one list.</p>
        </div>
        <div className="hd-actions">
          <DateRange range={range} onRange={(r) => go({ ...view, from: r.from, to: r.to })} />
          {isAdmin && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Add delivery partner
            </Button>
          )}
        </div>
      </div>

      <div className="grid kpis k5" style={{ marginTop: 0 }}>
        <Tile
          icon={<Truck />}
          tone="pine"
          value={count(summary?.outNow.orders)}
          label="Out for delivery now"
          footer={<><span>{summary ? `Across ${summary.outNow.partners} ${summary.outNow.partners === 1 ? 'partner' : 'partners'}` : '—'}</span><Tag>Live</Tag></>}
        />
        <Tile
          icon={<Clock />}
          tone="gold"
          value={count(summary?.waiting.orders)}
          label="Waiting to dispatch"
          footer={
            <>
              <span>{summary?.waiting.oldestDays == null ? 'None waiting' : `Oldest ${summary.waiting.oldestDays} ${summary.waiting.oldestDays === 1 ? 'day' : 'days'}`}</span>
              {summary && summary.waiting.orders > 0 && <Tag tone="warn">Dispatch</Tag>}
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
          value={rate?.value == null ? '—' : wholePercent(rate.value)}
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
          <ListSkeleton label="Loading delivery partners" rows={3} height={44} style={{ padding: 20 }} />
        ) : data.error && !list ? (
          <EmptyState title={data.error} action={<Button onClick={() => void data.refetch()}>Try again</Button>} />
        ) : list && list.rows.length === 0 ? (
          <EmptyState title="No delivery partners match." />
        ) : list ? (
          <Table label="Delivery partners" className="dt" columns={columns} rows={list.rows} rowKey={(r) => r.partnerId} onRowClick={(r) => go({ ...view, partner: r.partnerId })} />
        ) : null}

        <p className="dnote">
          <b>Delivery fee</b> is what we pay whoever delivers the order. Each partner has one fee rule. The partner keeps the fee from the cash it collects and hands in the rest, so expected cash = cash collected &minus; fees.
          Delivery success counts closed orders only: delivered &divide; (delivered + failed + returned).
        </p>
      </div>

      <div className="grid two">
        <ReasonsCard reasons={data.reasons} returns={data.returns} phrase={phrase} range={range} />
        <div className="stack">
          {data.waiting && <WaitingCard waiting={data.waiting} />}
          {list && <OutNowCard rows={list.rows} />}
        </div>
      </div>

      <PartnerDrawer
        key={view.partner ?? 'closed'}
        id={view.partner}
        row={list?.rows.find((r) => r.partnerId === view.partner) ?? null}
        target={target}
        canEdit={isAdmin}
        canSwitch={isManager}
        startTab={view.partner !== null && view.partner === addedId ? 'fees' : 'summary'}
        onClose={() => go({ ...view, partner: null })}
        onChanged={() => void data.refetch()}
      />

      <AddPartnerModal
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(id, name) => {
          setAdding(false);
          setAddedId(id);
          say(`${name} added as a delivery partner`);
          void data.refetch();
          go({ ...view, partner: id });
        }}
      />
    </section>
  );
}
