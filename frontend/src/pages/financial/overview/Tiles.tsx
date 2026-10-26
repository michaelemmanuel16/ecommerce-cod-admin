import type { ReactNode } from 'react';
import { CircleDollarSign, Fuel, Hourglass, Info, Package, Percent, TriangleAlert, Wallet } from 'lucide-react';
import { Button, Skeleton, Tag, Tile, Tooltip, type TileTone } from '../../../components/ui-v2';
import { NOT_AVAILABLE, type OkTile, type Tile as TileData, type TileKey } from '../../../services/finance-overview.service';
import { compactMoney } from '../../dashboard/format';
import { isOk, money, plural, TAG_TONE, TARGET_TAG, TILE_ORDER, wholePct } from './model';

const ICON: Record<TileKey, { icon: ReactNode; tone: TileTone; label: string }> = {
  deliveredRevenue: { icon: <CircleDollarSign />, tone: 'pine', label: 'Delivered revenue' },
  cashReceived: { icon: <Wallet />, tone: 'mint', label: 'Cash received' },
  cashOutstanding: { icon: <Hourglass />, tone: 'gold', label: 'Cash outstanding' },
  netMargin: { icon: <Percent />, tone: 'coral', label: 'Net margin' },
  profitPerOrder: { icon: <Package />, tone: 'coral', label: 'Profit per delivered order' },
  cashRunway: { icon: <Fuel />, tone: 'gold', label: 'Cash runway, in days of ads' },
};

const targetTag = (status: string) => TARGET_TAG[status as keyof typeof TARGET_TAG];
const toneClass = (t: OkTile) => (t.tone === 'bad' ? 'neg' : undefined);

/** Label with the tooltip that carries the date basis. */
function Label({ tile, text }: { tile: OkTile; text: string }) {
  return (
    <span className="lbl">
      {text}
      <Tooltip label={tile.tooltip}>
        <span className="info" role="img" tabIndex={0} aria-label={`About ${text}`}><Info /></span>
      </Tooltip>
    </span>
  );
}

function parts(t: OkTile, currency: string): { value: ReactNode; footer: ReactNode; delta?: ReactNode } {
  const d = t.detail;
  const na = t.value === NOT_AVAILABLE;
  const tag = (text: string) => <Tag tone={TAG_TONE[t.tone]}>{text}</Tag>;
  switch (t.key) {
    case 'deliveredRevenue':
      return {
        value: money(t.value, currency),
        footer: d.target
          ? <><span>Target {compactMoney(d.target.value, currency)}</span><Tag tone={targetTag(d.target.status).tone}>{targetTag(d.target.status).label}</Tag></>
          : <span>{plural(d.deliveredOrders, 'order')} · AOV {money(d.averageOrderValue, currency)}</span>,
        delta: <>{d.target && <>{plural(d.deliveredOrders, 'order')} · AOV {money(d.averageOrderValue, currency)}. </>}Of which digital {money(d.ofWhichDigital, currency)}</>,
      };
    case 'cashReceived':
      return {
        value: money(t.value, currency),
        footer: <><span>{d.percentOfDeliveredRevenue === null ? 'No delivered revenue' : `${d.percentOfDeliveredRevenue}% of delivered revenue`}</span>{tag('Paid in')}</>,
      };
    case 'cashOutstanding':
      return {
        value: money(t.value, currency),
        footer: <><span>{plural(d.orders, 'order')}, {d.overdueOrders} past days to pay</span>{tag(d.overdueOrders > 0 ? 'Chase' : 'On time')}</>,
      };
    case 'netMargin':
      return {
        value: <span className={toneClass(t)}>{wholePct(t.value)}</span>,
        footer: <><span>Target {d.target}%</span>{!na && tag(t.tone === 'bad' ? `Loss ${money(Math.abs(d.netProfit), currency)}` : t.tone === 'ok' ? 'On target' : 'Under target')}</>,
        delta: <>Expenses {money(d.expenses.total, currency)}, of which Paystack fees {money(d.expenses.paystackFees, currency)}</>,
      };
    case 'profitPerOrder':
      return {
        value: <span className={toneClass(t)}>{money(t.value, currency)}</span>,
        footer: <>
          <span>{d.topProduct ? `${d.topProduct.name} ${money(d.topProduct.profitPerOrder, currency)} (before rep commission)` : plural(d.deliveredOrders, 'delivered order')}</span>
          {!na && tag(t.tone === 'bad' ? 'Loss' : 'Profit')}
        </>,
      };
    case 'cashRunway':
      return {
        value: na ? NOT_AVAILABLE : `${t.value} ${t.value === 1 ? 'day' : 'days'}`,
        footer: na
          ? <span>No Meta spend in the last {d.adDays} days</span>
          : <><span>{money(d.cash, currency)} cash ÷ {money(d.adsPerDay, currency)} ads a day</span>{tag(d.level === 'critical' ? 'Critical' : d.level === 'tight' ? 'Tight' : 'OK')}</>,
      };
  }
}

function ErrorCard({ tile }: { tile: Extract<TileData, { status: 'error' }> }) {
  const meta = ICON[tile.key];
  return (
    <div className="card kpi tile-error" role="alert">
      <div className={`ic ${meta.tone}`}><TriangleAlert /></div>
      <div className="v num">—</div>
      <div className="l">{meta.label}</div>
      <div className="s"><span>{tile.message}</span></div>
    </div>
  );
}

export function TileSkeletons() {
  return (
    <>
      {TILE_ORDER.map((k) => (
        <div key={k} className="card kpi" aria-hidden="true">
          <Skeleton width={38} height={38} />
          <Skeleton width="60%" height={26} className="sk-gap" />
          <Skeleton width="80%" height={14} className="sk-gap" />
        </div>
      ))}
    </>
  );
}

/** The six tiles. A tile that failed shows its own error with a retry; the others are unaffected. */
export function Tiles({ tiles, currency, onRetry }: { tiles: TileData[]; currency: string; onRetry: () => void }) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));
  return (
    <>
      {TILE_ORDER.map((key) => {
        const t = byKey.get(key);
        if (!t) return null;
        if (!isOk(t)) {
          return (
            <div key={key} className="tilewrap">
              <ErrorCard tile={t} />
              <Button size="mini" onClick={onRetry}>Try again</Button>
            </div>
          );
        }
        const p = parts(t, currency);
        const meta = ICON[key];
        return <Tile key={key} icon={meta.icon} tone={meta.tone} value={p.value} label={<Label tile={t} text={meta.label} />} footer={p.footer} delta={p.delta} />;
      })}
    </>
  );
}
