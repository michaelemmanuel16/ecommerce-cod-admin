// The two charts of the cash flow tab, drawn with recharts like the Reports charts: a role="img" box with a label for a
// screen reader, tokens for colour, and a hover tooltip that reads the row back (F-929: date, revenue, expenses, net).
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Trend } from '../../../services/financeReports.service';
import { parseMoney } from '../../../utils/money';
import { compactNumber, shortDay } from '../../dashboard/format';
import { dayTick } from '../../reports/format';
import { AXIS, every } from '../../reports/charts';
import { money } from '../profit/format';

interface ForecastPoint { date: string; balance: number }

/** Cash balance for the next 30 days (F-928). The dashed line is zero: a balance under it is a negative balance, shown as it is. */
export function ForecastChart({ points, summary }: { points: ForecastPoint[]; summary: string }) {
  return (
    <div role="img" aria-label={summary} className="chartbox">
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={points} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fin-fc-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--pine)" stopOpacity={0.14} />
              <stop offset="1" stopColor="var(--pine)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => shortDay(d)} axisLine={false} tickLine={false} interval={5} tick={AXIS} />
          <YAxis width={48} axisLine={false} tickLine={false} tickCount={5} tickFormatter={compactNumber} tick={AXIS} />
          <ReferenceLine y={0} stroke="var(--coral)" strokeDasharray="5 4" />
          <Tooltip content={<Hover rows={(p) => [['Cash balance', money(p.balance)]]} />} />
          <Area dataKey="balance" type="monotone" stroke="var(--pine)" strokeWidth={2.4} fill="url(#fin-fc-fill)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Delivered revenue per delivery date (line) against expenses per expense date (bars). */
export function TrendChart({ trend, summary }: { trend: Trend; summary: string }) {
  const data = trend.reports.map((r) => ({
    date: r.date, revenue: parseMoney(r.revenue), expenses: parseMoney(r.expenses), net: parseMoney(r.profit),
  }));
  const long = data.length > 62 || trend.grouping !== 'day';
  return (
    <div role="img" aria-label={summary} className="chartbox">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => dayTick(d, long)} axisLine={false} tickLine={false} interval={every(data.length)} tick={AXIS} />
          <YAxis width={48} axisLine={false} tickLine={false} tickCount={5} domain={[0, 'auto']} tickFormatter={compactNumber} tick={AXIS} />
          <Tooltip content={<Hover rows={(p) => [['Revenue', money(p.revenue)], ['Expenses', money(p.expenses)], ['Net', money(p.net)]]} />} />
          <Bar dataKey="expenses" fill="var(--coral)" fillOpacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          <Line dataKey="revenue" type="monotone" stroke="var(--pine)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type Row = { date: string } & Record<string, number | string>;

interface HoverProps {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  rows: (p: Row) => Array<[string, string]>;
}

/** The hover card: the day and one line per series. Recharts passes `active` and `payload`. */
function Hover({ active, payload, rows }: HoverProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="charttip">
      <b>{shortDay(p.date)}</b>
      {rows(p).map(([label, value]) => <span key={label}>{label} <em className="num">{value}</em></span>)}
    </div>
  );
}
