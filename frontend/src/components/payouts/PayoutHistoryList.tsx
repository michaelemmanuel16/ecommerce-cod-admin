import { Button, EmptyState } from '../ui-v2';
import { ListSkeleton } from '../../pages/deliveries/ListSkeleton';
import type { PayoutRow } from '../../services/payouts.service';
import { formatCurrency, formatDate } from '../../utils/format';
import { personName } from '../../utils/people';

interface PayoutHistoryListProps {
  /** undefined while the first answer is on its way. */
  rows: PayoutRow[] | undefined;
  failed: boolean;
  onRetry: () => void;
}

/**
 * The one payout history list (F-913, F-1164): Finance's Rep commissions tab and the Staff Pay card both draw it from the same
 * rows, so a payout recorded in either place reads the same in both. The columns are the PRD's: date, person, amount, method,
 * notes, recorded by.
 */
export function PayoutHistoryList({ rows, failed, onRetry }: PayoutHistoryListProps) {
  if (!rows) {
    return failed
      ? <EmptyState title="The payout history could not load." action={<Button onClick={onRetry}>Try again</Button>} />
      : <ListSkeleton label="Loading payout history" rows={2} height={36} />;
  }
  if (rows.length === 0) return <EmptyState title="No payout yet" text="A payout you record shows here." />;
  return (
    <div className="tablewrap">
      <table className="dt" aria-label="Payout history">
        <thead><tr><th>Date</th><th>Person</th><th className="r">Amount</th><th>Method</th><th>Notes</th><th>Recorded by</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{formatDate(p.payoutDate, 'd MMM')}</td>
              <td><b>{personName(p.payee)}</b></td>
              <td className="r num">{formatCurrency(p.amount)}</td>
              <td>{p.method}</td>
              <td>{p.notes ?? p.reference ?? '—'}</td>
              <td>{p.recordedBy ? personName(p.recordedBy) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
