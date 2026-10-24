import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, EmptyState, Select } from '../../components/ui-v2';
import { deliveryPartnersService, type OrderProof, type OrderProofSummary } from '../../services/delivery-partners.service';
import { ordersService, type OrderListRow } from '../../services/orders.service';
import type { OrderStatus } from '../../types';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { isClosed } from './model';
import { ListSkeleton } from './ListSkeleton';
import { OrderRow } from './OrderRow';
import { ProofBlock, ProofThumb } from './ProofBlock';

const PAGE = 10;
const FILTERS: Array<{ id: string; label: string; status?: OrderStatus }> = [
  { id: 'all', label: 'All statuses' },
  ...(['out_for_delivery', 'delivered', 'failed_delivery', 'returned'] as const).map((status) => ({ id: status, label: ORDER_STATUS_LABELS[status], status })),
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
      const only = FILTERS.find((f) => f.id === status)?.status;
      const res = await ordersService.listOrders({
        deliveryAgentId: partnerId, page: nextPage, limit: PAGE, sortBy: 'createdAt', sortOrder: 'desc', ...(only && { status: [only] }),
      });
      if (mine !== ticket.current) return; // a newer filter asked meanwhile
      setRows((cur) => (nextPage === 1 ? res.rows : [...cur, ...res.rows]));
      setTotal(res.pagination.total);
      setPage(nextPage);
      const closed = res.rows.filter((r) => isClosed(r.status)).map((r) => r.id);
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
        <ListSkeleton label="Loading orders" />
      ) : failed && rows.length === 0 ? (
        <EmptyState title="The orders could not load." action={<Button onClick={() => void load(1, filter)}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState title="No orders" text="Orders given to this partner show here." />
      ) : (
        <ul className="dolist" aria-label="Orders of this partner">
          {rows.map((r) => {
            const closed = isClosed(r.status);
            const summary = summaries[r.id];
            const attempts = summary?.attemptCount ?? 0;
            return (
              <li key={r.id}>
                <OrderRow
                  row={r}
                  lead={closed && <div className="dothumb">{summary?.photoUrl ? <ProofThumb url={summary.photoUrl} onOpen={() => setOpenId(r.id)} /> : null}</div>}
                  aside={closed && (
                    <button type="button" className="linkbtn" aria-expanded={openId === r.id} onClick={() => toggle(r.id)}>
                      {attempts > 0 ? `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}` : 'Proof'}
                    </button>
                  )}
                />
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
