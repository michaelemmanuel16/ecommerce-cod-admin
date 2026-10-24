import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, History } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';
import { usePopover } from '../components/shell/usePopover';
import { Button, ConfirmDialog, EmptyState, Select, Skeleton, useToast } from '../components/ui-v2';
import { inventoryService, type StockRow, type Transfer } from '../services/inventory.service';
import { apiErrorMessage } from '../utils/apiError';
import { LocationCards } from './inventory/LocationCards';
import { StockTable } from './inventory/StockTable';
import { RecentTransfers } from './inventory/RecentTransfers';
import { LowStockCard } from './inventory/LowStockCard';
import { OwnStoreModal } from './inventory/OwnStoreModal';
import { StockModal } from './inventory/MoveModals';
import { CountSheet } from './inventory/CountSheet';
import { HistoryModal } from './inventory/HistoryModal';
import { ReceiveDialog, ResolveDialog } from './inventory/TransferDialogs';
import { ACTION_META, TYPE_LABEL, type ModalKind } from './inventory/model';
import { parseView, writeView, type InventoryView } from './inventory/urlState';
import { useInventory } from './inventory/useInventory';

/** The holder and product a stock modal or the count sheet starts with. */
interface Preset {
  locationId?: number | null;
  productId?: number | null;
}

/** The Move-stock menu, in the order of the mockup; Adjust sits below the line. */
const MENU: ModalKind[] = ['allocate', 'transfer', 'return', 'adjust'];

/**
 * The Inventory page (M4-T25 to T29, F-652 to F-655, F-659), built from docs/mockups/v2/inventory.html.
 * Location cards, stock by location, recent transfers, and the stock modals, count sheet and history on top.
 * The filters and the pre-filter (?product=) are in the URL. `?action=` opens a modal or the count sheet once.
 */
