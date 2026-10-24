import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, PackageX, Plus, Percent, Trophy, Truck } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, EmptyState, Skeleton, Tabs, Tag, Tile } from '../components/ui-v2';
import { ProductDrawer } from './products/ProductDrawer';
import { ProductsTable } from './products/ProductsTable';
import { ShipmentsPane } from './products/ShipmentsPane';
import { monthNow, monthShort, PRODUCT_TABS } from './products/model';
import { parseView, writeView, type ProductsView } from './products/urlState';
import { useProducts } from './products/useProducts';

/**
 * The Products page (M4-T21, F-600 to F-603) with the Incoming shipments tab (M4-T23). Built from docs/mockups/v2/products.html.
 * The pane, the tab, the month and the open drawer are in the URL, so a copied link opens the same view. Cost and margin show
 * only when the API sends them for the signed-in role.
 */
export function Products() {
  useV2Page();
  const [search, setSearch] = useSearchParams();
  const view = useMemo(() => parseView(search), [search]);
  const { can } = usePermissions();
  // The shipments tab offers the active products, whatever tab the products table was left on
  const data = useProducts(view.pane === 'shipments' ? 'active' : view.tab, view.month);
  const [addingShipment, setAddingShipment] = useState(false);

  const go = useCallback((next: ProductsView, replace = false) => setSearch(writeView(next), { replace }), [setSearch]);
  const { list, summary } = data;
  const month = view.month ?? list?.month ?? monthNow();
  const canCreate = can('products', 'create');
  const canEdit = can('products', 'update');
  const canStock = can('products', 'update_stock');
  const showCost = !!list?.canSeeCost;
  const shippable = (list?.products ?? []).filter((p) => p.isActive && p.productType === 'physical').map((p) => ({ id: p.id, name: p.name }));
  const shipments = view.pane === 'shipments';

  return (
    <section className="products">
      <div className="head">
        <div>
          <h1>Products</h1>
          <p>
            {summary ? `${summary.activeProducts.active} active products.` : 'Your catalogue, its stock and what is on the way.'}
            {summary?.bestSeller && ` ${summary.bestSeller.name} sold the most in ${monthShort(summary.month)}.`}
          </p>
        </div>
        <div className="hd-actions">
          {!shipments && (
            <label className="mut" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              Month
              <input
                type="month"
                className="psel"
                aria-label="Month"
                value={month}
                max={monthNow()}
                onChange={(e) => go({ ...view, month: e.target.value && e.target.value !== monthNow() ? e.target.value : null })}
              />
            </label>
          )}
          {canStock && (
            <Button onClick={() => { go({ ...view, pane: 'shipments' }); setAddingShipment(true); }}>
              <Truck />
              Add shipment
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" onClick={() => go({ ...view, edit: 'new' })}>
              <Plus />
              Add product
            </Button>
          )}
        </div>
      </div>

      <Tabs
        label="Products sections"
        className="panetabs"
        items={[
          { id: 'products', label: 'Products', count: list?.counts.all },
          { id: 'shipments', label: 'Incoming shipments' },
        ]}
        value={view.pane}
        onChange={(id) => go({ ...view, pane: id as ProductsView['pane'] })}
      />

      {shipments ? (
        <ShipmentsPane
          filter={view.ships}
          onFilter={(ships) => go({ ...view, ships })}
          canWrite={canStock}
          products={shippable}
          adding={addingShipment}
          onAddingChange={setAddingShipment}
          onStockChanged={() => void data.refetch()}
        />
      ) : (
        <>
          {summary && (
            <div className="grid kpis" style={{ marginTop: 0 }}>
              <Tile
                icon={<Package />}
                tone="pine"
                value={summary.activeProducts.active}
                label="Active products"
                footer={<><span>{summary.activeProducts.archived} archived</span><Tag tone="ok">Live</Tag></>}
              />
              <Tile
                icon={<Trophy />}
                tone="gold"
                value={summary.bestSeller?.name ?? '—'}
                label="Best seller this month"
                footer={<><span>{summary.bestSeller ? `${summary.bestSeller.units} delivered` : 'Nothing delivered yet'}</span>{summary.bestSeller && <Tag>Main product</Tag>}</>}
              />
              <Tile
                icon={<Percent />}
                tone="mint"
                value={summary.averageMargin == null ? '—' : `${summary.averageMargin}%`}
                label="Average margin"
                footer={<><span>After product cost</span><Tag>Before delivery</Tag></>}
              />
              <Tile
                icon={<PackageX />}
                tone="coral"
                value={summary.lowStock}
                label="Low stock"
                footer={<><span>Under the days of cover limit</span>{summary.lowStock > 0 && <Tag tone="bad">Reorder</Tag>}</>}
              />
            </div>
          )}

          <div className="card" style={{ marginTop: 16 }}>
            <Tabs
              label="Product status"
              className="ptabs"
              items={PRODUCT_TABS.map((t) => ({ id: t.id, label: t.label, count: list?.counts[t.id] }))}
              value={view.tab}
              onChange={(id) => go({ ...view, tab: id as ProductsView['tab'] })}
            />
            {data.loading && !list ? (
              <div style={{ padding: 20 }} aria-busy="true" aria-label="Loading products">
                <Skeleton height={44} />
                <Skeleton height={44} className="skelgap" />
                <Skeleton height={44} className="skelgap" />
              </div>
            ) : data.error && !list ? (
              <EmptyState title={data.error} action={<Button onClick={() => void data.refetch()}>Try again</Button>} />
            ) : list && list.products.length === 0 ? (
              <EmptyState
                title={view.tab === 'archived' ? 'No archived products.' : 'No products yet.'}
                action={canCreate && view.tab !== 'archived' ? <Button variant="primary" onClick={() => go({ ...view, edit: 'new' })}>Add product</Button> : undefined}
              />
            ) : list ? (
              <ProductsTable rows={list.products} showCost={showCost} target={summary?.deliverySuccessTarget ?? null} monthLabel={monthShort(list.month)} canEdit={canEdit} onEdit={(id) => go({ ...view, edit: id })} />
            ) : null}
            <div className="pfoot">
              <span>Stock adds up across every holder.{summary ? ` Delivery success target is ${summary.deliverySuccessTarget}%.` : ''}</span>
              {showCost && <span>Margin is price minus product cost</span>}
            </div>
          </div>
        </>
      )}

      <ProductDrawer
        target={view.edit}
        canStock={canStock}
        canSeeCost={showCost}
        onClose={() => go({ ...view, edit: null })}
        onChanged={() => void data.refetch()}
      />
    </section>
  );
}
