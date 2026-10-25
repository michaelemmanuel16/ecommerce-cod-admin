import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Button, EmptyState, Modal, Pagination, Select, Skeleton, Table, Tabs, Tag, type Column } from '../../components/ui-v2';
import {
  inventoryService, type Overview, type PhysicalProduct, type TrailRow, type Transfer, type TransferFilters, type TransferList, type TransferStatus, type TransferType,
} from '../../services/inventory.service';
import { apiErrorMessage } from '../../utils/apiError';
import { personName } from '../../utils/people';
import { count } from '../deliveries/model';
import { saveBlob } from '../orders/importText';
import { MOVE_LABEL, MOVE_TONE, MOVE_TYPES, placeName, REASON_LABEL, shortDateTime, signedQuantity, statusView } from './model';
import { StatusCell, TransferActions } from './TransferParts';

const PAGE_SIZE = 15;
const STATUSES: Array<{ id: TransferStatus; label: string }> = [
  { id: 'in_transit', label: 'In transit' }, { id: 'disputed', label: 'Received short' }, { id: 'received', label: 'Received' }, { id: 'cancelled', label: 'Cancelled' },
];

interface HistoryModalProps {
  overview: Overview;
  products: PhysicalProduct[];
  /** The transfer to show in the side detail on open (a click on the Recent transfers table). */
  initialId?: number | null;
  canMove: boolean;
  /** Owner, admin and finance clerk. */
  canExport: boolean;
  /** Changes with every answer the page gets, so the list reloads under the open modal. */
  refreshKey: number;
  onClose: () => void;
  onReceive: (t: Transfer) => void;
  onResolve: (t: Transfer) => void;
  onCancel: (t: Transfer) => void;
}

interface Filters {
  tab: TransferType | 'all';
  locationId: number | null;
  productId: number | null;
  status: TransferStatus | null;
  from: string;
  to: string;
  page: number;
}
const BLANK: Filters = { tab: 'all', locationId: null, productId: null, status: null, from: '', to: '', page: 1 };

const apiFilters = (f: Filters): TransferFilters => ({
  ...(f.tab !== 'all' && { type: f.tab }),
  ...(f.locationId !== null && { locationId: f.locationId }),
  ...(f.productId !== null && { productId: f.productId }),
  ...(f.status && { status: f.status }),
  ...(f.from && { from: f.from }),
  ...(f.to && { to: f.to }),
});

/**
 * Transfer history (M4-T28, F-659): tabs with counts per type, filters, the table, and a side detail with the audit trail.
 * Owner, admin and finance clerk download what the filters show as a CSV the server builds. The page mounts the modal only
 * while it is open and keys it by the transfer it opens on, so the filters start fresh each time.
 */
