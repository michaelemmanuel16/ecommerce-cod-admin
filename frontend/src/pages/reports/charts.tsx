// The charts of docs/mockups/v2/reports.html, drawn with recharts like the Dashboard chart. Every chart sits in a
// role="img" box whose label tells a screen reader what the picture shows.
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { compactNumber } from '../dashboard/format';
import { dayTick } from './format';

const AXIS = { fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'Plus Jakarta Sans' } as const;
/** About nine labels along the x axis whatever the range (the mockup's `every`). */
const every = (n: number) => Math.max(0, Math.ceil(n / 9) - 1);

interface Series { key: string; color: string; area?: boolean }
type Row = Record<string, string | number | null>;

interface DayChartProps {
  /** One object per day: `date` and, per series, `<key>` and `<key>Prev`. */
  data: Row[];
  summary: string;
  /** Draw the `<key>Prev` values (dashed lines, grey bars). */
  compare: boolean;
  format?: (v: number) => string;
}

/** Lines per day (Overview: orders and delivered; Delivery: delivered). */
export function DayLineChart({ data, series, summary, compare, format = compactNumber }: DayChartProps & { series: Series[] }) {
  const long = data.length > 62;
  return (
    <div role="img" aria-label={summary} className="chartbox">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
          <defs>
            {series.filter((s) => s.area).map((s) => (
              <linearGradient key={s.key} id={`rep-fill-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity={0.14} />
                <stop offset="1" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => dayTick(d, long)} axisLine={false} tickLine={false} interval={every(data.length)} tick={AXIS} />
          <YAxis width={44} axisLine={false} tickLine={false} tickCount={5} domain={[0, 'auto']} tickFormatter={format} tick={AXIS} />
          {compare && series.map((s) => (
            <Line key={`${s.key}Prev`} dataKey={`${s.key}Prev`} type="monotone" stroke="var(--ink-3)" strokeWidth={1.8} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />
          ))}
          {series.map((s) =>
            s.area ? (
              <Area key={s.key} dataKey={s.key} type="monotone" stroke={s.color} strokeWidth={2.4} fill={`url(#rep-fill-${s.key})`} dot={false} isAnimationActive={false} />
            ) : (
              <Line key={s.key} dataKey={s.key} type="monotone" stroke={s.color} strokeWidth={2.4} dot={false} isAnimationActive={false} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Bars per day (`value`). With compare on, the previous period (`valuePrev`) sits next to each bar in grey. */
export function DayBarChart({ data, summary, compare, color = 'var(--pine)', format = compactNumber }: DayChartProps & { color?: string }) {
  const long = data.length > 62;
  return (
    <div role="img" aria-label={summary} className="chartbox">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => dayTick(d, long)} axisLine={false} tickLine={false} interval={every(data.length)} tick={AXIS} />
          <YAxis width={44} axisLine={false} tickLine={false} tickCount={5} domain={[0, 'auto']} tickFormatter={format} tick={AXIS} />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} maxBarSize={30} isAnimationActive={false} />
          {compare && <Bar dataKey="valuePrev" fill="var(--ink-3)" radius={[3, 3, 0, 0]} maxBarSize={30} isAnimationActive={false} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface Slice { name: string; value: number; color: string; text: string }

/** The donut with its centre text, and the list of slices beside it (.donutrow). `text` is the figure in the list. */
export function Donut({ slices, top, sub, summary }: { slices: Slice[]; top: string; sub: string; summary: string }) {
  return (
    <div className="donutrow">
      <div role="img" aria-label={summary} className="donutbox">
        <PieChart width={160} height={160}>
          <Pie data={slices} dataKey="value" innerRadius={48} outerRadius={62} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
            {slices.map((s) => <Cell key={s.name} fill={s.color} />)}
          </Pie>
        </PieChart>
        <div className="donutc"><b>{top}</b><span>{sub}</span></div>
      </div>
      <div className="dl">
        {slices.map((s) => (
          <div key={s.name}><i style={{ background: s.color }} />{s.name}<b className="num">{s.text}</b></div>
        ))}
      </div>
    </div>
  );
}

interface TargetBar { label: string; value: number }

/**
 * Delivery success per state against the target line (the mockup's #chRegion). Horizontal bars, one row per state, so
 * the 16 Ghana state names never overlap (COD-139). A full bar is 100%; the dark line is the target.
 */
export function TargetBars({ rows, target, summary }: { rows: TargetBar[]; target: number; summary: string }) {
  return (
    <div role="img" aria-label={summary} className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span>{r.label}</span>
          <div className="track">
            <i style={{ width: `${Math.min(100, r.value)}%`, background: r.value >= target ? 'var(--mint)' : 'var(--coral)' }} />
            <span className="pace" style={{ left: `${target}%` }} />
          </div>
          <span className="val num">{Math.round(r.value)}%</span>
        </div>
      ))}
    </div>
  );
}
