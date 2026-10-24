import type { ProductTab } from '../../services/products.service';
import { isProductTab } from './model';

export type Pane = 'products' | 'shipments';
export type ShipFilter = 'all' | 'pending' | 'received';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What the Products page depends on. It lives in the URL, so a copied link opens the same view. */
export interface ProductsView {
  pane: Pane;
  tab: ProductTab;
  /** YYYY-MM, or null for the current month. */
  month: string | null;
  /** Shipments tab filter. */
  ships: ShipFilter;
  /** The open product drawer: a product id, or 'new'. */
  edit: number | 'new' | null;
}

export const DEFAULT_VIEW: ProductsView = { pane: 'products', tab: 'active', month: null, ships: 'all', edit: null };

export function parseView(search: URLSearchParams): ProductsView {
  const tab = search.get('tab');
  const month = search.get('month');
  const ships = search.get('ships');
  const edit = search.get('edit');
  const id = Number(edit);
  return {
    pane: search.get('pane') === 'shipments' ? 'shipments' : 'products',
    tab: isProductTab(tab) ? tab : DEFAULT_VIEW.tab,
    month: month && MONTH.test(month) ? month : null,
    ships: ships === 'pending' || ships === 'received' ? ships : 'all',
    edit: edit === 'new' ? 'new' : Number.isInteger(id) && id > 0 ? id : null,
  };
}

/** Values equal to the default are left out, so the plain page keeps a plain URL. */
export function writeView(view: ProductsView): URLSearchParams {
  const out = new URLSearchParams();
  if (view.pane !== DEFAULT_VIEW.pane) out.set('pane', view.pane);
  if (view.tab !== DEFAULT_VIEW.tab) out.set('tab', view.tab);
  if (view.month) out.set('month', view.month);
  if (view.ships !== DEFAULT_VIEW.ships) out.set('ships', view.ships);
  if (view.edit !== null) out.set('edit', String(view.edit));
  return out;
}