export function Inventory() {
  useV2Page();
  const [search, setSearch] = useSearchParams();
  const view = useMemo(() => parseView(search), [search]);
  const data = useInventory();
  const { can, isAdmin, user } = usePermissions();
  const say = useToast();
  const menu = usePopover();
  const canMove = can('products', 'update_stock');
  const canExport = isAdmin || user?.role === 'accountant';

  /** The stock modal that is open. Mounted only while it is, so its fields start fresh each time. */
  const [modal, setModal] = useState<(Preset & { kind: ModalKind }) | null>(null);
  /** The count sheet keeps its place in the tree after it closes, so the Drawer can slide out; `id` is a new sheet for each opening. */
  const [sheet, setSheet] = useState<{ id: number; open: boolean; locationId?: number | null } | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [history, setHistory] = useState<{ id: number | null } | null>(null);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const [resolving, setResolving] = useState<Transfer | null>(null);
  const [cancelling, setCancelling] = useState<Transfer | null>(null);

  const go = useCallback((next: InventoryView, replace = false) => setSearch(writeView(next), { replace }), [setSearch]);

  const done = useCallback((message: string) => {
    setModal(null);
    setReceiving(null);
    setResolving(null);
    say(message);
    void data.refetch();
  }, [say, data.refetch]);

  const open = useCallback((action: ModalKind | 'count', preset: Preset = {}) => {
    menu.close();
    if (action === 'count') setSheet((s) => ({ id: (s?.id ?? 0) + 1, open: true, locationId: preset.locationId }));
    else setModal({ kind: action, ...preset });
  }, [menu]);

  // ?action= opens a modal or the sheet once, then leaves the URL. A person who may not move stock gets nothing.
  useEffect(() => {
    if (!view.action || data.loading) return;
    if (canMove) open(view.action, { locationId: view.location, productId: view.product });
    go({ ...view, action: null }, true);
  }, [view, data.loading, canMove, go, open]);

  const fromRow = useCallback((action: ModalKind, row: StockRow) => open(action, { locationId: row.locationId, productId: row.productId }), [open]);

  const overview = data.overview;
  const rows = useMemo(() => {
    if (!overview) return [];
    return overview.stockByLocation.filter((r) =>
      (view.product === null || r.productId === view.product)
      && (view.location === null || r.locationId === view.location)
      && (view.type === null || r.locationType === view.type)
      && (!view.diff || r.count?.status === 'off'));
  }, [overview, view.product, view.location, view.type, view.diff]);
  const productChoices = useMemo(() => {
    const seen = new Map<number, string>();
    overview?.stockByLocation.forEach((r) => seen.set(r.productId, r.productName));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [overview]);

  const cancelTransfer = async () => {
    const t = cancelling;
    if (!t) return;
    setCancelling(null);
    try {
      await inventoryService.cancel(t.id);
      say(`Cancelled. ${t.quantity} ${t.product.name} went back to ${t.fromLocation?.name ?? 'the source'}.`);
      void data.refetch();
    } catch (e) {
      say(apiErrorMessage(e, 'The transfer could not be cancelled.'));
    }
  };

    return (
    <section className="inventory">
      <div className="head">
        <div>
          <h1>Inventory &amp; stock</h1>
          <p>Where every unit sits, and where our records and the latest count disagree.</p>
        </div>
        <div className="hd-actions">
          <Button onClick={() => setHistory({ id: null })}><History />Transfer history</Button>
          {canMove && (
            <>
              <div className="mwrap" ref={menu.wrapRef}>
                <button ref={menu.triggerRef} type="button" className="btn" aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
                  <ACTION_META.transfer.Icon />Move stock<ChevronDown style={{ width: 15, height: 15 }} />
                </button>
                {menu.open && (
                  <div className="menu" role="menu" aria-label="Move stock">
                    {MENU.map((action) => {
                      const { label, Icon } = ACTION_META[action];
                      return (
                        <Fragment key={action}>
                          {action === 'adjust' && <hr />}
                          <button type="button" role="menuitem" onClick={() => open(action)}><Icon />{label}</button>
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
              <Button variant="primary" onClick={() => open('count')}><ACTION_META.count.Icon />{ACTION_META.count.label}</Button>
            </>
          )}
        </div>
      </div>

      {data.loading && !overview ? (
        <div aria-busy="true" aria-label="Loading stock">
          <Skeleton height={190} className="skelcard" />
          <Skeleton height={260} className="skelcard skelgap" />
        </div>
      ) : data.error && !overview ? (
        <EmptyState title={data.error} action={<Button onClick={() => void data.refetch()}>Try again</Button>} />
      ) : overview ? (
        <>
          <LocationCards
            cards={overview.locations}
            canMove={canMove}
            offerOwnStore={!overview.hasOwnStore}
            onAction={(action, locationId) => open(action, { locationId })}
            onSetUpStore={() => setSettingUp(true)}
          />

          <LowStockCard
            products={data.low}
            canMove={canMove}
            onAllocate={(productId) => open('allocate', { productId })}
            onShow={(productId) => go({ ...view, product: productId })}
          />

          <div className="card stwrap">
            <div className="ct"><h3>Stock by location</h3><span>Reserved means stock held for open orders</span></div>
            <div className="filters">
              <Select compact label="Filter by product" value={view.product ?? ''} onChange={(e) => go({ ...view, product: e.target.value ? Number(e.target.value) : null })}>
                <option value="">All products</option>
                {productChoices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
              <Select compact label="Filter by location" value={view.location ?? ''} onChange={(e) => go({ ...view, location: e.target.value ? Number(e.target.value) : null })}>
                <option value="">All holders</option>
                {overview.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
              <Select compact label="Filter by location type" value={view.type ?? ''} onChange={(e) => go({ ...view, type: (e.target.value || null) as InventoryView['type'] })}>
                <option value="">All locations</option>
                {(Object.keys(TYPE_LABEL) as Array<keyof typeof TYPE_LABEL>).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </Select>
              <button type="button" className={view.diff ? 'btn on' : 'btn'} aria-pressed={view.diff} onClick={() => go({ ...view, diff: !view.diff })}>Only differences</button>
            </div>
            <StockTable rows={rows} canMove={canMove} onAction={fromRow} />
          </div>

          <RecentTransfers
            transfers={data.recent ?? []}
            canMove={canMove}
            onReceive={setReceiving}
            onResolve={setResolving}
            onOpenHistory={(id) => setHistory({ id: id ?? null })}
          />

          {modal && (
            <StockModal
              kind={modal.kind}
              overview={overview}
              products={data.products}
              initial={modal}
              onClose={() => setModal(null)}
              onDone={done}
            />
          )}
          {sheet && (
            <CountSheet
              key={sheet.id}
              open={sheet.open}
              overview={overview}
              products={data.products}
              initialLocationId={sheet.locationId}
              onClose={() => setSheet((s) => s && { ...s, open: false })}
              onChanged={() => void data.refetch()}
            />
          )}
          {history && (
            <HistoryModal
              key={history.id ?? 'all'}
              overview={overview}
              products={data.products}
              initialId={history.id}
              canMove={canMove}
              canExport={canExport}
              refreshKey={data.revision}
              onClose={() => setHistory(null)}
              onReceive={setReceiving}
              onResolve={setResolving}
              onCancel={setCancelling}
            />
          )}
        </>
      ) : null}

      {settingUp && <OwnStoreModal onClose={() => setSettingUp(false)} onCreated={() => { setSettingUp(false); void data.refetch(); }} />}
      {receiving && <ReceiveDialog key={receiving.id} transfer={receiving} onClose={() => setReceiving(null)} onDone={done} />}
      {resolving && <ResolveDialog key={resolving.id} transfer={resolving} onClose={() => setResolving(null)} onDone={done} />}
      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        onConfirm={() => void cancelTransfer()}
        action="Cancel transfer"
        count={1}
        noun="transfer"
        title="Cancel this transfer?"
      >
        {cancelling ? `The ${cancelling.quantity} ${cancelling.product.name} go back to ${cancelling.fromLocation?.name ?? 'the source'}.` : ''}
      </ConfirmDialog>
    </section>
  );
}
