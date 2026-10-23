import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { Pencil, Bell } from 'lucide-react';
import { Button, Drawer, EmptyState, Modal, Select, Skeleton, Tag, useToast } from '../../../components/ui-v2';
import { ordersService, type OrderDetail, type OrderListRow, type TimelineEntry } from '../../../services/orders.service';
import { callsService } from '../../../services/calls.service';
import { usePermissions } from '../../../hooks/usePermissions';
import { useAuthStore } from '../../../stores/authStore';
import { CallOutcome } from '../../../types';
import { ORDER_STATUS_LABELS } from '../../../utils/orderStatus';
import { formatCurrency } from '../../../utils/format';
import { orderNumber } from '../model';
import { useFilterOptions } from '../useFilterOptions';
import { useOrderActions } from '../useOrderActions';
import { CallsBlock } from './CallsBlock';
import { CustomerEdit, ItemsEdit, PaymentEdit } from './EditBlocks';
import { personName } from '../../../utils/people';
import { buildEdit, accraTime, draftOf, PAYMENT_TONE, type EditDraft } from './model';
import { Timeline } from './Timeline';
import { CustomerView, ItemsView, PaymentView } from './ViewBlocks';

interface OrderDrawerProps {
  /** null: closed. */
  id: number | null;
  onClose: () => void;
}

const reasonOf = (e: unknown): { status?: number; code?: string; message?: string; data?: Record<string, unknown> } =>
  axios.isAxiosError(e) ? { status: e.response?.status, code: e.response?.data?.code, message: e.response?.data?.message ?? e.response?.data?.error, data: e.response?.data } : {};

/**
 * The order details drawer (M3-T46, T47; F-321, F-322, F-318). It opens over the Orders list at /orders/:id.
 * Status and assignment save at once, through the same actions as the list. Edit mode turns Customer, Items and
 * Payment into inputs; the status group decides which. A save carries the `updatedAt` it read, so a second tab's
 * save is refused with STALE_ORDER.
 */
