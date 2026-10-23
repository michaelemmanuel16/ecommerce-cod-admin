import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tag } from '../../components/ui-v2';
import { ordersService, type OrderListRow, type OrderTransitions } from '../../services/orders.service';
import type { OrderStatus } from '../../types';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { FloatingMenu } from './FloatingMenu';
import { StatusCell } from './StatusCell';
import { orderNumber, STATUS_TONE } from './model';

interface RowStatusProps {
  row: OrderListRow;
  /** The person picked a move. `forced`: it is outside the normal flow. */
  onPick: (target: OrderStatus, forced: boolean) => void;
}

/** The status cell with a tag that opens the moves the order can make now, read from GET /api/orders/:id/transitions (F-313). */
export function RowStatus({ row, onPick }: RowStatusProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [moves, setMoves] = useState<OrderTransitions | 'error' | null>(null);

  useEffect(() => {
    if (!anchor) return;
    let live = true;
    setMoves(null);
    ordersService.getTransitions(row.id).then((m) => live && setMoves(m)).catch(() => live && setMoves('error'));
    return () => {
      live = false;
    };
  }, [anchor, row.id]);

  const close = () => setAnchor(null);
  const pick = (target: OrderStatus, forced: boolean) => {
    close();
    onPick(target, forced);
  };

  const tag = (
    <button
      type="button"
      className="tagbtn"
      aria-haspopup="menu"
      aria-expanded={anchor !== null}
      aria-label={`Change status of ${orderNumber(row.id)}, now ${ORDER_STATUS_LABELS[row.status]}`}
      onClick={(e) => {
        e.stopPropagation(); // the tag must not open the order
        setAnchor(anchor ? null : e.currentTarget);
      }}
    >
      <Tag tone={STATUS_TONE[row.status]}>{ORDER_STATUS_LABELS[row.status]}</Tag>
      <ChevronDown aria-hidden="true" />
    </button>
  );

  return (
    <>
      <StatusCell row={row} tag={tag} />
      {anchor && (
        <FloatingMenu anchor={anchor} label={`Moves for ${orderNumber(row.id)}`} align="left" onClose={close}>
          {moves === null && <p className="note">Loading the moves…</p>}
          {moves === 'error' && <p className="note">The moves could not load.</p>}
          {moves && moves !== 'error' && (
            <>
              {moves.normal.length === 0 && moves.forced.length === 0 && <p className="note">This order has no move from here.</p>}
              {moves.normal.length > 0 && <p>Move to</p>}
              {moves.normal.map((s) => (
                <button key={s} type="button" role="menuitem" onClick={() => pick(s, false)}>
                  {ORDER_STATUS_LABELS[s]}
                </button>
              ))}
              {moves.forced.length > 0 && (
                <>
                  {moves.normal.length > 0 && <hr />}
                  <p>Outside the normal flow</p>
                  {moves.forced.map((s) => (
                    <button key={s} type="button" role="menuitem" onClick={() => pick(s, true)}>
                      {ORDER_STATUS_LABELS[s]}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </FloatingMenu>
      )}
    </>
  );
}
