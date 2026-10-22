import { useEffect, useState } from 'react';
import { Phone, RefreshCw, Trash2, Truck } from 'lucide-react';
import { ordersService, type OrderListRow } from '../../services/orders.service';
import type { OrderStatus } from '../../types';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { AgentItems, RepItems } from './AssignItems';
import { PopMenu } from './PopMenu';
import type { Option } from './useFilterOptions';

/**
 * The moves every selected order can make (F-313). Moves depend on the status and the order type, so one order
 * of each kind is asked, not all of them; the answer is the moves they share. A forced move is never offered in bulk.
 */
function BulkStatusItems({ rows, onPick }: { rows: OrderListRow[]; onPick: (s: OrderStatus) => void }) {
  const [common, setCommon] = useState<OrderStatus[] | 'error' | null>(null);

  useEffect(() => {
    let live = true;
    const reps = new Map<string, number>();
    rows.forEach((r) => reps.set(`${r.status}|${r.orderType ?? 'physical'}`, r.id));
    Promise.all([...reps.values()].map((id) => ordersService.getTransitions(id)))
      .then((all) => {
        if (!live) return;
        const [first, ...rest] = all.map((t) => t.normal);
        setCommon((first ?? []).filter((s) => rest.every((list) => list.includes(s))));
      })
      .catch(() => live && setCommon('error'));
    return () => {
      live = false;
    };
  }, [rows]);

  if (common === null) return <p className="note">Loading the moves…</p>;
  if (common === 'error') return <p className="note">The moves could not load.</p>;
  if (common.length === 0) return <p className="note">These orders have no move in common.</p>;
  return (
    <>
      {common.map((s) => (
        <button key={s} type="button" role="menuitem" onClick={() => onPick(s)}>
          {ORDER_STATUS_LABELS[s]}
        </button>
      ))}
    </>
  );
}

interface BulkBarProps {
  rows: OrderListRow[];
  reps: Option[];
  agents: Option[];
  canMove: boolean;
  canAssign: boolean;
  canDelete: boolean;
  onStatus: (s: OrderStatus) => void;
  onRep: (o: Option) => void;
  onAgent: (o: Option) => void;
  onDelete: () => void;
  onClear: () => void;
}

/** The bar that appears when orders are selected (F-313 to F-315). */
export function BulkBar({ rows, reps, agents, canMove, canAssign, canDelete, onStatus, onRep, onAgent, onDelete, onClear }: BulkBarProps) {
  return (
    <div className="bulk" role="region" aria-label="Selected orders">
      <b>{rows.length.toLocaleString('en-GB')} selected</b>
      {canMove && (
        <PopMenu label="Change status" icon={<RefreshCw />}>
          {(close) => <BulkStatusItems rows={rows} onPick={(s) => { close(); onStatus(s); }} />}
        </PopMenu>
      )}
      {canAssign && (
        <>
          <PopMenu label="Assign to call rep" icon={<Phone />}>
            {(close) => <RepItems options={reps} onPick={(o) => { close(); onRep(o); }} />}
          </PopMenu>
          <PopMenu label="Assign to delivery agent" icon={<Truck />}>
            {(close) => <AgentItems options={agents} onPick={(o) => { close(); onAgent(o); }} />}
          </PopMenu>
        </>
      )}
      {canDelete && (
        <button type="button" className="btn del" onClick={onDelete}>
          <Trash2 />
          Delete
        </button>
      )}
      <button type="button" className="mini" style={{ marginLeft: 'auto' }} onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}
