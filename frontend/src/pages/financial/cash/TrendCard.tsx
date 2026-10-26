import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Button, Card, EmptyState, Select, Skeleton } from '../../../components/ui-v2';
import { financeReportsService } from '../../../services/financeReports.service';
import { todayYmd } from '../../../utils/format';
import { rangeLabel } from '../../reports/format';
import { useBlock } from '../profit/useBlock';
import { TrendChart } from './charts';

const RANGES = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
] as const;

/**
 * Revenue and expenses per day (F-929, M5-T41): delivered revenue by delivery date against expenses by expense date, with a
 * range select. The card and its select stay on screen while the answer loads or fails, so the range can always be changed.
 */
export function TrendCard() {
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('30');
  const days = RANGES.find((r) => r.id === range)!.days;
  const to = todayYmd();
  const from = format(subDays(new Date(`${to}T12:00:00`), days - 1), 'yyyy-MM-dd');
  const block = useBlock(`trend|${from}|${to}`, () => financeReportsService.trend(from, to));
  const trend = block.data;

  return (
    <Card
      title={`Revenue and expenses per ${trend && trend.grouping !== 'day' ? trend.grouping : 'day'}`}
      aside={rangeLabel(from, to)}
      className={`fincard${block.loading && trend ? ' finbusy' : ''}`}
    >
      <div className="trendctl">
        <Select compact label="Range" value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
      </div>
      {block.failed ? (
        <div className="blockerr" role="alert">
          <div><b>Revenue and expenses did not load</b><p>Something went wrong on our side.</p></div>
          <Button size="mini" onClick={block.retry}>Retry</Button>
        </div>
      ) : !trend ? (
        <div aria-busy="true" aria-label="Loading revenue and expenses"><Skeleton height={260} className="skelcard" /></div>
      ) : trend.reports.length === 0 ? (
        <EmptyState title="Nothing delivered or spent" text="No delivered order and no expense in these dates." />
      ) : (
        <>
          <div className="lgrow">
            <span><i style={{ background: 'var(--pine)' }} />Delivered revenue</span>
            <span><i style={{ background: 'var(--coral)', opacity: 0.55 }} />Expenses</span>
          </div>
          <TrendChart trend={trend} summary={`Delivered revenue and expenses, ${rangeLabel(from, to)}`} />
        </>
      )}
    </Card>
  );
}
