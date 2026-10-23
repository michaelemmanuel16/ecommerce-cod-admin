import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton, Tag } from '../../components/ui-v2';
import type { PartnerDetail, PartnerRow } from '../../services/delivery-partners.service';
import { ordersService, type OrderListRow } from '../../services/orders.service';
import { formatCurrency } from '../../utils/format';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { customerName, orderNumber, shortDate, STATUS_TONE } from '../orders/model';
import { SuccessBar } from './SuccessBar';
import { count, days, DATA_SOURCE_LABEL } from './model';

interface DrawerSummaryProps {
  partner: PartnerDetail;
  /** The table row of the period; null when this partner is not in the list now (another tab). */
  row: PartnerRow | null;
  target: number;
}

/** Summary tab (F-707): the row figures, cash held, contact and the last 10 closed orders. */
export function DrawerSummary({ partner, row, target }: DrawerSummaryProps) {
  const [last, setLast] = useState<OrderListRow[] | null>(null);
  useEffect(() => {
    let live = true;
    setLast(null);
    ordersService
      .listOrders({ deliveryAgentId: partner.id, status: ['delivered', 'failed_delivery', 'returned'], limit: 10, sortBy: 'createdAt', sortOrder: 'desc' })
      .then((r) => live && setLast(r.rows), () => live && setLast([]));
    return () => { live = false; };
  }, [partner.id]);

  return (
    <div className="dsummary">
      {row && (
        <div className="dfig">
          <div><span>Assigned</span><b className="num">{count(row.assigned)}</b></div>
          <div><span>Delivered</span><b className="num">{count(row.delivered)}</b></div>
          <div><span>Failed or returned</span><b className="num" title={`Failed ${row.failed}, returned ${row.returned}`}>{count(row.failedOrReturned)}</b></div>
          <div><span>Out now</span><b className="num">{count(row.outNow)}</b></div>
          <div className="wide"><span>Delivery success (target {target}%)</span><SuccessBar rate={row.deliverySuccessRate} target={target} /></div>
          <div><span>Confirmed to dispatched</span><b className="num">{days(row.confirmedToDispatchedDays)}</b></div>
          <div><span>Dispatched to delivered</span><b className="num">{days(row.dispatchedToDeliveredDays)}</b></div>
        </div>
      )}
      <dl className="kv">
        <div><dt>Cash held</dt><dd>—</dd></div>
        <div><dt>Days to pay</dt><dd>{partner.profile.daysToPay}</dd></div>
        <div><dt>Data source</dt><dd>{DATA_SOURCE_LABEL[partner.profile.dataSource]}</dd></div>
        <div><dt>Base town</dt><dd>{partner.profile.baseTown ?? '—'}</dd></div>
        <div><dt>Phone</dt><dd>{partner.phoneNumber ?? '—'}</dd></div>
        <div><dt>Email</dt><dd>{partner.email}</dd></div>
        {partner.kind === 'person' && <div><dt>Vehicle</dt><dd>{[partner.vehicleType, partner.vehicleId].filter(Boolean).join(' ') || '—'}</dd></div>}
        {partner.stockLocation && <div><dt>Stock location</dt><dd>{partner.stockLocation.name}</dd></div>}
      </dl>

      <section>
        <h4>Last closed orders</h4>
        {last === null ? (
          <Skeleton height={56} />
        ) : last.length === 0 ? (
          <p className="mut">No delivered, failed or returned orders yet.</p>
        ) : (
          <ul className="dolist" aria-label="Last closed orders">
            {last.map((r) => (
              <li key={r.id}>
                <div className="dorow">
                  <div className="domain">
                    <Link to={`/orders/${r.id}`}><b>{orderNumber(r.id)}</b></Link> {customerName(r)}
                    <small>{shortDate(r.createdAt)} · {formatCurrency(r.totalAmount)}</small>
                  </div>
                  <div className="doside"><Tag tone={STATUS_TONE[r.status]}>{ORDER_STATUS_LABELS[r.status]}</Tag></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