export function OrderDrawer({ id, onClose }: OrderDrawerProps) {
  const say = useToast();
  const { can } = usePermissions();
  const me = useAuthStore((s) => s.user);
  const options = useFilterOptions();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[] | 'error' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(false);
  const [stale, setStale] = useState(false);
  /** Why the Discard prompt is open: closing the drawer, or leaving edit mode. */
  const [discard, setDiscard] = useState<'close' | 'cancel' | null>(null);
  const [taken, setTaken] = useState<{ name: string; customerId: number } | null>(null);
  const [allOrders, setAllOrders] = useState<{ others: number; body: Record<string, unknown> } | null>(null);

  const load = useCallback(async () => {
    if (id === null) return;
    try {
      const [detail, rows] = await Promise.all([
        ordersService.getOrderDetail(id),
        ordersService.getTimeline(id).catch(() => 'error' as const),
      ]);
      setOrder(detail);
      setTimeline(rows);
      setFailed(null);
    } catch (e) {
      const { status, message } = reasonOf(e);
      // A specific 404 sentence from the server ("This order was deleted.") stays; the plain not-found and 403 get one no-access line
      if (status === 404 && message && message !== 'Order not found') setFailed(message);
      else setFailed(status === 404 || status === 403 ? 'You have no access to this order, or it does not exist.' : 'The order could not load.');
    }
  }, [id]);

  // A new order starts clean: nothing from the last one shows while it loads.
  useEffect(() => {
    setOrder(null);
    setTimeline(null);
    setFailed(null);
    setEdit(null);
    setTick(false);
    setStale(false);
    void load();
  }, [id, load]);

  // The list row the shared actions work on (status move, assign).
  const row = useMemo(
    () => (order ? ({ id: order.id, status: order.status, deliveryAgent: order.assignees.deliveryAgent, customerRep: order.assignees.customerRep } as unknown as OrderListRow) : null),
    [order],
  );
  const actions = useOrderActions({ setSelected: () => undefined, refetch: load, setFocus: () => undefined });

  const built = order && edit ? buildEdit(order, edit) : null;
  const dirty = built !== null && built.changed.length > 0;
  const needsTick = built?.total != null && order?.status === 'confirmed';

  const requestClose = () => (dirty ? setDiscard('close') : onClose());
  const canEdit = !!order && !!me && can('orders', 'update') && me.role !== 'delivery_agent' && (me.role !== 'sales_rep' || order.assignees.customerRep?.id === me.id);
  const canAssign = can('orders', 'assign');
  const canLog = !!me && ['super_admin', 'admin', 'manager', 'sales_rep'].includes(me.role);

  const startEdit = () => {
    if (!order) return;
    setEdit(draftOf(order));
    setTick(false);
    setStale(false);
  };
  const stopEdit = () => {
    setEdit(null);
    setTick(false);
  };

  const save = async (confirmPhoneChange = false) => {
    if (!order || !built || built.changed.length === 0 || saving) return;
    if (needsTick && !tick) return;
    setSaving(true);
    try {
      await ordersService.editOrder(order.id, {
        ...built.body,
        updatedAt: order.updatedAt,
        ...(needsTick && { confirmTotalChange: true }),
        ...(confirmPhoneChange && { confirmPhoneChange: true }),
      });
      say(`${orderNumber(order.id)} saved`);
      stopEdit();
      await load();
    } catch (e) {
      const r = reasonOf(e);
      if (r.code === 'STALE_ORDER') setStale(true);
      else if (r.code === 'PHONE_BELONGS_TO_OTHER_CUSTOMER') setTaken({ name: String(r.data?.customerName ?? 'another customer'), customerId: Number(r.data?.customerId) });
      else if (r.code === 'PHONE_CHANGE_NEEDS_CONFIRMATION') setAllOrders({ others: Number(r.data?.otherOrders ?? 0), body: built.body });
      else if (r.code === 'TOTAL_CHANGE_NOT_CONFIRMED') say('Tick the box to confirm the new total.');
      else say(r.message ?? 'The order could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const logCall = async (call: { outcome: string; notes: string }): Promise<boolean> => {
    if (!order) return false;
    try {
      await callsService.createCall({
        customerId: order.customer.id,
        orderId: order.id,
        outcome: call.outcome as CallOutcome,
        ...(call.notes && { notes: call.notes }),
      });
      say('Call logged');
      await load();
      return true;
    } catch (e) {
      say(reasonOf(e).message ?? 'The call could not be logged.');
      return false;
    }
  };

  const set = (patch: Partial<EditDraft>) => setEdit((d) => (d ? { ...d, ...patch } : d));
  const assigned = order?.assignees;
  const moves = order?.transitions;

  const headerExtra = order && (
    <div className="hdr">
      <Tag tone={PAYMENT_TONE[order.paymentTag.code]}>{order.paymentTag.label}</Tag>
      {canEdit && !edit && (
        <Button size="mini" onClick={startEdit}>
          <Pencil aria-hidden="true" style={{ width: 13, height: 13, verticalAlign: -2 }} /> Edit
        </Button>
      )}
    </div>
  );

  const footer = edit ? (
    <>
      <Button onClick={() => (dirty ? setDiscard('cancel') : stopEdit())}>Cancel</Button>
      <Button variant="primary" disabled={!dirty || saving || (needsTick && !tick)} onClick={() => void save()}>
        Save changes
      </Button>
    </>
  ) : (
    <Button onClick={requestClose}>Close</Button>
  );

  return (
    <>
      <Drawer
        open={id !== null}
        wide
        onClose={requestClose}
        title={id === null ? '' : orderNumber(id)}
        description={order ? `${accraTime(order.createdAt)} · ${order.sourceLabel}` : undefined}
        headerExtra={headerExtra}
        footer={id === null ? undefined : footer}
      >
        {id !== null && failed && (
          <EmptyState title={failed} action={<Button onClick={onClose}>Back to orders</Button>} />
        )}
        {id !== null && !failed && !order && (
          <div aria-busy="true" aria-label="Loading the order">
            <Skeleton height={44} />
            <Skeleton height={120} className="skelgap" />
            <Skeleton height={120} className="skelgap" />
          </div>
        )}
        {order && !failed && (
          <>
            {stale && (
              <div className="stale" role="alert">
                This order changed. Reload to see the new data.
                <Button size="mini" onClick={() => { setStale(false); stopEdit(); void load(); }}>Reload</Button>
              </div>
            )}

            <div className="sec">
              <div className="fg">
                <Select
                  label="Order status"
                  value={order.status}
                  disabled={!can('orders', 'update') || !!edit}
                  onChange={(e) => {
                    const target = e.target.value as OrderDetail['status'];
                    if (row) actions.moveStatus([row], target, { forced: moves?.forced.includes(target) });
                  }}
                >
                  <option value={order.status}>{ORDER_STATUS_LABELS[order.status]}</option>
                  {moves?.normal.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
                  {!!moves?.forced.length && (
                    <optgroup label="Outside the normal flow">
                      {moves.forced.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
                    </optgroup>
                  )}
                </Select>
                <div className="fl">
                  <label>Follow up</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button disabled title="Reminders arrive with the Inbox">
                      <Bell aria-hidden="true" /> Set reminder
                    </Button>
                    <span className="hint" style={{ marginTop: 0 }}>No reminder set.</span>
                  </div>
                </div>
              </div>
            </div>

            {edit ? (
              <>
                <ItemsEdit status={order.status} draft={edit} set={set} products={options.products} />
                <CustomerEdit status={order.status} draft={edit} set={set} />
                <PaymentEdit status={order.status} draft={edit} set={set} />
                {needsTick && built?.total && (
                  <label className="tick">
                    <input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} />
                    <span>
                      The customer confirmed {formatCurrency(built.total.was)}. The new total is {formatCurrency(built.total.now)}.
                      <br />
                      Tick to confirm the new total.
                    </span>
                  </label>
                )}
              </>
            ) : (
              <>
                <ItemsView order={order} />
                <CustomerView order={order} />
                {order.notes && (
                  <div className="sec">
                    <h4>Notes</h4>
                    <p>{order.notes}</p>
                  </div>
                )}
                <PaymentView order={order} />
              </>
            )}

            <div className="sec">
              <h4>
                Assigned to
                {canAssign && (assigned?.customerRep || assigned?.deliveryAgent) && row && (
                  <Button size="mini" onClick={() => actions.assign([row], { kind: 'both' })}>Unassign both</Button>
                )}
              </h4>
              <div className="fg">
                <Select
                  label="Call rep"
                  value={assigned?.customerRep?.id ?? ''}
                  disabled={!canAssign}
                  onChange={(e) => {
                    const o = options.reps.find((r) => r.id === Number(e.target.value));
                    if (o && row) actions.assign([row], { kind: 'rep', option: o });
                  }}
                >
                  <option value="" disabled={!!assigned?.customerRep}>Unassigned</option>
                  {assigned?.customerRep && !options.reps.some((r) => r.id === assigned.customerRep!.id) && (
                    <option value={assigned.customerRep.id}>{personName(assigned.customerRep)}</option>
                  )}
                  {options.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
                <Select
                  label="Delivery agent"
                  value={assigned?.deliveryAgent?.id ?? ''}
                  disabled={!canAssign}
                  onChange={(e) => {
                    const o = options.agents.find((a) => a.id === Number(e.target.value));
                    if (o && row) actions.assign([row], { kind: 'agent', option: o });
                  }}
                >
                  <option value="" disabled={!!assigned?.deliveryAgent}>Unassigned</option>
                  {assigned?.deliveryAgent && !options.agents.some((a) => a.id === assigned.deliveryAgent!.id) && (
                    <option value={assigned.deliveryAgent.id}>{personName(assigned.deliveryAgent)}</option>
                  )}
                  {options.agents.map((a) => <option key={a.id} value={a.id} disabled={a.unavailable}>{a.name}{a.unavailable ? ' (not available today)' : ''}</option>)}
                </Select>
              </div>
            </div>

            <div className="sec">
              <h4>Timeline</h4>
              <Timeline entries={timeline} sourceLabel={order.sourceLabel} />
            </div>

            <CallsBlock calls={order.calls} onLog={canLog ? logCall : undefined} me={me ? personName(me) : 'Me'} />

            <div className="sec">
              <h4>Messages</h4>
              <p className="hint">No messages yet. Messages sent to this customer about this order show here.</p>
            </div>

            <div className="sec">
              <h4>Team notes</h4>
              <p className="hint">No notes yet. Team notes arrive with the Inbox.</p>
            </div>
          </>
        )}
      </Drawer>

      {actions.dialogs}

      <Modal
        open={discard !== null}
        onClose={() => setDiscard(null)}
        title="Discard changes?"
        description="You changed this order and did not save."
        footer={
          <>
            <Button onClick={() => setDiscard(null)}>Keep editing</Button>
            <Button variant="danger" onClick={() => { const closing = discard === 'close'; setDiscard(null); stopEdit(); if (closing) onClose(); }}>Discard</Button>
          </>
        }
      >
        <p>The changes will be lost.</p>
      </Modal>
      <Modal
        open={taken !== null}
        onClose={() => setTaken(null)}
        title={`This number belongs to ${taken?.name ?? ''}`}
        footer={<Button onClick={() => setTaken(null)}>Close</Button>}
      >
        <p>
          Use another number, or open <Link to={`/customers/${taken?.customerId}`}>{taken?.name}</Link>.
        </p>
      </Modal>
      <Modal
        open={allOrders !== null}
        onClose={() => setAllOrders(null)}
        title="Update the number for all of this customer's orders?"
        footer={
          <>
            <Button onClick={() => setAllOrders(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setAllOrders(null); void save(true); }}>Yes</Button>
          </>
        }
      >
        <p>This customer has {allOrders?.others.toLocaleString('en-GB')} other {allOrders?.others === 1 ? 'order' : 'orders'}. They get the new number too.</p>
      </Modal>
    </>
  );
}
