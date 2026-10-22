import { useEffect, useState } from 'react';
import { Card, Tag, type TagTone } from '../../components/ui-v2';
import { ordersService } from '../../services/orders.service';
import type { OrderStatus } from '../../types';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';

/** Plain meaning per status, in the order of the mockup. The rep and agent labels are views over the same status. */
const ROWS: { status: OrderStatus; tone: TagTone; title: string; detail: string }[] = [
  { status: 'pending_confirmation', tone: 'warn', title: 'Waiting for a call', detail: 'order came in from checkout' },
  { status: 'confirmed', tone: 'n', title: 'Customer said yes', detail: 'call rep sees "Waiting to dispatch"' },
  { status: 'preparing', tone: 'n', title: 'Being packed', detail: 'stock is set aside for this order' },
  { status: 'ready_for_pickup', tone: 'n', title: 'Ready for the partner or agent', detail: 'delivery agent sees "To pick up"' },
  { status: 'out_for_delivery', tone: 'v', title: 'With a delivery agent or 3PL', detail: 'cash is not collected yet · agent sees "Out"' },
  { status: 'delivered', tone: 'ok', title: 'Customer has the product', detail: 'counts toward delivered revenue · agent sees "Done"' },
  { status: 'digital_delivered', tone: 'ok', title: 'Paid digital order', detail: 'counts toward delivered revenue' },
  { status: 'failed_delivery', tone: 'bad', title: 'Delivery did not happen', detail: 'refused, wrong address or not reachable · agent sees "Failed"' },
  { status: 'returned', tone: 'bad', title: 'Parcel came back', detail: 'the units go back to stock after a count' },
  { status: 'cancelled', tone: 'bad', title: 'Order will not go ahead', detail: 'declined or wrong number, with a reason · call rep sees "Declined"' },
  { status: 'payment_pending', tone: 'n', title: 'Reserved. Not used yet', detail: 'online orders are created after payment succeeds' },
  { status: 'payment_failed', tone: 'n', title: 'Reserved. Not used yet', detail: 'no order is created for a failed payment' },
];

/** Order statuses (M3-T65, F-1233): the fixed list from the state machine. Read only; there is no "Add status". */
export function StatusesTab() {
  const [statuses, setStatuses] = useState<OrderStatus[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    ordersService.getStatuses().then(setStatuses).catch(() => setFailed(true));
  }, []);

  // The API decides which statuses exist; a status the page has no text for still shows, under its own name
  const rows = statuses?.map((s) => ROWS.find((r) => r.status === s) ?? { status: s, tone: 'n' as TagTone, title: ORDER_STATUS_LABELS[s] ?? s, detail: '' });
  const order = (s: OrderStatus) => { const i = ROWS.findIndex((r) => r.status === s); return i < 0 ? ROWS.length : i; };
  rows?.sort((a, b) => order(a.status) - order(b.status));

  return (
    <Card title="Order statuses" aside="Fixed list. Read only">
      <div style={{ marginTop: 8 }}>
        {rows?.map((r) => (
          <div className="srow" key={r.status}>
            <Tag tone={r.tone} className="lead">{ORDER_STATUS_LABELS[r.status] ?? r.status}</Tag>
            <div>
              <b>{r.title}</b>
              <small>{r.status}{r.detail && ` · ${r.detail}`}</small>
            </div>
          </div>
        ))}
        {failed && <p className="setnote">The order statuses could not be loaded.</p>}
      </div>
      <p className="setinfo">Not reachable, Call back later and Wrong number are call outcomes, not statuses. Not reachable keeps the order in Pending. Declined and Wrong number set Cancelled with a reason.</p>
      <p className="setinfo last">Payment is tracked apart from order status: unpaid, paid by 3PL, paid to you.</p>
    </Card>
  );
}
