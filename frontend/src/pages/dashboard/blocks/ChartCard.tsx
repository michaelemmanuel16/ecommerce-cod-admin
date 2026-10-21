import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '../../../components/ui-v2';
import { INFO, LEVER_LABEL, type Info } from '../copy';
import { chartSummary, compactMoney, compactNumber, monthName, parseDay, plural, shortDay, toChartPoint, type ChartPoint } from '../format';
import { BlockFrame, InfoTip } from './Frame';
import { isBlockError, type Block, type Chart, type Drivers } from '../types';

function Pill({ active, payload, currency, asOfDate }: { active?: boolean; payload?: Array<{ payload: ChartPoint }>; currency: string; asOfDate: string | null }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (p.cumulative === null) return null;
  return (
    <div className="ctip">
      <small>{p.date === asOfDate ? 'Today, ' : ''}{shortDay(p.date)}</small>
      <b>
        {compactMoney(p.cumulative, currency)}
        {p.vsPace !== null && ` · ${p.vsPace < 0 ? '−' : '+'}${compactNumber(Math.abs(p.vsPace))} vs pace`}
      </b>
    </div>
  );
}

const tickLabel = (date: string) => {
  const { day } = parseDay(date);
  return day === 1 ? shortDay(date) : String(day);
};

const hasTargetPace = (chart: Chart) => chart.days.some((d) => d.targetPace !== null);

function Plot({ chart, asOfDate }: { chart: Chart; asOfDate: string | null }) {
  const data = chart.days.map(toChartPoint);
  const hasPace = hasTargetPace(chart);
  const lastActual = [...data].reverse().find((p) => p.cumulative !== null);

  return (
    <>
      <div role="img" aria-label={chartSummary(chart, asOfDate)} className="chartbox">
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="dashRevenueFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--pine)" stopOpacity={0.28} />
                <stop offset="1" stopColor="var(--pine)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="date" tickFormatter={tickLabel} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28}
              tick={{ fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'Plus Jakarta Sans' }}
            />
            <YAxis
              width={44} axisLine={false} tickLine={false} tickCount={4} domain={[0, 'auto']} tickFormatter={compactNumber}
              tick={{ fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'Plus Jakarta Sans' }}
            />
            <ChartTooltip cursor={{ stroke: 'var(--line)' }} content={<Pill currency={chart.currency} asOfDate={asOfDate} />} />
            {hasPace && (
              <Line dataKey="targetPace" type="linear" stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="5 6" dot={false} activeDot={false} isAnimationActive={false} />
            )}
            <Area dataKey="cumulative" type="monotone" stroke="var(--pine)" strokeWidth={3} strokeLinecap="round" fill="url(#dashRevenueFill)" dot={false} activeDot={{ r: 5, fill: 'var(--card)', stroke: 'var(--pine)', strokeWidth: 3 }} isAnimationActive={false} connectNulls={false} />
            {lastActual && lastActual.cumulative !== null && (
              <ReferenceDot x={lastActual.date} y={lastActual.cumulative} r={6} fill="var(--card)" stroke="var(--pine)" strokeWidth={3} ifOverflow="visible" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function Driver({ label, info, value, note }: { label: string; info: Info; value: string; note: string }) {
  return (
    <div className="drv">
      <small>{label} <InfoTip info={info} /></small>
      <b>{value}</b>
      <em>{note}</em>
    </div>
  );
}

/** Three driver cards under the chart (F-205): projected month, needed per day, biggest lever. */
export function DriverCards({ drivers, asOfDate }: { drivers: Drivers; asOfDate: string | null }) {
  const { projectedMonth: p, neededPerDay: n, biggestLever: l, currency } = drivers;
  const month = asOfDate ? monthName(asOfDate) : 'month';
  const cards = [
    <Driver
      key="projected" label={`Projected ${month}`} info={INFO.projected}
      value={p.tooEarly || p.value === null ? 'Too early to project' : compactMoney(p.value, currency)}
      note={p.tooEarly || p.value === null ? 'Needs a few days of data' : p.percentOfTarget === null ? "at today's rate" : `${Math.round(p.percentOfTarget)}% of target at today's rate`}
    />,
  ];
  // No month target (or the last day): the API sends no needed-per-day figure, so the card is left out
  if (n.value !== null) {
    cards.push(
      <Driver key="needed" label="Needed per day" info={INFO.needed} value={compactMoney(n.value, currency)} note={`for the last ${n.daysLeft === 1 ? 'day' : `${n.daysLeft} days`}`} />,
    );
  }
  cards.push(
    <Driver
      key="lever" label="Biggest lever" info={INFO.lever}
      value={l.rate ? LEVER_LABEL[l.rate] : 'None'}
      note={l.rate && l.value !== null ? `+${plural(l.points, 'pt')} = +${compactMoney(l.value, currency)} this month` : 'Both rates are on target'}
    />,
  );
  return <div className={`drivers3 n${cards.length}`}>{cards}</div>;
}

interface ChartCardProps {
  chart: Block<Chart> | undefined;
  drivers: Block<Drivers> | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  asOfDate: string | null;
}

/** The chart card of the mockup: title, legend, chart, then the three driver cards. Each part has its own skeleton and error. */
export function ChartCard({ chart, drivers, loading, failed, onRetry, asOfDate }: ChartCardProps) {
  return (
    <div className="card">
      <div className="ct">
        <h3>Delivered revenue vs target <InfoTip info={INFO.chart} /></h3>
        {chart && !isBlockError(chart) && (
          <div className="legend">
            <span><i className="dl" />Delivered</span>
            {hasTargetPace(chart) && <span><i className="tp" />Target pace</span>}
          </div>
        )}
      </div>
      <div className="chart">
        <BlockFrame
          name="Chart" bare block={chart} loading={loading} failed={failed} onRetry={onRetry}
          skeleton={<Skeleton height={254} className="skelcard" />}
        >
          {(c) => <Plot chart={c} asOfDate={asOfDate} />}
        </BlockFrame>
        <BlockFrame
          name="Driver cards" bare block={drivers} loading={loading} failed={failed} onRetry={onRetry}
          skeleton={<Skeleton height={76} className="skelcard" />}
        >
          {(d) => <DriverCards drivers={d} asOfDate={asOfDate} />}
        </BlockFrame>
      </div>
    </div>
  );
}
