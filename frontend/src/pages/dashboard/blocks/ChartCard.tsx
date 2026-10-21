import { useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '../../../components/ui-v2';
import { INFO, LEVER_LABEL, type Info } from '../copy';
import { chartSummary, compactMoney, compactNumber, gapNumber, monthName, parseDay, plural, shortDay, toChartPoint, type ChartPoint } from '../format';
import { BlockFrame, Tip } from './Frame';
import { isBlockError, type Block, type Chart, type Drivers } from '../types';

function Pill({ active, payload, currency, asOfDate, pinned }: { active?: boolean; payload?: Array<{ payload: ChartPoint }>; currency: string; asOfDate: string | null; pinned: string | null }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  // the pinned callout already shows the last day with data
  if (p.cumulative === null || p.date === pinned) return null;
  return (
    <div className="ctip">
      <small>{p.date === asOfDate ? 'Today, ' : ''}{shortDay(p.date)}</small>
      <b>
        {compactMoney(p.cumulative, currency)}
        {p.vsPace !== null && ` · ${p.vsPace < 0 ? '−' : '+'}${gapNumber(Math.abs(p.vsPace))} vs pace`}
      </b>
    </div>
  );
}

const tickLabel = (date: string) => {
  const { day } = parseDay(date);
  return day === 1 ? shortDay(date) : String(day);
};

/** The x-axis ticks of the mockup: "1 Oct", "7", "14" and the last day of the month. Other ranges: first, two between, last. */
function axisTicks(chart: Chart): string[] {
  const dates = chart.days.map((d) => d.date);
  if (dates.length === 0) return [];
  if (chart.period === 'month' && dates.length >= 15) return [dates[0], dates[6], dates[13], dates[dates.length - 1]];
  const n = dates.length - 1;
  return [...new Set([0, Math.floor(n / 3), Math.floor((2 * n) / 3), n].map((i) => dates[i]))];
}

/**
 * The dark callout the mockup pins at today's point (index.html, the <g> with rect rx=10 fill var(--ink)):
 * "Today, 17 Oct" over "GH₵92k · −7k vs pace", 13px right and 7px below the point. It flips to the left near the right edge.
 */
function Callout({ cx, cy, title, text, width }: { cx?: number; cy?: number; title: string; text: string; width: number }) {
  if (cx === undefined || cy === undefined) return null;
  const boxW = Math.max(150, Math.round(text.length * 7.4 + 24));
  const x = cx + 13 + boxW > width - 4 ? cx - 13 - boxW : cx + 13;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="var(--card)" stroke="var(--pine)" strokeWidth={3} />
      <g transform={`translate(${x} ${cy + 7})`}>
        <rect width={boxW} height={44} rx={10} fill="var(--ink)" />
        <text x={12} y={19} fill="var(--bg)" fontSize={11} fontFamily="Plus Jakarta Sans">{title}</text>
        <text x={12} y={35} fill="var(--bg)" fontSize={13} fontWeight={700} fontFamily="Plus Jakarta Sans">{text}</text>
      </g>
    </g>
  );
}

const hasTargetPace = (chart: Chart) => chart.days.some((d) => d.targetPace !== null);

function Plot({ chart, asOfDate }: { chart: Chart; asOfDate: string | null }) {
  const data = chart.days.map(toChartPoint);
  const hasPace = hasTargetPace(chart);
  const lastActual = [...data].reverse().find((p) => p.cumulative !== null);
  const [width, setWidth] = useState(640);
  const calloutText = lastActual && lastActual.cumulative !== null
    ? `${compactMoney(lastActual.cumulative, chart.currency)}${lastActual.vsPace !== null ? ` \u00B7 ${lastActual.vsPace < 0 ? '\u2212' : '+'}${gapNumber(Math.abs(lastActual.vsPace))} vs pace` : ''}`
    : '';

  return (
    <>
      <div role="img" aria-label={chartSummary(chart, asOfDate)} className="chartbox">
        <ResponsiveContainer width="100%" height={230} onResize={(w) => setWidth(w)}>
          <ComposedChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="dashRevenueFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--pine)" stopOpacity={0.28} />
                <stop offset="1" stopColor="var(--pine)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="date" tickFormatter={tickLabel} axisLine={false} tickLine={false} ticks={axisTicks(chart)} interval={0}
              tick={{ fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'Plus Jakarta Sans' }}
            />
            <YAxis
              width={44} axisLine={false} tickLine={false} tickCount={4} domain={[0, 'auto']} tickFormatter={compactNumber}
              tick={{ fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'Plus Jakarta Sans' }}
            />
            <ChartTooltip cursor={{ stroke: 'var(--line)' }} content={<Pill currency={chart.currency} asOfDate={asOfDate} pinned={lastActual?.date ?? null} />} />
            {hasPace && (
              <Line dataKey="targetPace" type="linear" stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="5 6" dot={false} activeDot={false} isAnimationActive={false} />
            )}
            <Area dataKey="cumulative" type="monotone" stroke="var(--pine)" strokeWidth={3} strokeLinecap="round" fill="url(#dashRevenueFill)" dot={false} activeDot={{ r: 5, fill: 'var(--card)', stroke: 'var(--pine)', strokeWidth: 3 }} isAnimationActive={false} connectNulls={false} />
            {lastActual && lastActual.cumulative !== null && (
              <ReferenceDot
                x={lastActual.date} y={lastActual.cumulative} ifOverflow="visible"
                shape={(p: { cx?: number; cy?: number }) => (
                  <Callout cx={p.cx} cy={p.cy} width={width} text={calloutText} title={`${lastActual.date === asOfDate ? 'Today, ' : ''}${shortDay(lastActual.date)}`} />
                )}
              />
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
      <small><Tip info={info}>{label}</Tip></small>
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
        <h3><Tip info={INFO.chart}>Delivered revenue vs target</Tip></h3>
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
