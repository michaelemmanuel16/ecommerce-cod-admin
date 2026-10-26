import { Fragment, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button, EmptyState, Tag } from '../../../components/ui-v2';
import type { Failed, ReconRow, Reconciliation, SettlementStatus } from '../../../services/finance-overview.service';
import { shortDay } from '../../dashboard/format';
import { initials } from '../../../utils/people';
import { plural } from '../../dashboard/format';
import { dayRange, money } from './model';

const COLS = 5;

function Result({ row, currency }: { row: ReconRow; currency: string }) {
  const tag: Record<SettlementStatus, JSX.Element> = {
    matched: <Tag tone="ok"><Check />Matched</Tag>,
    short: <Tag tone="bad">Short {money(row.shortAmount, currency)}</Tag>,
    over: <Tag tone="warn">Over {money(row.overAmount, currency)}</Tag>,
    unmatched: <Tag tone="warn">Lines to check</Tag>,
  };
  return (
    <>
      {tag[row.status]}
      {row.status === 'short' && <small>net of fees</small>}
    </>
  );
}

function Detail({ row, currency }: { row: ReconRow; currency: string }) {
  const unpaid = row.unpaid;
  if (!unpaid || unpaid.orders === 0) {
    return <p className="ink3">{row.partnerName} has no unpaid delivered orders left. The gap is not tied to an open order.</p>;
  }
  return (
    <>
      <b>Unpaid delivered orders of {row.partnerName}</b>
      <small className="ink3"> net of the delivery fee the partner keeps</small>
      <ul className="unpaid">
        {unpaid.rows.map((o) => (
          <li key={o.orderId} className="who">
            <div className="a coral">{initials(o.customer ?? o.orderNumber)}</div>
            <div>
              {o.orderNumber}{o.customer ? ` · ${o.customer}` : ''}
              <small>
                Delivered {shortDay(o.deliveredOn)}{o.area ? ` · ${o.area}` : ''}
                {o.orderTotal !== null && ` · ${money(o.orderTotal, currency)}${o.fee !== null ? ` less ${money(o.fee, currency)} fee` : ''}`}
                {` · ${plural(o.ageDays, 'day')} ago`}
              </small>
            </div>
            <b className="num">{money(o.amount, currency)}</b>
          </li>
        ))}
      </ul>
      <p className="ink3">
        {plural(unpaid.orders, 'unpaid order')}, {money(unpaid.amount, currency)} in all.
        {unpaid.orders > unpaid.rows.length && ` Showing the oldest ${unpaid.rows.length}.`}
      </p>
    </>
  );
}

export function ReconciliationCard({ data, range, currency, onRetry }: { data: Reconciliation | Failed; range: { from: string; to: string }; currency: string; onRetry: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const title = 'Payout reconciliation';
  const aside = 'Each payout against its order list. Expected cash = collected − fees';

  if ('message' in data) {
    return (
      <div className="card">
        <div className="ct"><h3>{title}</h3></div>
        <div role="alert"><EmptyState title="The payouts could not load" text={data.message} action={<Button onClick={onRetry}>Try again</Button>} /></div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="ct"><h3>{title}</h3><span>{aside}</span></div>
      {data.rows.length === 0 ? (
        <EmptyState title="No payouts in these dates" text={`Nothing was paid in ${dayRange(range.from, range.to)}.`} />
      ) : (
        <div className="tablewrap">
          <table className="dt" aria-label={title}>
            <thead>
              <tr><th>Date</th><th>Paid by</th><th className="r">Paid in</th><th className="r">Expected after fees</th><th>Result</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const expandable = r.status === 'short';
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td>{shortDay(r.date)}</td>
                      <td>
                        <div className="who">
                          <div className="a gold">{initials(r.partnerName)}</div>
                          <div><b>{r.partnerName}</b> <Tag tone={r.partnerKind === 'company' ? 'v' : 'n'}>{r.partnerKind === 'company' ? '3PL' : 'Agent'}</Tag></div>
                        </div>
                      </td>
                      <td className="r num"><b>{money(r.paidIn, currency)}</b></td>
                      <td className="r num">{plural(r.orders, 'order')}<small>{money(r.expectedAfterFees, currency)}</small></td>
                      <td>
                        <Result row={r} currency={currency} />
                        {expandable && (
                          <div className="rowact">
                            <Button size="mini" variant="primary" aria-expanded={isOpen} aria-controls={`recon-${r.id}`} onClick={() => setOpen(isOpen ? null : r.id)}>
                              {isOpen ? 'Hide unpaid orders' : 'Show unpaid orders'}<ChevronDown className={isOpen ? 'flip' : undefined} />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expandable && isOpen && (
                      <tr id={`recon-${r.id}`} className="detail"><td colSpan={COLS}><Detail row={r} currency={currency} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
