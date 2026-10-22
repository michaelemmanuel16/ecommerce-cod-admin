import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus, Upload } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, EmptyState, Pagination, Skeleton, Table, Tabs, useToast } from '../components/ui-v2';
import { BulkImportModal } from '../components/orders/BulkImportModal';
import { OrderForm } from '../components/forms/OrderForm';
import { usePermissions } from '../hooks/usePermissions';
import { ordersService } from '../services/orders.service';
import { buildColumns, type SortField } from './orders/columns';
import { ColumnsMenu } from './orders/ColumnsMenu';
import { FilterBar } from './orders/FilterBar';
import { STATUS_TABS, tabCount, visibleTabs, type StatusTabId } from './orders/model';
import { readPref, writePref } from './orders/prefs';
import { DEFAULT_SIZE, PAGE_SIZES, listParams, parseView, rangeOf, rangePhrase, sizeOf, writeView, type ListView } from './orders/urlState';
import { useColumnPrefs } from './orders/useColumnPrefs';
import { useFilterOptions } from './orders/useFilterOptions';
import { useOrdersList } from './orders/useOrdersList';

interface OrdersProps {
  /** A row click calls this. The default goes to /orders/:id; the order drawer (M3-T46) plugs in here. */
  onOpen?: (id: number) => void;
}

/**
 * The Orders list (M3-T42, F-307, F-308), built from docs/mockups/v2/index.html#orders.
 * The view (tab, page) is in the URL, so a copied link opens the same list. There is no Kanban view (F-327).
 */
export function Orders({ onOpen }: OrdersProps) {
  useV2Page();
  const navigate = useNavigate();
  const say = useToast();
  const { can } = usePermissions();
  const [search, setSearch] = useSearchParams();
  const view = useMemo(() => parseView(search), [search]);
  // the page size: the link's, else the one this person saved (F-310)
  const [savedSize, setSavedSize] = useState(() => readPref<number>('pageSize', DEFAULT_SIZE));
  const pageSize = sizeOf(view, (PAGE_SIZES as readonly number[]).includes(savedSize) ? savedSize : DEFAULT_SIZE);
  const params = useMemo(() => listParams(view, pageSize), [view, pageSize]);
  const list = useOrdersList(params);
  const columnPrefs = useColumnPrefs();
  const options = useFilterOptions();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const go = useCallback((next: ListView, replace = false) => setSearch(writeView(next), { replace }), [setSearch]);

  // A new view starts with nothing selected; a silent refresh keeps the selection.
  const viewKey = JSON.stringify(params);
  useEffect(() => setSelected(new Set()), [viewKey]);

  const open = (id: number) => (onOpen ? onOpen(id) : navigate(`/orders/${id}`));

  // First click on a column sorts newest / biggest first (names, a to z); a second click turns it round.
  const onSort = (by: SortField) =>
    go({ ...view, page: 1, sort: { by, dir: view.sort.by === by ? (view.sort.dir === 'asc' ? 'desc' : 'asc') : by === 'customer' ? 'asc' : 'desc' } });

  const columns = useMemo(
    () =>
      buildColumns({
        selected,
        rows: list.rows,
        onToggleRow: (id, on) =>
          setSelected((s) => {
            const next = new Set(s);
            if (on) next.add(id);
            else next.delete(id);
            return next;
          }),
        onToggleAll: (on) => setSelected(on ? new Set(list.rows.map((r) => r.id)) : new Set()),
        widthOf: columnPrefs.widthOf,
        setWidth: columnPrefs.setWidth,
        hidden: columnPrefs.hidden,
        sort: view.sort,
        onSort,
      }),
    [selected, list.rows, columnPrefs.widthOf, columnPrefs.setWidth, columnPrefs.hidden, view],
  );
  const tableWidth = columns.reduce((sum, c) => sum + (typeof c.width === 'number' ? c.width : 0), 0);

  const tabs = visibleTabs(list.counts, view.tab).map((t) => ({
    id: t.id,
    label: t.label,
    count: list.counts ? tabCount(t.id, list.counts).toLocaleString('en-GB') : undefined,
  }));

  const exportOrders = async () => {
    setExporting(true);
    try {
      await ordersService.exportOrders({ status: STATUS_TABS.find((t) => t.id === view.tab)?.statuses });
      say('Orders exported');
    } catch {
      say('The orders could not be exported');
    } finally {
      setExporting(false);
    }
  };

  const total = list.counts?.all ?? list.pagination.total;

  return (
    <section>
      <div className="head">
        <div>
          <h1>Orders</h1>
          <p>
            {total.toLocaleString('en-GB')} {total === 1 ? 'order' : 'orders'} {rangePhrase(rangeOf(view))}. The agent flags orders that need you.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('orders', 'bulk_import') && (
            <Button onClick={() => setImportOpen(true)}>
              <Upload />
              Import
            </Button>
          )}
          <Button onClick={exportOrders} disabled={exporting}>
            <Download />
            Export
          </Button>
          {can('orders', 'create') && (
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              <Plus />
              New order
            </Button>
          )}
        </div>
      </div>

      <div className="card otwrap">
        <Tabs
          label="Order status"
          items={tabs}
          value={view.tab}
          onChange={(id) => go({ ...view, tab: id as StatusTabId, page: 1 })}
        />
        <FilterBar view={view} onChange={go} products={options.products} agents={options.agents} reps={options.reps}>
          <span style={{ marginLeft: 'auto' }} />
          <ColumnsMenu hidden={columnPrefs.hidden} onToggle={columnPrefs.toggle} />
        </FilterBar>

        {list.loading ? (
          <div style={{ padding: 20 }} aria-busy="true" aria-label="Loading orders">
            <Skeleton height={44} />
            <Skeleton height={44} className="skelgap" />
            <Skeleton height={44} className="skelgap" />
          </div>
        ) : list.error ? (
          <EmptyState
            title={list.error}
            action={<Button onClick={() => void list.refetch()}>Try again</Button>}
          />
        ) : list.rows.length === 0 ? (
          <EmptyState title="No orders match." />
        ) : (
          <div style={{ '--ot-width': `${tableWidth}px` } as React.CSSProperties}>
            <Table label="Orders" className="ot" columns={columns} rows={list.rows} rowKey={(r) => r.id} onRowClick={(r) => open(r.id)} />
          </div>
        )}

        <Pagination
          page={list.pagination.page}
          pageSize={pageSize}
          total={list.pagination.total}
          noun="orders"
          onPageChange={(page) => go({ ...view, page })}
          pageSizes={PAGE_SIZES}
          onPageSizeChange={(size) => {
            setSavedSize(size);
            writePref('pageSize', size);
            go({ ...view, page: 1, size });
          }}
        />
      </div>

      <BulkImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} onSuccess={() => void list.refetch()} />
      <OrderForm isOpen={formOpen} onClose={() => setFormOpen(false)} order={null} onSuccess={() => void list.refetch()} />
    </section>
  );
}
