import { useMemo } from 'react';
import { AlertTriangle, ArrowLeftRight, PackagePlus, SlidersHorizontal, Undo2 } from 'lucide-react';
import { Button, EmptyState, Table, Tag, type Column } from '../../components/ui-v2';
import type { StockLocationType, StockRow } from '../../services/inventory.service';
import { num, SOURCE_LABEL, TYPE_LABEL } from './model';
import type { StockAction } from './urlState';

interface StockTableProps {
  rows: StockRow[];
  canMove: boolean;
  /** Called with the action and the row it was opened from (holder and product are preselected). */
  onAction: (action: StockAction, row: StockRow) => void;
}

const ACTIONS: Record<StockLocationType, Array<{ action: StockAction; label: string; Icon: typeof PackagePlus }>> = {
  own_store: [{ action: 'allocate', label: 'Allocate to an agent', Icon: PackagePlus }, { action: 'adjust', label: 'Adjust quantity', Icon: SlidersHorizontal }],
  partner_3pl: [{ action: 'allocate', label: 'Allocate to an agent', Icon: PackagePlus }, { action: 'adjust', label: 'Adjust quantity', Icon: SlidersHorizontal }],
  agent: [
    { action: 'return', label: 'Return to warehouse', Icon: Undo2 },
    { action: 'transfer', label: 'Transfer to another agent', Icon: ArrowLeftRight },
    { action: 'adjust', label: 'Adjust quantity', Icon: SlidersHorizontal },
  ],
};

/** The gap tag: "−12 units" when the count is below our records, "+3 units" when above, Matches, Count is old. */
function Gap({ row }: { row: StockRow }) {
  const c = row.count;
  if (!c) return <span className="mut">—</span>;
  if (c.status === 'old') return <Tag tone="warn">Count is old</Tag>;
  if (c.status === 'matches' || c.difference === null) return <Tag tone="ok">Matches</Tag>;
  const units = Math.abs(c.difference);
  return (
    <Tag tone="bad">
      <AlertTriangle style={{ width: 13, height: 13 }} aria-hidden="true" />
      {c.difference > 0 ? '−' : '+'}{num(units)} {units === 1 ? 'unit' : 'units'}
    </Tag>
  );
}

/** Stock by location (F-652): one row per product and holder, with our records next to the latest count. */
export function StockTable({ rows, canMove, onAction }: StockTableProps) {
  const columns = useMemo<Column<StockRow>[]>(() => [
    { key: 'product', header: 'Product', render: (r) => <><b>{r.productName}</b><small className="sub">{r.sku}</small></> },
    { key: 'location', header: 'Location', render: (r) => <>{r.locationName}<small className="sub">{TYPE_LABEL[r.locationType]}</small></> },
    { key: 'onHand', header: 'On hand', right: true, render: (r) => <b className="num">{num(r.onHand)}</b> },
    { key: 'reserved', header: 'Reserved', right: true, render: (r) => <span className="num">{num(r.reserved)}</span> },
    {
      key: 'inTransit',
      header: 'In transit',
      right: true,
      render: (r) => (r.inTransit > 0
        ? <><span className="num">{num(r.inTransit)}</span><Tag tone="warn" className="after">{r.locationType === 'agent' ? 'Awaiting agent' : 'On the way'}</Tag></>
        : <span className="mut">0</span>),
    },
    {
      key: 'vs',
      header: 'Our records vs count',
      right: true,
      render: (r) => (r.count
        ? <span className="num" title={`${SOURCE_LABEL[r.count.source]}`}>{num(r.onHand)} <span className="mut">vs</span> {num(r.count.counted)}</span>
        : <span className="mut">No count</span>),
    },
    { key: 'gap', header: 'Difference', right: true, render: (r) => <Gap row={r} /> },
    ...(canMove ? [{
      key: 'actions',
      header: 'Actions',
      render: (r: StockRow) => (
        <div className="tbtns">
          {ACTIONS[r.locationType].map(({ action, label, Icon }) => (
            <Button key={action} size="icon-sm" title={label} aria-label={`${label}: ${r.productName} at ${r.locationName}`} onClick={() => onAction(action, r)}><Icon /></Button>
          ))}
        </div>
      ),
    }] : []),
  ], [canMove, onAction]);

  if (rows.length === 0) return <EmptyState title="No stock matches." text="Change the filters, or move stock to a location." />;
  return (
    <Table
      label="Stock by location"
      className="st"
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.locationId}:${r.productId}`}
      rowClass={(r) => (r.count?.status === 'off' ? 'diff' : undefined)}
    />
  );
}
