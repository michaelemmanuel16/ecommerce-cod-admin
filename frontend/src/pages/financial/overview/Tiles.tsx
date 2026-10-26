import type { ReactNode } from 'react';
import { CircleDollarSign, Fuel, Hourglass, Info, Package, Percent, TriangleAlert, Wallet } from 'lucide-react';
import { Button, Skeleton, Tag, Tile, Tooltip, type TileTone } from '../../../components/ui-v2';
import { NOT_AVAILABLE, type Badge, type OkTile, type Tile as TileData, type TileKey } from '../../../services/finance-overview.service';
import { PROGRESS_TAG } from '../../dashboard/copy';
import { compactMoney, plural } from '../../dashboard/format';
import { money, TILE_ORDER, wholePct } from './model';

/** The icon and its tint per tile. Everything written on the tile comes from the API. */
const ICON: Record<TileKey, { icon: ReactNode; tone: TileTone }> = {
  deliveredRevenue: { icon: <CircleDollarSign />, tone: 'pine' },
  cashReceived: { icon: <Wallet />, tone: 'mint' },
  cashOutstanding: { icon: <Hourglass />, tone: 'gold' },
  netMargin: { icon: <Percent />, tone: 'coral' },
  profitPerOrder: { icon: <Package />, tone: 'coral' },
  cashRunway: { icon: <Fuel />, tone: 'gold' },
};

const negative = (v: unknown) => typeof v === 'number' && v < 0;

/** Label with the tooltip that carries the date basis. */
function Label({ tile }: { tile: OkTile }) {
  return (
    <span className="lbl">
      {tile.label}
      <Tooltip label={tile.tooltip}>
        <span className="info" role="img" tabIndex={0} aria-label={`About ${tile.label}`}><Info /></span>
      </Tooltip>
    </span>
  );
}

/** The value, the left text of the footer and an optional extra line. The tag is the tile's `badge`. */
function parts(t: OkTile, currency: string): { value: ReactNode; text: ReactNode; delta?: ReactNode } {
  switch (t.key) {
    case 'deliveredRevenue': {
      const d = t.detail;
      const orders = `${plural(d.deliveredOrders, 'order')} · AOV ${money(d.averageOrderValue, currency)}`;
      return {
        value: money(t.value, currency),
        text: d.target ? `Target ${compactMoney(d.target.value, currency)}` : orders,
        delta: <>{d.target && `${orders}. `}Of which digital {money(d.ofWhichDigital, currency)}</>,
      };
    }
    case 'cashReceived':
      return { value: money(t.value, currency), text: t.detail.percentOfDeliveredRevenue === null ? 'No delivered revenue' : `${t.detail.percentOfDeliveredRevenue}% of delivered revenue` };
    case 'cashOutstanding':
      return { value: money(t.value, currency), text: `${plural(t.detail.orders, 'order')}, ${t.detail.overdueOrders} past days to pay` };
    case 'netMargin': {
      const d = t.detail;
      return {
        value: <span className={negative(t.value) ? 'neg' : undefined}>{wholePct(t.value)}</span>,
        text: `Target ${d.target}%`,
        delta: <>{negative(d.netProfit) ? 'Loss' : 'Profit'} {money(negative(d.netProfit) ? -Number(d.netProfit) : d.netProfit, currency)}. Expenses {money(d.expenses.total, currency)}, of which Paystack fees {money(d.expenses.paystackFees, currency)}</>,
      };
    }
    case 'profitPerOrder': {
      const top = t.detail.topProduct;
      return {
        value: <span className={negative(t.value) ? 'neg' : undefined}>{money(t.value, currency)}</span>,
        text: top ? `${top.name} ${money(top.profitPerOrder, currency)} before ads and rep commission` : plural(t.detail.deliveredOrders, 'delivered order'),
      };
    }
    case 'cashRunway': {
      const d = t.detail;
      return {
        value: t.value === NOT_AVAILABLE ? NOT_AVAILABLE : `${t.value} ${t.value === 1 ? 'day' : 'days'}`,
        text: t.value === NOT_AVAILABLE ? `No Meta spend in the last ${d.adDays} days` : `${money(d.cash, currency)} cash ÷ ${money(d.adsPerDay, currency)} ads a day`,
      };
    }
  }
}

/** The tile's own badge; the revenue tile's tag is the target's Dashboard progress key. */
function badgeOf(t: OkTile): Badge | null {
  if (t.badge) return t.badge;
  return t.key === 'deliveredRevenue' && t.detail.target ? PROGRESS_TAG[t.detail.target.status] : null;
}

function ErrorCard({ tile }: { tile: Extract<TileData, { status: 'error' }> }) {
  return (
    <div className="card kpi tile-error" role="alert">
      <div className={`ic ${ICON[tile.key].tone}`}><TriangleAlert /></div>
      <div className="v num">—</div>
      <div className="l">{tile.label}</div>
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
        if (t.status === 'error') {
          return (
            <div key={key} className="tilewrap">
              <ErrorCard tile={t} />
              <Button size="mini" onClick={onRetry}>Try again</Button>
            </div>
          );
        }
        const p = parts(t, currency);
        const badge = badgeOf(t);
        return (
          <Tile
            key={key}
            icon={ICON[key].icon}
            tone={ICON[key].tone}
            value={p.value}
            label={<Label tile={t} />}
            footer={<><span>{p.text}</span>{badge && <Tag tone={badge.tone}>{badge.label}</Tag>}</>}
            delta={p.delta}
          />
        );
      })}
    </>
  );
}
