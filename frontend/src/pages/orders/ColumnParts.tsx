import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { UserPlus } from 'lucide-react';
import type { OrderListRow } from '../../services/orders.service';
import { orderNumber } from './model';
import { COLUMN_LABELS } from './labels';
import type { ColumnId } from './useColumnPrefs';

/** Drag the right edge of a header, or focus it and press the arrow keys (F-307). The width is saved when the drag ends. */
export function ResizeHandle({ id, width, onResize }: { id: ColumnId; width: number; onResize: (id: ColumnId, width: number, commit: boolean) => void }) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const start = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => onResize(id, w0 + ev.clientX - x0, false);
    const up = (ev: PointerEvent) => {
      onResize(id, w0 + ev.clientX - x0, true);
      cleanup.current?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    cleanup.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cleanup.current = null;
    };
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    onResize(id, width + (e.key === 'ArrowRight' ? 10 : -10), true);
  };
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${COLUMN_LABELS[id]}`}
      aria-valuenow={width}
      tabIndex={0}
      className="colrz"
      onPointerDown={start}
      onKeyDown={key}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function AssignButton({ row, onAssign }: { row: OrderListRow; onAssign: (row: OrderListRow, trigger: HTMLElement) => void }) {
  return (
    <button
      type="button"
      className="ibtn sm"
      aria-label={`Assign order ${orderNumber(row.id)}`}
      title="Assign"
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation(); // the icon must not open the order
        onAssign(row, e.currentTarget);
      }}
    >
      <UserPlus />
    </button>
  );
}

