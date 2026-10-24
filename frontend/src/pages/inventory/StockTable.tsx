import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, EmptyState, Table, Tag, type Column } from '../../components/ui-v2';
import type { StockRow } from '../../services/inventory.service';
import { ACTION_META, countTag, HOLDER_ACTIONS, SOURCE_LABEL, TYPE_LABEL, type ModalKind } from './model';
import { count } from '../deliveries/model';

interface StockTableProps {
  rows: StockRow[];
  canMove: boolean;
  /** Called with the action and the row it was opened from (holder and product are preselected). */
  onAction: (action: ModalKind, row: StockRow) => void;
}

/** The gap tag: "−12 units" when the count is below our records, "+3 units" when above, Matches, Count is old. */
function Gap({ row }: { row: StockRow }) {
  const c = row.count;
  if (!c) return <span className="mut">—</span>;
  const tag = countTag({ isOld: c.status === 'old', difference: c.difference ?? 0 });
  return (
    <Tag tone={tag.tone}>
      {tag.tone === 'bad' && <AlertTriangle style={{ width: 13, height: 13 }} aria-hidden="true" />}
      {tag.text}
    </Tag>
  );
}

/** Stock by location (F-652): one row per product and holder, with our records next to the latest count. */
export function StockTable({ rows, canMove, onAction }: StockTableProps) {
  const columns = useMemo<Column<StockRow>[]>(() => [
    { key: 'product', header: 'Product', render: (r) => <><b>{r.productName}</b><small className="sub">{r.sku}</small></> },
    { key: 'location', header: 'Location', render: (r) => <>{r.locationName}<small className="sub">{TYPE_LABEL[r.locationType]}</small></> },
    { key: 'onHand', header: 'On hand', right: true, render: (r) => <b className="num">{count(r.onHand)}</b> },
    { key: 'reserved', header: 'Reserved', right: true, render: (r) => <span className="num">{count(r.reserved)}</span> },
    {
      key: 'inTransit',
      header: 'In transit',
      right: true,
      render: (r) => (r.inTransit > 0
        ? <><span className="num">{count(r.inTransit)}</span><Tag tone="warn" className="after">{r.locationType === 'agent' ? 'Awaiting agent' : 'On the way'}</Tag></>
        : <span className="mut">0</span>),
    },
    {
      key: 'vs',
      header: 'Our records vs count',
      right: true,
      render: (r) => (r.count
        ? <span className="num" title={`${SOURCE_LABEL[r.count.source]}`}>{count(r.onHand)} <span className="mut">vs</span> {count(r.count.counted)}</span>
        : <span className="mut">No count</span>),
    },
    { key: 'gap', header: 'Difference', right: true, render: (r) => <Gap row={r} /> },
    ...(canMove ? [{
      key: 'actions',
      header: 'Actions',
      render: (r: StockRow) => (
        <div className="tbtns">
          {HOLDER_ACTIONS[r.locationType].map((action) => {
            const { label, Icon } = ACTION_META[action];
            return <Button key={action} size="icon-sm" title={label} aria-label={`${label}: ${r.productName} at ${r.locationName}`} onClick={() => onAction(action, r)}><Icon /></Button>;
          })}
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
