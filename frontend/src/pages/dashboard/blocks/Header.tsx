import { RefreshCw } from 'lucide-react';
import { Button, Select, Skeleton } from '../../../components/ui-v2';
import { useAuthStore } from '../../../stores/authStore';
import { RANGE_LABELS } from '../copy';
import { clockTime, subLine } from '../format';
import { DASHBOARD_RANGES, type DashboardRange, type Header } from '../types';

interface HeaderProps {
  header: Header | null;
  /** No answer yet: the title shows a placeholder. */
  loading: boolean;
  range: DashboardRange;
  onRange: (range: DashboardRange) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function PageHeader({ header, loading, range, onRange, onRefresh, refreshing }: HeaderProps) {
  const firstName = useAuthStore((s) => s.user?.firstName);
  const title = header ? `Good ${header.greeting}${firstName ? `, ${firstName}` : ''}` : 'Dashboard';
  return (
    <div className="head">
      <div>
        {loading && !header ? (
          <div aria-busy="true" aria-label="Loading header"><Skeleton width={320} height={34} /><Skeleton width={460} height={14} className="skelgap" /></div>
        ) : (
          <>
            <h1>{title}</h1>
            {header && <p>{subLine(header)}</p>}
          </>
        )}
      </div>
      <div className="headtools">
        {header && <span className="updated">Updated {clockTime(header.generatedAt, header.timeZone)}</span>}
        <Button size="icon-sm" onClick={onRefresh} aria-label="Refresh" disabled={refreshing}>
          <RefreshCw className={refreshing ? 'spin' : undefined} />
        </Button>
        <Select compact label="Period" value={range} onChange={(e) => onRange(e.target.value as DashboardRange)}>
          {DASHBOARD_RANGES.map((r) => <option key={r} value={r}>{RANGE_LABELS[r]}</option>)}
        </Select>
      </div>
    </div>
  );
}
