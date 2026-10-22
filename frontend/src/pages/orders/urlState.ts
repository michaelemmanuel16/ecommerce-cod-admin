import type { OrderListParams } from '../../services/orders.service';
import { isTabId, tabStatuses, type StatusTabId } from './model';

/** Everything the list view depends on. It lives in the URL, so a copied link opens the same view (F-308, F-310). */
export interface ListView {
  tab: StatusTabId;
  page: number;
}

export const DEFAULT_VIEW: ListView = { tab: 'all', page: 1 };

export function parseView(search: URLSearchParams): ListView {
  const tab = search.get('status');
  const page = Number(search.get('page'));
  return {
    tab: isTabId(tab) ? tab : DEFAULT_VIEW.tab,
    page: Number.isInteger(page) && page > 0 ? page : DEFAULT_VIEW.page,
  };
}

/** Values equal to the default are left out, so the plain page keeps a plain URL. */
export function writeView(view: ListView): URLSearchParams {
  const out = new URLSearchParams();
  if (view.tab !== DEFAULT_VIEW.tab) out.set('status', view.tab);
  if (view.page !== DEFAULT_VIEW.page) out.set('page', String(view.page));
  return out;
}

export function listParams(view: ListView, limit: number): OrderListParams {
  const status = tabStatuses(view.tab);
  return {
    ...(status.length && { status }),
    page: view.page,
    limit,
  };
}
