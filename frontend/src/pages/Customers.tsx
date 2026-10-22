import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Repeat, UserPlus, UserX, Users } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, EmptyState, Pagination, Skeleton, Table, Tabs, Tag, Tile, useToast } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { customersService } from '../services/customers.service';
import { buildColumns } from './customers/columns';
import { CustomerModal } from './customers/CustomerModal';
import { FilterBar } from './customers/FilterBar';
import { RISK_RULE, SEGMENT_TABS } from './customers/model';
import { DEFAULT_SIZE, PAGE_SIZES, filterParams, listParams, parseView, writeView, type ListView } from './customers/urlState';
import { useCustomerList } from './customers/useCustomerList';

const count = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString('en-GB'));

/**
 * The Customers list (M3-T49, F-350 to F-353, F-361), built from docs/mockups/v2/customers.html.
 * The view (tab, search, filters, sort, page) is in the URL, so a copied link opens the same list.
 */
export function Customers() {
  useV2Page();
  const navigate = useNavigate();
  const say = useToast();
  const { can } = usePermissions();
  const [search, setSearch] = useSearchParams();
  const view = useMemo(() => parseView(search), [search]);
  const pageSize = view.size ?? DEFAULT_SIZE;
  const params = useMemo(() => listParams(view, pageSize), [view, pageSize]);
  const filters = useMemo(() => filterParams(view), [view]);
  const list = useCustomerList(params, filters);
  const [towns, setTowns] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadTowns = useCallback((fresh = false) => {
    customersService.getTowns(fresh).then(setTowns).catch(() => undefined);
  }, []);
  useEffect(() => loadTowns(), [loadTowns]);

  const go = useCallback((next: ListView, replace = false) => setSearch(writeView(next), { replace }), [setSearch]);

  // First click on a column sorts biggest or newest first (names, a to z); a second click turns it round.
  const columns = useMemo(
    () =>
      buildColumns({
        sort: view.sort,
        onSort: (by) =>
          go({ ...view, page: 1, sort: { by, dir: view.sort?.by === by ? (view.sort.dir === 'asc' ? 'desc' : 'asc') : by === 'customer' ? 'asc' : 'desc' } }),
      }),
    [view, go],
  );

  const exportCustomers = async () => {
    setExporting(true);
    try {
      await customersService.exportCustomers(filters);
      say('Customers exported');
    } catch {
      say('The customers could not be exported');
    } finally {
      setExporting(false);
    }
  };

  const tiles = list.summary?.tiles;
  const segments = list.summary?.segments;
  const month = new Date().toLocaleString('en-GB', { month: 'short' });

  return (
    <section>
      <div className="head">
        <div>
          <h1>Customers</h1>
          <p>Who buys, who comes back, and who refuses delivery.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('customers', 'export') && (
            <Button onClick={exportCustomers} disabled={exporting}>
              <Download />
              Export CSV
            </Button>
          )}
          {can('customers', 'create') && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <UserPlus />
              Add customer
            </Button>
          )}
        </div>
      </div>

      <div className="grid kpis" style={{ marginTop: 0 }}>
        <Tile
          icon={<Users />}
          tone="pine"
          value={count(tiles?.total)}
          label="Total customers"
          footer={<><span>All customers</span><Tag tone="ok">+{count(tiles?.newThisMonth)} in {month}</Tag></>}
        />
        <Tile
          icon={<UserPlus />}
          tone="violet"
          value={count(tiles?.firstTime)}
          label="First-time"
          footer={<><span>{tiles?.firstTimePct ?? 0}% of buyers</span><Tag>1 order</Tag></>}
        />
        <Tile
          icon={<Repeat />}
          tone="mint"
          value={count(tiles?.repeat)}
          label="Repeat customers"
          footer={<><span>2 or more orders</span><Tag tone="ok">{tiles?.repeatPct ?? 0}%</Tag></>}
        />
        <Tile
          icon={<UserX />}
          tone="coral"
          value={count(tiles?.blocked)}
          label="Blocked for refusing delivery"
          footer={<><span>Refused 3 times</span><Tag tone="bad">COD off</Tag></>}
        />
      </div>

      <div className="card ctwrap" style={{ marginTop: 16 }}>
        <Tabs
          label="Customer segment"
          items={SEGMENT_TABS.map((t) => ({ id: t.id, label: t.label, count: segments ? count(segments[t.id]) : undefined }))}
          value={view.segment}
          onChange={(id) => go({ ...view, segment: id as ListView['segment'], page: 1 })}
        />
        <FilterBar view={view} onChange={go} towns={towns} />

        {list.loading ? (
          <div style={{ padding: 20 }} aria-busy="true" aria-label="Loading customers">
            <Skeleton height={44} />
            <Skeleton height={44} className="skelgap" />
            <Skeleton height={44} className="skelgap" />
          </div>
        ) : list.error ? (
          <EmptyState title={list.error} action={<Button onClick={() => void list.refetch()}>Try again</Button>} />
        ) : list.rows.length === 0 ? (
          <EmptyState title="No customers match." />
        ) : (
          <Table label="Customers" className="ct2" columns={columns} rows={list.rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/customers/${r.id}`)} />
        )}

        <Pagination
          page={list.pagination.page}
          pageSize={pageSize}
          total={list.pagination.total}
          noun="customers"
          onPageChange={(page) => go({ ...view, page })}
          pageSizes={PAGE_SIZES}
          onPageSizeChange={(size) => go({ ...view, page: 1, size })}
        />
        <div className="cfoot">
          <span>{RISK_RULE}</span>
        </div>
      </div>

      <CustomerModal
        open={adding}
        onClose={() => setAdding(false)}
        customer={null}
        onSaved={(name) => {
          setAdding(false);
          say(`${name} added`);
          void list.refetch();
          loadTowns(true);
        }}
      />
    </section>
  );
}
