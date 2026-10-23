import { Link } from 'react-router-dom';
import { Card, EmptyState } from '../../components/ui-v2';
import type { FailureReasons } from '../../services/delivery-partners.service';
import { FAILURE_REASONS } from '../orders/reasons';
import { count } from './model';

const COLOR: Record<string, string> = {
  not_reachable: 'var(--coral)',
  refused: 'var(--gold)',
  wrong_address: 'var(--violet)',
  rescheduled: 'var(--ink-3)',
  other: 'var(--ink-3)',
};
const LABEL = new Map(FAILURE_REASONS);

interface ReasonsCardProps {
  reasons: FailureReasons | null;
  /** "in October": the end of the card sub-line. */
  phrase: string;
  range: { from: string; to: string };
}

/**
 * Failed and returned by reason (F-705). Failed and returned are two figures; the bars count both together.
 * A click on a reason opens Orders filtered by it, for the same dates.
 */
export function ReasonsCard({ reasons, phrase, range }: ReasonsCardProps) {
  if (!reasons) return <Card title="Failed and returned by reason" aside={phrase}><div className="bars" aria-busy="true"><span className="skel" style={{ height: 120 }} /></div></Card>;

  const shown = reasons.reasons.filter((r) => r.count > 0);
  const top = Math.max(1, ...shown.map((r) => r.count));
  const biggest = [...shown].sort((a, b) => b.count - a.count)[0];

  return (
    <Card title="Failed and returned by reason" aside={`${count(reasons.total)} closed unsuccessfully ${phrase}`}>
      {reasons.total === 0 ? (
        <EmptyState title="Nothing failed or returned" text="Failed and returned orders show here with their reasons." />
      ) : (
        <>
          <div className="reasonfig">
            <span>Failed <b className="num">{count(reasons.failed)}</b></span>
            <span>Returned <b className="num">{count(reasons.returned)}</b></span>
          </div>
          <div className="bars">
            {shown.map((r) => (
              <Link
                key={r.reason}
                className="bar-row reasonlink"
                to={`/orders?failure=${r.reason}&from=${range.from}&to=${range.to}`}
                aria-label={`${LABEL.get(r.reason) ?? r.reason}, ${r.count} orders. Open them in Orders`}
              >
                <span>{LABEL.get(r.reason) ?? r.reason}</span>
                <div className="track"><i style={{ width: `${(r.count / top) * 100}%`, background: COLOR[r.reason] }} /></div>
                <span className="val num">{r.percent === null ? '—' : `${Math.round(r.percent)}%`} <small>{count(r.count)}</small></span>
              </Link>
            ))}
          </div>
          {biggest?.reason === 'not_reachable' && (
            <p className="note">Not reachable is the biggest cause. Calling the customer before dispatch is the cheapest fix.</p>
          )}
        </>
      )}
    </Card>
  );
}
