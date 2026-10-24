import type { StockLocationType } from '../../services/inventory.service';

export type StockAction = 'allocate' | 'transfer' | 'return' | 'adjust' | 'count';
export const STOCK_ACTIONS: StockAction[] = ['allocate', 'transfer', 'return', 'adjust', 'count'];
export const isStockAction = (v: string | null): v is StockAction => STOCK_ACTIONS.includes(v as StockAction);

const TYPES: StockLocationType[] = ['own_store', 'partner_3pl', 'agent'];

/** What the Inventory view depends on. It lives in the URL, so a copied link opens the same table. */
export interface InventoryView {
  /** Table pre-filter (the Products page links here with ?product=). */
  product: number | null;
  /** Table filter by location type. */
  type: StockLocationType | null;
  /** Only rows where our records and the latest count differ. */
  diff: boolean;
  /** Opens a stock modal (or the count sheet) on arrival, then is removed from the URL. */
  action: StockAction | null;
  /** Table pre-filter by stock location (the Deliveries page links here with ?location=); also the holder a modal opened by ?action= preselects. */
  location: number | null;
}

export const DEFAULT_VIEW: InventoryView = { product: null, type: null, diff: false, action: null, location: null };

const positive = (v: string | null): number | null => {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n > 0 ? n : null;
};

export function parseView(search: URLSearchParams): InventoryView {
  const type = search.get('type');
  const action = search.get('action');
  return {
    product: positive(search.get('product')),
    type: TYPES.includes(type as StockLocationType) ? (type as StockLocationType) : null,
    diff: search.get('diff') === '1',
    action: isStockAction(action) ? action : null,
    location: positive(search.get('location')),
  };
}

/** Values equal to the default are left out, so the plain page keeps a plain URL. */
export function writeView(view: InventoryView): URLSearchParams {
  const out = new URLSearchParams();
  if (view.product !== null) out.set('product', String(view.product));
  if (view.type) out.set('type', view.type);
  if (view.diff) out.set('diff', '1');
  if (view.action) out.set('action', view.action);
  if (view.location !== null) out.set('location', String(view.location));
  return out;
}
