import { Bar, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../../components/ui-v2';
import type { Daily, DailyRow } from '../../services/marketing.service';
import { getCurrencySymbol } from '../../utils/countries';
import { getStoreCurrency } from '../../utils/format';
import { parseMoney } from '../../utils/money';
import { compactNumber, shortDay } from '../dashboard/format';
import { AXIS, every } from '../reports/charts';
import { dayTick, plural } from '../reports/format';
import { amount, money } from './format';

interface Point { date: string; spend: number | null; orders: number; text: string | null; waiting: boolean }

/** The spend of a day as the page writes it: the ad account figure first, else the store figure, null when neither exists. */
function spendText(r: DailyRow): string | null {
  const s = r.spend;
  if (s.account !== null && s.accountCurrency) return amount(s.account, s.accountCurrency);
  return s.store !== null ? amount(s.store, getStoreCurrency()) : null;
}

const spendNumber = (r: DailyRow): number | null => {
  const v = r.spend.account !== null ? r.spend.account : r.spend.store;
  return v === null ? null : parseMoney(v);
};

const pointOf = (r: DailyRow): Point => ({ date: r.date, spend: spendNumber(r), orders: r.ordersPlaced, text: spendText(r), waiting: r.waitingForRate });

interface TipProps { active?: boolean; payload?: Array<{ payload: Point }>; today: string }

/** "17 Oct · ₦520,000 · 91 orders" ("Today, 17 Oct" for today). A day with no FX rate yet says so on a second line. */
export function DailyTip({ active, payload, today }: TipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const day = p.date === today ? `Today, ${shortDay(p.date)}` : shortDay(p.date);
  return (
    <div className="charttip">
      <b>{day}</b>
      <span>{p.text ?? '-'} · {plural(p.orders, 'order')}</span>
      {p.waiting && <span>Waiting for FX rate</span>}
    </div>
  );
}

const todayYmd = (): string => new Date().toISOString().slice(0, 10);

/** Daily spend vs orders (marketing.html "Daily spend vs orders"): spend bars on the left axis, orders line on the right. */
export function DailyCard({ daily, today = todayYmd() }: { daily: Daily; today?: string }) {
  const data = daily.days.map(pointOf);
  const symbol = getCurrencySymbol(daily.days.find((d) => d.spend.accountCurrency)?.spend.accountCurrency ?? getStoreCurrency());
  const last = data.length - 1;
  const summary = `Daily Meta ad spend compared with orders placed, ${shortDay(daily.from)} to ${shortDay(daily.to)}`;
  const legend = (
    <span className="legend">
      <span><i style={{ background: 'var(--pine)' }} />Spend ({symbol})</span>
      <span><i style={{ background: 'var(--violet)' }} />Orders</span>
    </span>
  );
  return (
    <Card title="Daily spend vs orders" aside={legend} className="dailycard">
      <div role="img" aria-label={summary} className="chartbox">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 12, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="date" tickFormatter={(d: string) => dayTick(d)} axisLine={false} tickLine={false} interval={every(data.length)} tick={AXIS} />
            <YAxis yAxisId="spend" width={48} axisLine={false} tickLine={false} tickCount={5} domain={[0, 'auto']} tickFormatter={compactNumber} tick={AXIS} />
            <YAxis yAxisId="orders" orientation="right" width={36} axisLine={false} tickLine={false} tickCount={5} domain={[0, 'auto']} allowDecimals={false} tick={AXIS} />
            <Tooltip content={<DailyTip today={today} />} cursor={{ fill: 'var(--hover)' }} />
            <Bar yAxisId="spend" dataKey="spend" radius={[5, 5, 0, 0]} maxBarSize={22} isAnimationActive={false}>
              {data.map((p, i) => <Cell key={p.date} fill="var(--pine)" fillOpacity={i === last ? 1 : 0.32} />)}
            </Bar>
            <Line yAxisId="orders" dataKey="orders" type="monotone" stroke="var(--violet)" strokeWidth={3} dot={{ r: 3.5, fill: 'var(--card)', stroke: 'var(--violet)', strokeWidth: 2 }} activeDot={{ r: 6, fill: 'var(--card)', stroke: 'var(--violet)', strokeWidth: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="dailybox">
        {daily.best && <div className="drv"><small>Best day</small><b>{shortDay(daily.best.date)}</b><em>{money(daily.best.costPerOrder)} per order</em></div>}
        {daily.worst && <div className="drv"><small>Worst day</small><b>{shortDay(daily.worst.date)}</b><em>{money(daily.worst.costPerOrder)} per order</em></div>}
        <div className="drv"><small>Average a day</small><b>{money(daily.average.spend)}</b><em>{plural(Math.round(daily.average.ordersPerDay), 'order')}</em></div>
      </div>
    </Card>
  );
}
