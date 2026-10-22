import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus, Upload } from 'lucide-react';
import type { OrderListRow } from '../services/orders.service';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, EmptyState, Pagination, Skeleton, Table, Tabs, useToast } from '../components/ui-v2';
import { BulkImportModal } from '../components/orders/BulkImportModal';
import { usePermissions } from '../hooks/usePermissions';
import { ordersService } from '../services/orders.service';
import { buildColumns, type SortField } from './orders/columns';
import { ColumnsMenu } from './orders/ColumnsMenu';
import { FilterBar } from './orders/FilterBar';
import { FloatingMenu } from './orders/FloatingMenu';
import { BulkBar } from './orders/BulkBar';
import { RowAssignItems } from './orders/AssignItems';
import { NewOrderSheet } from './orders/NewOrderSheet';
import { RowStatus } from './orders/RowStatus';
import { useOrderActions, type FocusSet } from './orders/useOrderActions';
import { CLOSED, DELETABLE, orderNumber, STATUS_TABS, tabCount, visibleTabs, type StatusTabId } from './orders/model';
import { readPref, writePref } from './orders/prefs';
import { DEFAULT_SIZE, PAGE_SIZES, listParams, parseView, rangeOf, rangePhrase, sizeOf, writeView, type ListView } from './orders/urlState';
import { useColumnPrefs } from './orders/useColumnPrefs';
import { useFilterOptions } from './orders/useFilterOptions';
import { useOrderList } from './orders/useOrderList';

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
  const list = useOrderList(params);
  const columnPrefs = useColumnPrefs();
  const options = useFilterOptions();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  // `/orders?new=1&customerId=<id>` opens the New order sheet for that customer (the customer page links here)
  const linkedCustomer = Number(search.get('customerId')) || null;
  const sheetOpen = formOpen || search.get('new') === '1';
  const [exporting, setExporting] = useState(false);
  const [assignFor, setAssignFor] = useState<{ row: OrderListRow; anchor: HTMLElement } | null>(null);
  const [focus, setFocus] = useState<FocusSet | null>(null);

  const go = useCallback((next: ListView, replace = false) => setSearch(writeView(next), { replace }), [setSearch]);

  // A new view starts with nothing selected; a silent refresh keeps the selection.
  const viewKey = JSON.stringify(params);
  useEffect(() => {
    setSelected(new Set());
    setFocus(null);
  }, [viewKey]);
  // Orders that left the page (moved to another tab, deleted by someone else) leave the selection.
  useEffect(() => {
    const here = new Set(list.rows.map((r) => r.id));
    setSelected((s) => (s.size && [...s].some((id) => !here.has(id)) ? new Set([...s].filter((id) => here.has(id))) : s));
  }, [list.rows]);

  const canMove = can('orders', 'update');
  const canAssign = can('orders', 'assign');
  const canDelete = can('orders', 'delete');
  const selectedRows = useMemo(() => list.rows.filter((r) => selected.has(r.id)), [list.rows, selected]);
  const actions = useOrderActions({ setSelected, refetch: list.refetch, setFocus });
  const shownRows = focus ? list.rows.filter((r) => focus.ids.includes(r.id)) : list.rows;

  const closeSheet = () => {
    setFormOpen(false);
    if (search.has('new') || search.has('customerId')) {
      setSearch((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        next.delete('customerId');
        return next;
      }, { replace: true });
    }
  };

  const open = (id: number) => (onOpen ? onOpen(id) : navigate(`/orders/${id}`));

  // First click on a column sorts newest / biggest first (names, a to z); a second click turns it round.
  const onSort = (by: SortField) =>
    go({ ...view, page: 1, sort: { by, dir: view.sort.by === by ? (view.sort.dir === 'asc' ? 'desc' : 'asc') : by === 'customer' ? 'asc' : 'desc' } });

  const columns = useMemo(
    () =>
      buildColumns({
        selected,
        rows: shownRows,
        onToggleRow: (id, on) =>
          setSelected((s) => {
            const next = new Set(s);
            if (on) next.add(id);
            else next.delete(id);
            return next;
          }),
        onToggleAll: (on) => setSelected(on ? new Set(shownRows.map((r) => r.id)) : new Set()),
        widthOf: columnPrefs.widthOf,
        setWidth: columnPrefs.setWidth,
        hidden: columnPrefs.hidden,
        sort: view.sort,
        onSort,
        onAssign: canAssign ? (row, anchor) => setAssignFor((cur) => (cur?.row.id === row.id ? null : { row, anchor })) : undefined,
        renderStatus: canMove ? (row) => <RowStatus row={row} onPick={(target, forced) => actions.moveStatus([row], target, { forced })} /> : undefined,
      }),
    [selected, shownRows, columnPrefs.widthOf, columnPrefs.setWidth, columnPrefs.hidden, view, canAssign, canMove],
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

        {selectedRows.length > 0 && (
          <BulkBar
            rows={selectedRows}
            reps={options.reps}
            agents={options.agents}
            canMove={canMove}
            canAssign={canAssign}
            canDelete={canDelete}
            onStatus={(target) => actions.moveStatus(selectedRows, target, { bulk: true })}
            onRep={(o) => actions.assign(selectedRows, { kind: 'rep', option: o }, { bulk: true })}
            onAgent={(o) => actions.assign(selectedRows, { kind: 'agent', option: o }, { bulk: true })}
            onDelete={() => actions.askDelete(selectedRows)}
            onClear={() => setSelected(new Set())}
          />
        )}
        {focus && (
          <div className="shownote" role="status">
            {focus.text}
            <Button size="mini" onClick={() => setFocus(null)}>Show all</Button>
            <ul>
              {focus.reasons.slice(0, 5).map((r) => (
                <li key={r.id}>{orderNumber(r.id)}: {r.message}</li>
              ))}
            </ul>
          </div>
        )}

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
        ) : shownRows.length === 0 ? (
          <EmptyState title="No orders match." />
        ) : (
          <div style={{ '--ot-width': `${tableWidth}px` } as React.CSSProperties}>
            <Table label="Orders" className="ot" columns={columns} rows={shownRows} rowKey={(r) => r.id} onRowClick={(r) => open(r.id)} />
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

      {assignFor && (
        <FloatingMenu anchor={assignFor.anchor} label={`Assign ${orderNumber(assignFor.row.id)}`} onClose={() => setAssignFor(null)}>
          <RowAssignItems
            reps={options.reps}
            agents={options.agents}
            currentRepId={assignFor.row.customerRep?.id}
            currentAgentId={assignFor.row.deliveryAgent?.id}
            agentLocked={CLOSED.includes(assignFor.row.status)}
            onRep={(o) => { const row = assignFor.row; setAssignFor(null); actions.assign([row], { kind: 'rep', option: o }); }}
            onAgent={(o) => { const row = assignFor.row; setAssignFor(null); actions.assign([row], { kind: 'agent', option: o }); }}
            onUnassign={() => { const row = assignFor.row; setAssignFor(null); actions.assign([row], { kind: 'both' }); }}
            onDelete={canDelete && DELETABLE.includes(assignFor.row.status) ? () => { const row = assignFor.row; setAssignFor(null); actions.askDelete([row]); } : undefined}
          />
        </FloatingMenu>
      )}
      {actions.dialogs}
      <BulkImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} onSuccess={() => void list.refetch()} />
      <NewOrderSheet
        open={sheetOpen}
        onClose={closeSheet}
        onCreated={() => void list.refetch()}
        customerId={linkedCustomer}
        canAssign={canAssign}
        reps={options.reps}
        agents={options.agents}
      />
    </section>
  );
}
