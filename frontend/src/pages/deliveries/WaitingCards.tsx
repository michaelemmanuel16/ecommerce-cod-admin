import { Link } from 'react-router-dom';
import { Card, EmptyState, Tag } from '../../components/ui-v2';
import type { PartnerRow, WaitingList } from '../../services/delivery-partners.service';
import { formatCurrency } from '../../utils/format';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { initials } from '../../utils/people';
import { orderNumber } from '../orders/model';
import { count, toneOf } from './model';

/** Orders confirmed but not dispatched, oldest first, with the partner that would take each (F-715). */
export function WaitingCard({ waiting }: { waiting: WaitingList }) {
  const more = waiting.orders - waiting.list.length;
  return (
    <Card
      title="Waiting to dispatch"
      aside={waiting.oldestDays === null ? 'None waiting' : `${count(waiting.orders)} orders, oldest ${waiting.oldestDays} ${waiting.oldestDays === 1 ? 'day' : 'days'}`}
    >
      {waiting.list.length === 0 ? (
        <EmptyState title="Nothing is waiting" text="Confirmed orders that have not gone out show here." />
      ) : (
        <ul className="waitlist" aria-label="Orders waiting to dispatch">
          {waiting.list.map((o) => (
            <li key={o.orderId}>
              <div className="wl-main">
                <Link to={`/orders/${o.orderId}`}><b>{orderNumber(o.orderId)}</b></Link> {o.customerName}
                <small>{[o.area, o.region].filter(Boolean).join(', ') || 'No address'} · {ORDER_STATUS_LABELS[o.status]}{o.total ? ` · ${formatCurrency(o.total)}` : ''}</small>
              </div>
              <div className="wl-side">
                <Tag tone={o.overdue ? 'bad' : 'n'}>{o.ageDays} {o.ageDays === 1 ? 'day' : 'days'}</Tag>
                <small>{o.partner ? o.partner.name : 'No partner yet'}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="note">Showing the oldest {waiting.list.length} of {count(waiting.orders)}. Orders older than {waiting.overdueAfterDays} days are marked.</p>}
    </Card>
  );
}

/** Orders out for delivery, grouped by partner (F-715). A row opens that partner's orders in Orders. */
export function OutNowCard({ rows }: { rows: PartnerRow[] }) {
  const out = rows.filter((r) => r.outNow > 0).sort((a, b) => b.outNow - a.outNow);
  const total = out.reduce((sum, r) => sum + r.outNow, 0);
  const top = Math.max(1, ...out.map((r) => r.outNow));
  return (
    <Card title="Out for delivery now" aside={out.length ? `${count(total)} orders across ${out.length} ${out.length === 1 ? 'partner' : 'partners'}` : undefined}>
      {out.length === 0 ? (
        <EmptyState title="Nothing is out" text="Orders that are out with a partner show here, grouped by partner." />
      ) : (
        <div className="bars">
          {out.map((r) => (
            <Link key={r.partnerId} className="bar-row outlink" to={`/orders?status=out_for_delivery&agent=${r.partnerId}`} aria-label={`${r.name}, ${r.outNow} orders out. Open them in Orders`}>
              <span className="who">
                <span className={`a ${toneOf(r.partnerId)}`} aria-hidden="true">{initials(r.name)}</span>
                <span>{r.name}</span>
              </span>
              <div className="track"><i style={{ width: `${(r.outNow / top) * 100}%`, background: 'var(--pine)' }} /></div>
              <span className="val num">{count(r.outNow)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
