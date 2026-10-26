import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../../../components/ui-v2';
import type { ProfitTrend } from '../../../services/financeReports.service';
import { parseMoney } from '../../../utils/money';
import { compactNumber } from '../../dashboard/format';
import { AXIS } from '../../reports/charts';
import { money } from './format';
import { Part } from './Part';
import type { FinanceBlock } from './useBlock';

const COLORS = ['var(--pine)', 'var(--violet)', 'var(--gold)', 'var(--ink-3)'];
const SHOWN = 3;

interface Series { name: string; color: string; values: number[] }

/** The three products with the most revenue, then one series for all the others. A product with no cost has no profit and adds nothing. */
function seriesOf(t: ProfitTrend): Series[] {
  const value = (p: ProfitTrend['products'][number], i: number) => parseMoney(p.profits[i]);
  const top = t.products.slice(0, SHOWN).map((p, k) => ({ name: p.name, color: COLORS[k], values: t.months.map((_, i) => value(p, i)) }));
  const rest = t.products.slice(SHOWN);
  if (rest.length > 0) top.push({ name: 'Other products', color: COLORS[SHOWN], values: t.months.map((_, i) => rest.reduce((sum, p) => sum + value(p, i), 0)) });
  return top;
}

interface TipProps { active?: boolean; payload?: Array<{ payload: Record<string, number | string> }>; series: Series[] }

function Tip({ active, payload, series }: TipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="charttip">
      <b>{row.label}</b>
      {series.map((s) => <span key={s.name}>{s.name} <em className="num">{money(row[s.name] as number)}</em></span>)}
    </div>
  );
}

/** Profit by product, last 3 months (finance.html #chTrend): grouped bars per month, profit before other expenses. */
export function ProfitTrendCard({ block }: { block: FinanceBlock<ProfitTrend> }) {
  return (
    <Part name="Profit by product trend" block={block} height={330}>
      {(t) => {
        const series = seriesOf(t);
        const data = t.months.map((m, i) => ({ label: m.label, ...Object.fromEntries(series.map((s) => [s.name, s.values[i]])) }));
        const summary = `Profit by product, ${t.months[0]?.label} to ${t.months[t.months.length - 1]?.label}`;
        return (
          <Card title="Profit by product, last 3 months" aside="Before other expenses" className="fincard proftrend">
            {series.length === 0 ? (
              <p className="note">No order was delivered in these months.</p>
            ) : (
              <>
                <div className="lgrow">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
                <div role="img" aria-label={summary} className="chartbox">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS} />
                      <YAxis width={48} axisLine={false} tickLine={false} tickCount={5} tickFormatter={compactNumber} tick={AXIS} />
                      <ReferenceLine y={0} stroke="var(--line)" />
                      <Tooltip content={<Tip series={series} />} cursor={{ fill: 'var(--hover)' }} />
                      {series.map((s) => <Bar key={s.name} dataKey={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />)}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Card>
        );
      }}
    </Part>
  );
}
