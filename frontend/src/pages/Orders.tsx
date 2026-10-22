import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Columns3, Download, Plus, Upload } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, EmptyState, Pagination, Skeleton, Table, Tabs, useToast } from '../components/ui-v2';
import { usePopover } from '../components/shell/usePopover';
import { BulkImportModal } from '../components/orders/BulkImportModal';
import { OrderForm } from '../components/forms/OrderForm';
import { usePermissions } from '../hooks/usePermissions';
import { ordersService } from '../services/orders.service';
import { buildColumns } from './orders/columns';
import { COLUMN_LABELS } from './orders/labels';
import { STATUS_TABS, tabCount, visibleTabs, type StatusTabId } from './orders/model';
import { DEFAULT_VIEW, listParams, parseView, writeView, type ListView } from './orders/urlState';
import { FIXED_COLUMNS, useColumnPrefs, type ColumnId } from './orders/useColumnPrefs';
import { useOrdersList } from './orders/useOrdersList';

const PAGE_SIZE = 25;

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
  const params = useMemo(() => listParams(view, PAGE_SIZE), [view]);
  const list = useOrdersList(params);
  const columnPrefs = useColumnPrefs();
  const columnsMenu = usePopover();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const go = useCallback((next: ListView) => setSearch(writeView(next), { replace: false }), [setSearch]);

  // A new view starts with nothing selected; a silent refresh keeps the selection.
  const viewKey = JSON.stringify(params);
  useEffect(() => setSelected(new Set()), [viewKey]);

  const open = (id: number) => (onOpen ? onOpen(id) : navigate(`/orders/${id}`));

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
      }),
    [selected, list.rows, columnPrefs.widthOf, columnPrefs.setWidth, columnPrefs.hidden],
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
            {total.toLocaleString('en-GB')} {total === 1 ? 'order' : 'orders'}. The agent flags orders that need you.
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
          onChange={(id) => go({ ...DEFAULT_VIEW, tab: id as StatusTabId })}
        />
        <div className="filters">
          <div className="mwrap" ref={columnsMenu.wrapRef}>
            <button
              ref={columnsMenu.triggerRef}
              type="button"
              className="btn"
              aria-haspopup="menu"
              aria-expanded={columnsMenu.open}
              onClick={columnsMenu.toggle}
            >
              <Columns3 />
              Columns
            </button>
            {columnsMenu.open && (
              <div className="menu left" role="menu" aria-label="Columns">
                {(Object.keys(COLUMN_LABELS) as ColumnId[])
                  .filter((id) => !FIXED_COLUMNS.includes(id))
                  .map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={!columnPrefs.hidden.includes(id)}
                      onClick={() => columnPrefs.toggle(id)}
                    >
                      {COLUMN_LABELS[id]}
                      {!columnPrefs.hidden.includes(id) && <Check className="cur" aria-hidden="true" />}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

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
          pageSize={PAGE_SIZE}
          total={list.pagination.total}
          noun="orders"
          onPageChange={(page) => go({ ...view, page })}
        />
      </div>

      <BulkImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} onSuccess={() => void list.refetch()} />
      <OrderForm isOpen={formOpen} onClose={() => setFormOpen(false)} order={null} onSuccess={() => void list.refetch()} />
    </section>
  );
}
