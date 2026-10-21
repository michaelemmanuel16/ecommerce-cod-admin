import { Hourglass, Phone, ShoppingCart, Truck } from 'lucide-react';
import clsx from 'clsx';
import { Tag, Tile } from '../../../components/ui-v2';
import { INFO, RATE_TAG, type Info } from '../copy';
import { compactMoney, plural, weekdayName, wholePercent } from '../format';
import { PageLink } from '../links';
import { PATHS } from '../paths';
import { InfoTip } from './Frame';
import type { Tiles } from '../types';

function Label({ text, to, info }: { text: string; to: string | null; info: Info }) {
  return <><PageLink to={to} className="plain">{text}</PageLink><InfoTip info={info} /></>;
}

/** Four driver tiles (F-204). The cash tile is missing from the response without financial:view, then three tiles show. */
export function TilesRow({ tiles }: { tiles: Tiles }) {
  const { ordersToday, confirmationRate: conf, deliverySuccessRate: success, cash } = tiles;
  const vs = ordersToday.vsLastWeek;
  const lastDay = `last ${weekdayName(vs.date).slice(0, 3)}`;
  const confTag = RATE_TAG[conf.tag];
  const successTag = RATE_TAG[success.tag];
  const gap = success.gapPoints;

  return (
    <div className={clsx('grid kpis', !cash && 'three')}>
      <Tile
        icon={<ShoppingCart />}
        tone="pine"
        value={ordersToday.value}
        label={<Label text="Orders today" to={PATHS.orders} info={INFO.ordersToday} />}
        footer={
          <>
            <span>{ordersToday.target === null ? 'No target' : `Target ${ordersToday.target}`}</span>
            {vs.deltaPercent === null || vs.trend === null ? (
              <Tag tone="n">No data vs {lastDay}</Tag>
            ) : (
              <Tag tone={vs.trend === 'up' ? 'ok' : vs.trend === 'down' ? 'bad' : 'n'}>
                {vs.trend === 'flat' ? `Same as ${lastDay}` : `${vs.trend === 'up' ? '▲' : '▼'} ${Math.abs(vs.deltaPercent)}% vs ${lastDay}`}
              </Tag>
            )}
          </>
        }
      />
      <Tile
        icon={<Phone />}
        tone="mint"
        value={wholePercent(conf.value)}
        label={<Label text="Confirmation rate" to={PATHS.reports} info={INFO.confirmationRate} />}
        footer={<><span>Target {conf.target}%</span><Tag tone={confTag.tone}>{confTag.label}</Tag></>}
      />
      <Tile
        icon={<Truck />}
        tone="coral"
        value={wholePercent(success.value)}
        label={<Label text="Delivery success rate" to={PATHS.deliveries} info={INFO.deliverySuccessRate} />}
        footer={
          <>
            <span>Target {success.target}%{success.yield !== null && ` · yield ${Math.round(success.yield)}%`}</span>
            {gap !== null && gap < 0 ? (
              <Tag tone={successTag.tone}>{'▼'} {Math.abs(Math.round(gap))} pts</Tag>
            ) : (
              <Tag tone={successTag.tone}>{successTag.label}</Tag>
            )}
          </>
        }
      />
      {cash && (
        <Tile
          icon={<Hourglass />}
          tone="gold"
          value={compactMoney(cash.value, tiles.currency)}
          label={<Label text="Cash still with agents" to={PATHS.finance} info={INFO.cash} />}
          footer={<span>Held by {plural(cash.partners, 'partner')}</span>}
        />
      )}
    </div>
  );
}
