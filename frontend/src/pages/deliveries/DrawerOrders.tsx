import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Select, Skeleton, Tag } from '../../components/ui-v2';
import { deliveryPartnersService, type OrderProof, type OrderProofSummary } from '../../services/delivery-partners.service';
import { ordersService, type OrderListRow } from '../../services/orders.service';
import type { OrderStatus } from '../../types';
import { formatCurrency } from '../../utils/format';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { orderNumber, shortDate, STATUS_TONE, customerName } from '../orders/model';
import { ProofBlock, ProofThumb } from './ProofBlock';

const PAGE = 10;
/** Orders that can have a delivery proof or attempts. */
const CLOSED: OrderStatus[] = ['delivered', 'failed_delivery', 'returned'];
const FILTERS: Array<{ id: string; label: string; statuses: OrderStatus[] }> = [
  { id: 'all', label: 'All statuses', statuses: [] },
  { id: 'out_for_delivery', label: ORDER_STATUS_LABELS.out_for_delivery, statuses: ['out_for_delivery'] },
  { id: 'delivered', label: ORDER_STATUS_LABELS.delivered, statuses: ['delivered'] },
  { id: 'failed_delivery', label: ORDER_STATUS_LABELS.failed_delivery, statuses: ['failed_delivery'] },
  { id: 'returned', label: ORDER_STATUS_LABELS.returned, statuses: ['returned'] },
];

/**
 * The orders of one partner with status, date, amount, a proof thumbnail and the attempt count (F-707, F-711, F-713).
 * The photo link and attempt count of the closed orders come in one call per page (GET /api/delivery-partners/:id/order-proofs).
 * The full proof of a row (recipient, time, cash) comes from GET /api/deliveries/by-order/:orderId when it is opened.
 */
export function DrawerOrders({ partnerId }: { partnerId: number }) {
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState<OrderListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [summaries, setSummaries] = useState<Record<number, OrderProofSummary>>({});
  const [details, setDetails] = useState<Record<number, OrderProof | 'error'>>({});
  const [openId, setOpenId] = useState<number | null>(null);
  const ticket = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; ticket.current++; }, []);

  const load = useCallback(async (nextPage: number, status: string) => {
    const mine = ++ticket.current;
    setLoading(true);
    setFailed(false);
    try {
      const statuses = FILTERS.find((f) => f.id === status)?.statuses ?? [];
      const res = await ordersService.listOrders({
        deliveryAgentId: partnerId, page: nextPage, limit: PAGE, sortBy: 'createdAt', sortOrder: 'desc', ...(statuses.length && { status: statuses }),
      });
      if (mine !== ticket.current) return; // a newer filter asked meanwhile
      setRows((cur) => (nextPage === 1 ? res.rows : [...cur, ...res.rows]));
      setTotal(res.pagination.total);
      setPage(nextPage);
      const closed = res.rows.filter((r) => CLOSED.includes(r.status)).map((r) => r.id);
      if (closed.length > 0) {
        // A role that may not read proofs, or a failed call, leaves the rows without a thumbnail
        deliveryPartnersService.orderProofs(partnerId, closed).then(
          (list) => mine === ticket.current && setSummaries((cur) => ({ ...cur, ...Object.fromEntries(list.map((p) => [p.orderId, p])) })),
          () => undefined,
        );
      }
    } catch {
      if (mine === ticket.current) setFailed(true);
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    setSummaries({});
    setOpenId(null);
    void load(1, filter);
  }, [load, filter]);

  const toggle = (id: number) => {
    const opening = openId !== id;
    setOpenId(opening ? id : null);
    if (opening && !details[id]) {
      deliveryPartnersService.orderProof(id).then(
        (d) => alive.current && setDetails((cur) => ({ ...cur, [id]: d })),
        () => alive.current && setDetails((cur) => ({ ...cur, [id]: 'error' })),
      );
    }
  };

  return (
    <div className="dorders">
      <Select compact label="Status" value={filter} onChange={(e) => setFilter(e.target.value)}>
        {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </Select>

      {loading && rows.length === 0 ? (
        <div aria-busy="true" aria-label="Loading orders"><Skeleton height={56} /><Skeleton height={56} className="skelgap" /></div>
      ) : failed && rows.length === 0 ? (
        <EmptyState title="The orders could not load." action={<Button onClick={() => void load(1, filter)}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState title="No orders" text="Orders given to this partner show here." />
      ) : (
        <ul className="dolist" aria-label="Orders of this partner">
          {rows.map((r) => {
            const summary = summaries[r.id];
            const attempts = summary?.attemptCount ?? 0;
            const photo = summary?.photoUrl ?? null;
            return (
              <li key={r.id}>
                <div className="dorow">
                  {CLOSED.includes(r.status) && <div className="dothumb">{photo ? <ProofThumb url={photo} onOpen={() => setOpenId(r.id)} /> : null}</div>}
                  <div className="domain">
                    <Link to={`/orders/${r.id}`}><b>{orderNumber(r.id)}</b></Link> {customerName(r)}
                    <small>{shortDate(r.createdAt)} · {formatCurrency(r.totalAmount)}</small>
                  </div>
                  <div className="doside">
                    <Tag tone={STATUS_TONE[r.status]}>{ORDER_STATUS_LABELS[r.status]}</Tag>
                    {CLOSED.includes(r.status) && (
                      <button type="button" className="linkbtn" aria-expanded={openId === r.id} onClick={() => toggle(r.id)}>
                        {attempts > 0 ? `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}` : 'Proof'}
                      </button>
                    )}
                  </div>
                </div>
                {openId === r.id && <ProofBlock data={details[r.id] ?? null} />}
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="domore">
          <span>Showing {rows.length} of {total.toLocaleString('en-GB')}</span>
          {rows.length < total && <Button size="mini" disabled={loading} onClick={() => void load(page + 1, filter)}>Show more</Button>}
        </div>
      )}
    </div>
  );
}
