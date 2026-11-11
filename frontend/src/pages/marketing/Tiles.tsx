import type { ReactNode } from 'react';
import { Megaphone, Target, Truck, Wallet } from 'lucide-react';
import { Tag, Tile } from '../../components/ui-v2';
import type { MoneyView, Summary } from '../../services/marketing.service';
import { formatRateUsed } from '../../utils/format';
import { parseMoney } from '../../utils/money';
import { rangeLabel } from '../reports/format';
import { money, moneyNumber } from './format';

type Good = 'up' | 'down' | null;

/** The change against the previous period: a tag with the arrow and the earlier figure. `good` says which way is good news. */
function change(current: number | null, previous: number | null, previousText: string, good: Good, unit: '%' | ' pts' = '%'): ReactNode {
  if (previous === null || current === null) return <><Tag tone="n">No data</Tag>in the previous period</>;
  const diff = unit === '%' ? (previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100) : current - previous;
  if (diff === null) return <><Tag tone="n">No data</Tag>in the previous period</>;
  const whole = Math.round(diff);
  if (whole === 0) return <><Tag tone="n">Same</Tag>vs {previousText}</>;
  const up = whole > 0;
  const tone = good === null ? 'n' : up === (good === 'up') ? 'ok' : 'bad';
  return <><Tag tone={tone}>{up ? '▲' : '▼'} {Math.abs(whole)}{unit}</Tag>vs {previousText}</>;
}

const moneyChange = (cur: MoneyView | null | undefined, prev: MoneyView | null | undefined, good: Good) =>
  change(moneyNumber(cur), moneyNumber(prev), money(prev), good);

/** The five tiles of the Marketing page, all from GET /summary. */
export function Tiles({ s }: { s: Summary }) {
  const p = s.previous;
  const max = s.maxCpa;
  const rate = max.maxCpa?.rate ?? s.projectedCostPerDelivered.value?.rate ?? null;
  const accountSpend = s.spend.account !== null && s.spend.accountCurrency;
  const yieldNow = max.yieldPct;
  const yieldPrev = p.maxCpa.yieldPct;
  const waiting = s.spendDaysWaitingForRate;

  return (
    <div className="grid kpis k5">
      <Tile
        icon={<Megaphone />} tone="pine" value={money(s.spend)} label="Ad spend"
        footer={<>
          <span>{accountSpend ? <>About {money({ ...s.spend, account: null, accountCurrency: null })}{rate !== null && s.spend.accountCurrency ? ` (${formatRateUsed(s.spend.accountCurrency, parseMoney(rate))})` : ''}</> : 'In the store currency'}</span>
          <Tag tone="n">{rangeLabel(s.from, s.to)}</Tag>
        </>}
        delta={<>{waiting > 0 && <span className="mktwait">{waiting} {waiting === 1 ? 'day waits' : 'days wait'} for an FX rate</span>}{moneyChange(s.spend, p.spend, null)}</>}
      />
      <Tile
        icon={<Target />} tone="mint" value={max.maxCpa ? money(max.maxCpa) : '-'} label="Max CPA"
        footer={<span>{max.message ?? (yieldNow !== null ? `At ${Math.round(yieldNow)}% yield` : '')}</span>}
        delta={moneyChange(max.maxCpa, p.maxCpa.maxCpa, 'up')}
      />
      <Tile
        icon={<Truck />} tone="coral" value={money(s.projectedCostPerDelivered.value)} label="Projected cost per delivered"
        footer={<span>{s.projectedCostPerDelivered.message ?? (s.projectedCostPerDelivered.value ? 'Spend over placed orders at the yield' : 'No orders placed yet')}</span>}
        delta={moneyChange(s.projectedCostPerDelivered.value, p.projectedCostPerDelivered.value, 'down')}
      />
      <Tile
        icon={<Truck />} tone="gold" value={money(s.actualCostPerDelivered.value)} label={s.actualCostPerDelivered.label}
        footer={<span>{s.actualCostPerDelivered.value ? `${s.delivered.toLocaleString('en-US')} delivered` : 'No delivered orders yet'}</span>}
        delta={moneyChange(s.actualCostPerDelivered.value, p.actualCostPerDelivered.value, 'down')}
      />
      <Tile
        icon={<Wallet />} tone="violet" value={yieldNow !== null ? `${Math.round(yieldNow)}%` : '-'} label="Order-to-cash yield"
        footer={<><span>{max.message && yieldNow === null ? max.message : 'Of placed orders'}</span><Tag tone="n">{max.closedOrders} closed</Tag></>}
        delta={change(yieldNow, yieldPrev, yieldPrev !== null ? `${Math.round(yieldPrev)}%` : '', 'up', ' pts')}
      />
    </div>
  );
}