export function HistoryModal({ overview, products, initialId, canMove, canExport, refreshKey, onClose, onReceive, onResolve, onCancel }: HistoryModalProps) {
  const [filters, setFilters] = useState<Filters>(BLANK);
  const [list, setList] = useState<TransferList | null>(null);
  /** The tab counts and the total come with the first page and with every filter change; a later page keeps them. */
  const [totals, setTotals] = useState<Pick<TransferList, 'typeCounts'> & { total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initialId ?? null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let live = true;
    inventoryService.transfers({ ...apiFilters(filters), page: filters.page, limit: PAGE_SIZE, includeCounts: filters.page === 1 }, true)
      .then((l) => {
        if (!live) return;
        setList(l);
        if (l.typeCounts) setTotals({ typeCounts: l.typeCounts, total: l.pagination.total ?? 0 });
        setError(null);
      })
      .catch(() => { if (live) setError('The history could not load.'); });
    return () => { live = false; };
  }, [filters, refreshKey]);

  const change = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, page: 1, ...patch }));
  const selected = list?.transfers.find((t) => t.id === selectedId) ?? null;

  const tabs = useMemo(() => {
    const counts = totals?.typeCounts ?? {};
    return [
      { id: 'all', label: 'All', count: totals ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : undefined },
      ...MOVE_TYPES.filter((t) => (counts[t] ?? 0) > 0 || filters.tab === t).map((t) => ({ id: t, label: MOVE_LABEL[t], count: counts[t] ?? 0 })),
    ];
  }, [totals, filters.tab]);

  const columns = useMemo<Column<Transfer>[]>(() => [
    { key: 'date', header: 'Date', render: (t) => shortDateTime(t.createdAt) },
    { key: 'type', header: 'Type', render: (t) => <Tag tone={MOVE_TONE[t.transferType]}>{MOVE_LABEL[t.transferType]}</Tag> },
    { key: 'from', header: 'From', render: (t) => placeName(t, 'from') },
    { key: 'to', header: 'To', render: (t) => placeName(t, 'to') },
    { key: 'product', header: 'Product', render: (t) => t.product.name },
    { key: 'qty', header: 'Qty', right: true, render: (t) => <span className="num">{signedQuantity(t)}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusCell transfer={t} /> },
  ], []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      saveBlob(await inventoryService.exportCsv(apiFilters(filters)), 'stock-moves.csv');
    } catch (e) {
      setError(apiErrorMessage(e, 'The export failed.'));
    }
    setExporting(false);
  };

  return (
    <Modal
      wide
      open
      onClose={onClose}
      title="Transfer history"
      description="Every allocation, sale, transfer, return and adjustment."
      footer={canExport ? <Button disabled={exporting} onClick={() => void exportCsv()}><Download />Export CSV</Button> : undefined}
    >
      <div className="hist">
        <Tabs label="Move type" items={tabs} value={filters.tab} onChange={(id) => change({ tab: id as Filters['tab'] })} />
        <div className="filters">
          <Select compact label="Filter by holder" value={filters.locationId ?? ''} onChange={(e) => change({ locationId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">All holders</option>
            {overview.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select compact label="Filter by product" value={filters.productId ?? ''} onChange={(e) => change({ productId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select compact label="Filter by status" value={filters.status ?? ''} onChange={(e) => change({ status: (e.target.value || null) as TransferStatus | null })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <input className="datein" type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => change({ from: e.target.value })} />
          <input className="datein" type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => change({ to: e.target.value })} />
        </div>
        <div className={selected ? 'histbody with-detail' : 'histbody'}>
          <div className="histlist">
            {error && !list ? (
              <EmptyState title={error} />
            ) : !list ? (
              <div style={{ padding: 20 }} aria-busy="true" aria-label="Loading history"><Skeleton height={40} /><Skeleton height={40} className="skelgap" /></div>
            ) : list.transfers.length === 0 ? (
              <EmptyState title="No moves match." text="Change the tab or the filters." />
            ) : (
              <Table label="Transfer history" className="tt" columns={columns} rows={list.transfers} rowKey={(t) => t.id} onRowClick={(t) => setSelectedId(t.id)} rowClass={(t) => (t.id === selectedId ? 'picked' : undefined)} />
            )}
            {totals && totals.total > 0 && (
              <Pagination page={filters.page} pageSize={PAGE_SIZE} total={totals.total} noun="moves" onPageChange={(page) => setFilters((f) => ({ ...f, page }))} />
            )}
          </div>
          {selected && <TransferDetail transfer={selected} canMove={canMove} refreshKey={refreshKey} onReceive={onReceive} onResolve={onResolve} onCancel={onCancel} onClose={() => setSelectedId(null)} />}
        </div>
      </div>
    </Modal>
  );
}

interface TransferDetailProps {
  transfer: Transfer;
  canMove: boolean;
  refreshKey: number;
  onReceive: (t: Transfer) => void;
  onResolve: (t: Transfer) => void;
  onCancel: (t: Transfer) => void;
  onClose: () => void;
}

const ACTION_LABEL: Record<string, string> = { create: 'Sent', receive: 'Counted on arrival', resolve: 'Dispute resolved', cancel: 'Cancelled', adjust: 'Quantity adjusted' };

/** Side detail of one move: what moved, who did what and when (the audit rows), and the actions that fit its status. */
function TransferDetail({ transfer: t, canMove, refreshKey, onReceive, onResolve, onCancel, onClose }: TransferDetailProps) {
  const [trail, setTrail] = useState<TrailRow[] | null>(null);
  const [trailFailed, setTrailFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setTrail(null);
    setTrailFailed(false);
    inventoryService.trail(t.id).then((r) => live && setTrail(r)).catch(() => live && setTrailFailed(true));
    return () => { live = false; };
  }, [t.id, t.status, refreshKey]);

  const s = statusView(t);
  return (
    <aside className="histdetail" aria-label={`Transfer ${t.id}`}>
      <div className="hd-top">
        <h4>{t.product.name} &times; {signedQuantity(t)}</h4>
        <Button size="icon-sm" aria-label="Close detail" onClick={onClose}>&times;</Button>
      </div>
      <p className="hd-move">{placeName(t, 'from')} &rarr; {placeName(t, 'to')}</p>
      <dl className="kv">
        <div><dt>Status</dt><dd><Tag tone={s.tone}>{s.text}</Tag>{t.overdue && <Tag tone="warn" className="after">Overdue</Tag>}</dd></div>
        {t.receivedQuantity !== null && <div><dt>Counted</dt><dd>{count(t.receivedQuantity)} of {count(t.quantity)}</dd></div>}
        {t.reason && <div><dt>Reason</dt><dd>{REASON_LABEL[t.reason]}</dd></div>}
        {t.notes && <div><dt>Note</dt><dd>{t.notes}</dd></div>}
        {t.orderId !== null && <div><dt>Order</dt><dd><Link to={`/orders/${t.orderId}`}>Order {t.orderId}</Link></dd></div>}
        <div><dt>Started by</dt><dd>{personName(t.createdBy)}, {shortDateTime(t.createdAt)}</dd></div>
      </dl>
      {canMove && (
        <div className="hd-actions2">
          <TransferActions transfer={t} onReceive={onReceive} onResolve={onResolve} />
          {t.status === 'in_transit' && <Button size="mini" onClick={() => onCancel(t)}>Cancel transfer</Button>}
        </div>
      )}
      <h5>Audit trail</h5>
      {trailFailed ? (
        <p className="hint">The audit trail could not load.</p>
      ) : !trail ? (
        <Skeleton height={34} />
      ) : trail.length === 0 ? (
        <p className="hint">No audit rows. This move is older than the audit log.</p>
      ) : (
        <ol className="trail">
          {trail.map((r) => (
            <li key={r.id}>
              <b>{ACTION_LABEL[r.action] ?? r.action}</b>
              <small>{r.by ? personName(r.by) : 'System'}, {shortDateTime(r.at)}</small>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
