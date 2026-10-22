import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Column } from '../../components/ui-v2';
import type { OrderListRow } from '../../services/orders.service';
import { formatCurrency } from '../../utils/format';
import { AVATAR_TONES, customerName, initials, orderNumber, personName, productSummary, shortDate } from './model';
import { AssignButton, ResizeHandle } from './ColumnParts';
import { COLUMN_LABELS } from './labels';
import { StatusCell } from './StatusCell';
import { FIXED_COLUMNS, type ColumnId } from './useColumnPrefs';

export type SortField = 'id' | 'customer' | 'totalAmount' | 'createdAt';
export interface SortState {
  by: SortField;
  dir: 'asc' | 'desc';
}

export interface ColumnContext {
  selected: Set<number>;
  rows: OrderListRow[];
  onToggleRow: (id: number, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  widthOf: (id: ColumnId) => number;
  setWidth: (id: ColumnId, width: number, commit: boolean) => void;
  hidden: ColumnId[];
  sort?: SortState;
  onSort?: (field: SortField) => void;
  /** The Assign icon of a row. Absent: the column is left out. */
  onAssign?: (row: OrderListRow, trigger: HTMLElement) => void;
  /** The status tag of a row opens its move menu. Absent: the tag is plain. */
  renderStatus?: (row: OrderListRow) => ReactNode;
}

const SORT_OF: Partial<Record<ColumnId, SortField>> = { order: 'id', customer: 'customer', amount: 'totalAmount', date: 'createdAt' };

/** The columns of the Orders table in mockup order (F-307), minus the hidden ones. */
export function buildColumns(ctx: ColumnContext): Column<OrderListRow>[] {
  const allOn = ctx.rows.length > 0 && ctx.rows.every((r) => ctx.selected.has(r.id));
  const someOn = !allOn && ctx.rows.some((r) => ctx.selected.has(r.id));

  const head = (id: ColumnId, label: ReactNode = COLUMN_LABELS[id]): ReactNode => {
    const field = SORT_OF[id];
    const active = field !== undefined && ctx.sort?.by === field;
    return (
      <>
        {field && ctx.onSort ? (
          <button
            type="button"
            className="sorth"
            onClick={() => ctx.onSort?.(field)}
            aria-label={`Sort by ${COLUMN_LABELS[id].toLowerCase()}${active ? `, now ${ctx.sort?.dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
          >
            {label}
            {active && (ctx.sort?.dir === 'asc' ? <ArrowUp /> : <ArrowDown />)}
          </button>
        ) : (
          label
        )}
        <ResizeHandle id={id} width={ctx.widthOf(id)} onResize={ctx.setWidth} />
      </>
    );
  };

  const all: Array<[ColumnId, Column<OrderListRow>]> = [
    ['select', {
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label="Select all orders on this page"
          checked={allOn}
          ref={(el) => { if (el) el.indeterminate = someOn; }}
          onChange={(e) => ctx.onToggleAll(e.target.checked)}
        />
      ),
      render: (r) => (
        // a click on the box must not open the order: the row listens for clicks too
        <input
          type="checkbox"
          className="rc"
          aria-label={`Select order ${orderNumber(r.id)}`}
          checked={ctx.selected.has(r.id)}
          onChange={(e) => ctx.onToggleRow(r.id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    }],
    ['order', { key: 'order', header: head('order'), render: (r) => <b>{orderNumber(r.id)}</b> }],
    ['customer', {
      key: 'customer',
      header: head('customer'),
      render: (r) => {
        const name = customerName(r);
        return (
          <div className="who">
            <div className={`a ${AVATAR_TONES[r.customer.id % AVATAR_TONES.length]}`} aria-hidden="true">{initials(name)}</div>
            <div>
              {name}
              <small>{r.customer.phoneNumber}</small>
            </div>
          </div>
        );
      },
    }],
    ['altPhone', { key: 'altPhone', header: head('altPhone'), render: (r) => r.customer.alternatePhone || <span className="mut">—</span> }],
    ['product', { key: 'product', header: head('product'), render: (r) => productSummary(r) }],
    ['status', { key: 'status', header: head('status'), render: (r) => ctx.renderStatus?.(r) ?? <StatusCell row={r} /> }],
    ['rep', {
      key: 'rep',
      header: head('rep'),
      render: (r) => (r.customerRep ? personName(r.customerRep) : <span className="mut">Unassigned</span>),
    }],
    ['agent', {
      key: 'agent',
      header: head('agent'),
      // F-307: a dash while the order is not confirmed yet, grey "Unassigned" after
      render: (r) =>
        r.deliveryAgent ? personName(r.deliveryAgent) : (
          <span className="mut">{['pending_confirmation', 'payment_pending', 'payment_failed'].includes(r.status) ? '—' : 'Unassigned'}</span>
        ),
    }],
    ['amount', { key: 'amount', header: head('amount'), right: true, render: (r) => <b className="num">{formatCurrency(r.totalAmount)}</b> }],
    ['date', { key: 'date', header: head('date'), render: (r) => <span className="mut">{shortDate(r.createdAt)}</span> }],
  ];
  if (ctx.onAssign) {
    const onAssign = ctx.onAssign;
    all.push(['assign', {
      key: 'assign',
      header: <span className="sr-only">Assign</span>,
      right: true,
      render: (r) => <AssignButton row={r} onAssign={onAssign} />,
    }]);
  }

  return all
    .filter(([id]) => FIXED_COLUMNS.includes(id) || !ctx.hidden.includes(id))
    .map(([id, col]) => ({ ...col, width: ctx.widthOf(id) }));
}
