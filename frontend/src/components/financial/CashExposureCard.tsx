import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState } from '../ui-v2';
import type { AgingReport, BucketKey } from '../../services/collections.service';
import { formatCurrency } from '../../utils/format';
import { AXIS } from '../../pages/reports/charts';
import { bucketColor } from '../../pages/financial/collections/model';

const BUCKETS: ReadonlyArray<{ key: BucketKey; label: string }> = [
  { key: '0-3', label: '0–3 days' },
  { key: '4-7', label: '4–7 days' },
  { key: '8-14', label: '8–14 days' },
  { key: '15+', label: '15+ days' },
];
/** The 15+ bucket is violet in the mockup's legend; the late 8-14 bucket stays coral like the table. */
const colorOf = (key: BucketKey): string => (key === '15+' ? 'var(--violet)' : bucketColor(key));
const short = (name: string): string => (name.length > 16 ? `${name.slice(0, 15)}…` : name);

interface Row { name: string; total: number; [bucket: string]: number | string }

function Hover({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="charttip">
      <b>{row.name}</b>
      {BUCKETS.map((b) => <span key={b.key}>{b.label} <em className="num">{formatCurrency(row[b.key] as number)}</em></span>)}
    </div>
  );
}

/**
 * "Cash exposure by partner" (M5-T36): unpaid delivered orders per partner, split by the age of the orders. Drawn from the
 * aging report the page already holds, so it costs no request.
 */
export function CashExposureCard({ report }: { report: AgingReport }) {
  const rows: Row[] = report.partners
    .filter((p) => p.unpaidAmount > 0)
    .map((p) => ({
      name: p.name,
      total: p.unpaidAmount,
      none: 0,
      ...Object.fromEntries(BUCKETS.map((b) => [b.key, p.buckets.find((x) => x.key === b.key)?.amount ?? 0])),
    }));
  const total = report.summary.totalOutstandingAmount;
  const top = rows.reduce<Row | null>((best, r) => (best === null || r.total > best.total ? r : best), null);

  return (
    <Card title="Cash exposure by partner" aside="Unpaid delivered orders, by age of the orders">
      {rows.length === 0 ? (
        <EmptyState title="No partner holds unpaid orders" text="Delivered orders that a partner still has to pay in show here." />
      ) : (
        <>
          <div className="lgrow legend">
            {BUCKETS.map((b) => <span key={b.key}><i style={{ background: colorOf(b.key) }} />{b.label}</span>)}
          </div>
          <div role="img" aria-label="Unpaid delivered orders of each partner, split by age" className="chartbox exposure">
            <ResponsiveContainer width="100%" height={rows.length * 34 + 12}>
              <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 70, bottom: 4, left: 0 }} barCategoryGap={8}>
                <XAxis type="number" hide domain={[0, 'dataMax']} />
                <YAxis type="category" dataKey="name" width={118} axisLine={false} tickLine={false} tick={{ ...AXIS, fill: 'var(--ink)', fontWeight: 600 }} tickFormatter={short} />
                <Tooltip content={<Hover />} cursor={{ fill: 'var(--hover)' }} />
                {BUCKETS.map((b) => <Bar key={b.key} dataKey={b.key} stackId="age" fill={colorOf(b.key)} isAnimationActive={false} />)}
                {/* a bar with no width at the end of the stack, only to carry the partner's total */}
                <Bar dataKey="none" stackId="age" fill="transparent" isAnimationActive={false}>
                  <LabelList dataKey="total" position="right" formatter={(v: number) => formatCurrency(v)} style={{ ...AXIS, fill: 'var(--ink)', fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {top && total > 0 && (
            <p className="note" style={{ paddingTop: 0 }}>
              {top.name} holds {Math.round((top.total / total) * 100)}% of the unpaid orders. Its 8 days or older orders are {formatCurrency((top['8-14'] as number) + (top['15+'] as number))}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
