import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import axios from 'axios';
import { Button, ConfirmDialog, Modal, useToast } from '../../components/ui-v2';
import { ordersService, type BulkResult, type OrderListRow, type StatusMoveExtras } from '../../services/orders.service';
import type { OrderStatus } from '../../types';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { orderNumber, personName } from './model';
import { ReasonDialog } from './ReasonDialog';
import { reasonKind } from './reasons';
import type { Option } from './useFilterOptions';

/** Orders the person asked to see after a bulk change: the ones that did not move, with why. */
export interface FocusSet {
  ids: number[];
  text: string;
  reasons: Array<{ id: number; message: string }>;
}

interface Deps {
  setSelected: Dispatch<SetStateAction<Set<number>>>;
  refetch: () => Promise<void>;
  setFocus: (focus: FocusSet | null) => void;
}

type Who = { kind: 'rep' | 'agent'; option: Option } | { kind: 'both' };
interface Pending {
  rows: OrderListRow[];
  bulk: boolean;
}

const orders = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'order' : 'orders'}`;
/** A refused change carries its own plain sentence (`error`); anything else gets the fallback. */
const whyNot = (e: unknown, fallback: string): string =>
  (axios.isAxiosError(e) && (e.response?.data?.error || e.response?.data?.message)) || fallback;
const codeOf = (e: unknown): string | undefined => (axios.isAxiosError(e) ? e.response?.data?.code : undefined);

/**
 * What a person does to orders from the list (M3-T44, F-313 to F-316): move status through the machine, assign,
 * unassign, delete. One request per action. A bulk action reports order by order; the orders that failed stay
 * selected and "Show the N" narrows the table to them. Dialogs come back as `dialogs` for the page to draw.
 */
export function useOrderActions({ setSelected, refetch, setFocus }: Deps) {
  const say = useToast();
  const [reason, setReason] = useState<(Pending & { target: OrderStatus; forced: boolean }) | null>(null);
  const [blocked, setBlocked] = useState<{ name: string; retry: () => void } | null>(null);
  const [handOver, setHandOver] = useState<{ text: string; go: () => void } | null>(null);
  const [deleting, setDeleting] = useState<OrderListRow[] | null>(null);

  /** Keep the failed orders selected, drop the rest, and offer "Show the N". */
  const report = useCallback((result: BulkResult, doneText: string, failText: string) => {
    const bad = result.failed.length;
    setSelected(new Set(result.failed.map((f) => f.id)));
    if (bad === 0) {
      say(doneText);
    } else {
      const ids = result.failed.map((f) => f.id);
      say(failText, {
        label: bad === 1 ? 'Show it' : `Show the ${bad}`,
        onClick: () => setFocus({ ids, text: `${orders(bad)} could not move.`, reasons: result.failed.map((f) => ({ id: f.id, message: f.message })) }),
      });
    }
    void refetch();
  }, [say, setSelected, setFocus, refetch]);

  /* ---- status (F-313) ---- */

  const runMove = useCallback(async (p: Pending, target: OrderStatus, extras: StatusMoveExtras) => {
    const label = ORDER_STATUS_LABELS[target];
    try {
      if (!p.bulk) {
        await ordersService.updateOrderStatus(p.rows[0].id, target, undefined, extras);
        say(`${orderNumber(p.rows[0].id)} is now ${label}`);
        setSelected((s) => { const n = new Set(s); n.delete(p.rows[0].id); return n; });
        void refetch();
        return;
      }
      const result = await ordersService.bulkStatus({ orderIds: p.rows.map((r) => r.id), status: target, ...extras });
      const ok = result.succeeded.length;
      report(result, `Changed ${orders(ok)} to ${label}`, `${orders(ok)} moved to ${label}. ${result.failed.length.toLocaleString('en-GB')} could not move`);
    } catch (e) {
      say(whyNot(e, 'The status could not be changed.'));
    }
  }, [say, report, refetch, setSelected]);

  const moveStatus = useCallback((rows: OrderListRow[], target: OrderStatus, opts: { forced?: boolean; bulk?: boolean } = {}) => {
    const p = { rows, bulk: opts.bulk ?? false };
    // Owner 2026-10-22: Delivered never asks for a reason, even outside the normal flow (COD-139)
    const ask = reasonKind(target) || (opts.forced && target !== 'delivered' && target !== 'digital_delivered');
    if (ask) setReason({ ...p, target, forced: opts.forced ?? false });
    else void runMove(p, target, opts.forced ? { force: true } : {});
  }, [runMove]);

  /* ---- assign (F-314) ---- */

  const runAssign = useCallback(async (p: Pending, who: Who, confirmBlocked: boolean) => {
    const n = p.rows.length;
    const ids = p.rows.map((r) => r.id);
    try {
      if (!p.bulk) {
        const id = ids[0];
        if (who.kind === 'rep') await ordersService.assignRep(id, who.option.id);
        else if (who.kind === 'agent') await ordersService.assignAgent(id, who.option.id, confirmBlocked);
        else await ordersService.unassignBoth(id);
      } else {
        const body = { orderIds: ids, confirmBlocked, ...(who.kind === 'rep' ? { customerRepId: who.option.id } : who.kind === 'agent' ? { deliveryAgentId: who.option.id } : { unassign: 'both' as const }) };
        const result = await ordersService.bulkAssign(body);
        const ok = result.succeeded.length;
        const text = who.kind === 'both' ? `Unassigned ${orders(ok)}` : who.kind === 'rep' ? `${who.option.name} will call ${orders(ok)}` : `${who.option.name} will deliver ${orders(ok)}`;
        report(result, text, `${ok.toLocaleString('en-GB')} assigned. ${result.failed.length.toLocaleString('en-GB')} could not be assigned`);
        return;
      }
      say(who.kind === 'both' ? `Unassigned ${orders(n)}` : who.kind === 'rep' ? `${who.option.name} will call ${orders(n)}` : `${who.option.name} will deliver ${orders(n)}`);
      setSelected((s) => { const next = new Set(s); ids.forEach((id) => next.delete(id)); return next; });
      void refetch();
    } catch (e) {
      // A partner blocked for unpaid cash can still be picked once the owner confirms (F-314).
      if (codeOf(e) === 'PARTNER_BLOCKED' && who.kind === 'agent' && !confirmBlocked) {
        setBlocked({ name: who.option.name, retry: () => void runAssign(p, who, true) });
        return;
      }
      say(whyNot(e, 'The order could not be assigned.'));
    }
  }, [say, report, refetch, setSelected]);

  const assign = useCallback((rows: OrderListRow[], who: Who, opts: { bulk?: boolean } = {}) => {
    const p = { rows, bulk: opts.bulk ?? false };
    // Out for delivery with someone else: the owner is asked before the order changes hands.
    const away = who.kind === 'agent' ? rows.filter((r) => r.status === 'out_for_delivery' && r.deliveryAgent && r.deliveryAgent.id !== who.option.id) : [];
    if (who.kind === 'agent' && away.length > 0) {
      const text = away.length === 1 && rows.length === 1
        ? `This order is with ${personName(away[0].deliveryAgent!)}. Move it to ${who.option.name}?`
        : `${orders(away.length)} ${away.length === 1 ? 'is' : 'are'} out for delivery with another agent. Move ${away.length === 1 ? 'it' : 'them'} to ${who.option.name}?`;
      setHandOver({ text, go: () => void runAssign(p, who, false) });
      return;
    }
    void runAssign(p, who, false);
  }, [runAssign]);

  /* ---- delete (F-315, F-316) ---- */

  const runDelete = useCallback(async (rows: OrderListRow[]) => {
    try {
      const result = await ordersService.bulkDeleteOrders(rows.map((r) => r.id));
      const skipped = result.skipped ?? [];
      if (result.deleted === 0) {
        say('None of these orders can be deleted.');
        return;
      }
      const gone = new Set(rows.map((r) => r.id).filter((id) => !skipped.some((s) => s.id === id)));
      setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
      if (skipped.length === 0) say(`Deleted ${orders(result.deleted)}`);
      else {
        say(`Deleted ${orders(result.deleted)}. ${skipped.length.toLocaleString('en-GB')} could not be deleted`, {
          label: skipped.length === 1 ? 'Show it' : `Show the ${skipped.length}`,
          onClick: () => setFocus({ ids: skipped.map((s) => s.id), text: `${orders(skipped.length)} could not be deleted.`, reasons: skipped.map((s) => ({ id: s.id, message: s.reason })) }),
        });
      }
      void refetch();
    } catch (e) {
      say(whyNot(e, 'The orders could not be deleted.'));
    }
  }, [say, setSelected, setFocus, refetch]);

  const dialogs = (
    <>
      <ReasonDialog
        open={reason ? {
          target: reason.target,
          count: reason.rows.length,
          first: orderNumber(reason.rows[0].id),
          forced: reason.forced,
        } : null}
        onClose={() => setReason(null)}
        onSubmit={(extras) => {
          if (!reason) return;
          const { target, rows, bulk } = reason;
          setReason(null);
          void runMove({ rows, bulk }, target, extras);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const rows = deleting ?? [];
          setDeleting(null);
          void runDelete(rows);
        }}
        action="Delete"
        count={deleting?.length ?? 0}
        noun="order"
      >
        {deleting && `${orders(deleting.length)} will be deleted. You cannot undo this.`}
      </ConfirmDialog>
      <Modal
        open={blocked !== null}
        onClose={() => setBlocked(null)}
        title="Blocked for unpaid cash"
        footer={
          <>
            <Button onClick={() => setBlocked(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => { const b = blocked; setBlocked(null); b?.retry(); }}>
              Assign anyway
            </Button>
          </>
        }
      >
        <p>{blocked?.name} is blocked for unpaid cash. Assign the order anyway?</p>
      </Modal>
      <Modal
        open={handOver !== null}
        onClose={() => setHandOver(null)}
        title="Change the delivery agent?"
        footer={
          <>
            <Button onClick={() => setHandOver(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => { const h = handOver; setHandOver(null); h?.go(); }}>
              Move it
            </Button>
          </>
        }
      >
        <p>{handOver?.text}</p>
      </Modal>
    </>
  );

  return { moveStatus, assign, askDelete: setDeleting, dialogs };
}
