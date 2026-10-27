import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState } from '../ui-v2';
import type { AgingBucket, AgingReport } from '../../services/collections.service';
import { formatCurrency } from '../../utils/format';
import { AXIS, ChartTip } from '../../pages/reports/charts';
import { bucketColor, lateOf } from '../../pages/financial/collections/model';

/** The 15+ bucket is violet in the mockup's legend; the late 8-14 bucket stays coral like the table. */
const colorOf = (b: AgingBucket): string => (b.key === '15+' ? 'var(--violet)' : bucketColor(b));
const short = (name: string): string => (name.length > 16 ? `${name.slice(0, 15)}…` : name);

interface Row { name: string; total: number; [bucket: string]: number | string }

function Hover({ active, payload, buckets }: { active?: boolean; payload?: Array<{ payload: Row }>; buckets: AgingBucket[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <ChartTip title={row.name} rows={buckets.map((b) => [b.label, formatCurrency(row[b.key] as number)])} />;
}

/**
 * "Cash exposure by partner" (M5-T36): unpaid delivered orders per partner, split by the age of the orders. Drawn from the
 * aging report the page already holds, so it costs no request. The legend and the stacks follow the report's own buckets.
 */
export function CashExposureCard({ report }: { report: AgingReport }) {
  const buckets = report.summary.bucketTotals;
  const rows: Row[] = report.partners
    .filter((p) => p.unpaidAmount > 0)
    .map((p) => ({
      name: p.name,
      total: p.unpaidAmount,
      none: 0,
      ...Object.fromEntries(buckets.map((b) => [b.key, p.buckets.find((x) => x.key === b.key)?.amount ?? 0])),
    }));
  const total = report.summary.totalOutstandingAmount;
  const top = report.partners.filter((p) => p.unpaidAmount > 0).reduce<AgingReport['partners'][number] | null>((best, p) => (best === null || p.unpaidAmount > best.unpaidAmount ? p : best), null);

  return (
    <Card title="Cash exposure by partner" aside="Unpaid delivered orders, by age of the orders">
      {rows.length === 0 ? (
        <EmptyState title="No partner holds unpaid orders" text="Delivered orders that a partner still has to pay in show here." />
      ) : (
        <>
          <div className="lgrow legend">
            {buckets.map((b) => <span key={b.key}><i style={{ background: colorOf(b) }} />{b.label}</span>)}
          </div>
          <div role="img" aria-label="Unpaid delivered orders of each partner, split by age" className="chartbox exposure">
            <ResponsiveContainer width="100%" height={rows.length * 34 + 12}>
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 0 }} barCategoryGap={8}>
                <XAxis type="number" hide domain={[0, 'dataMax']} />
                <YAxis type="category" dataKey="name" width={118} axisLine={false} tickLine={false} tick={{ ...AXIS, fill: 'var(--ink)', fontWeight: 600 }} tickFormatter={short} />
                <Tooltip content={<Hover buckets={buckets} />} cursor={{ fill: 'var(--hover)' }} />
                {buckets.map((b) => <Bar key={b.key} dataKey={b.key} stackId="age" fill={colorOf(b)} isAnimationActive={false} />)}
                {/* a bar with no width at the end of the stack, only to carry the partner's total */}
                <Bar dataKey="none" stackId="age" fill="transparent" isAnimationActive={false}>
                  <LabelList dataKey="total" position="right" formatter={(v: number) => formatCurrency(v)} style={{ ...AXIS, fill: 'var(--ink)', fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {top && total > 0 && (
            <p className="note flat">
              {top.name} holds {Math.round((top.unpaidAmount / total) * 100)}% of the unpaid orders. Its late orders ({buckets.filter((b) => b.late).map((b) => b.label).join(' and ')}) are {formatCurrency(lateOf(top.buckets).amount)}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
