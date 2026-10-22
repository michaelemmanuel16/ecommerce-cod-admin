import type { CustomerFilterParams, CustomerListParams, CustomerSegment, CustomerSortField, CustomerRisk } from '../../services/customers.service';
import { positive } from '../../utils/urlState';
import { isRisk, isSegment } from './model';

export interface SortState {
  by: CustomerSortField;
  dir: 'asc' | 'desc';
}

/** Everything the list depends on. It lives in the URL, so a copied link opens the same list (F-353). */
export interface ListView {
  segment: CustomerSegment;
  page: number;
  q: string;
  /** null: the server order (newest first). */
  sort: SortState | null;
  /** Page size from the link. null: the default. */
  size: number | null;
  town: string;
  region: string;
  risk: CustomerRisk | null;
  blocked: boolean;
  flagged: boolean;
}

export const PAGE_SIZES = [25, 50, 100] as const;

export const DEFAULT_VIEW: ListView = {
  segment: 'all', page: 1, q: '', sort: null, size: null, town: '', region: '', risk: null, blocked: false, flagged: false,
};

export const SORT_FIELDS: CustomerSortField[] = ['customer', 'orders', 'deliveredValue', 'lastOrder'];

export function parseView(search: URLSearchParams): ListView {
  const segment = search.get('segment');
  const sort = search.get('sort');
  const size = positive(search.get('size'));
  const risk = search.get('risk');
  return {
    segment: isSegment(segment) ? segment : 'all',
    page: positive(search.get('page')) ?? 1,
    q: (search.get('q') ?? '').slice(0, 100),
    sort: SORT_FIELDS.includes(sort as CustomerSortField)
      ? { by: sort as CustomerSortField, dir: search.get('dir') === 'asc' ? 'asc' : 'desc' }
      : null,
    size: size !== null && (PAGE_SIZES as readonly number[]).includes(size) ? size : null,
    town: (search.get('town') ?? '').slice(0, 100),
    region: (search.get('region') ?? '').slice(0, 100),
    risk: isRisk(risk) ? risk : null,
    blocked: search.get('blocked') === '1',
    flagged: search.get('flagged') === '1',
  };
}

/** Values equal to the default are left out, so the plain page keeps a plain URL. */
export function writeView(view: ListView): URLSearchParams {
  const out = new URLSearchParams();
  if (view.segment !== 'all') out.set('segment', view.segment);
  if (view.q) out.set('q', view.q);
  if (view.town) out.set('town', view.town);
  if (view.region) out.set('region', view.region);
  if (view.risk) out.set('risk', view.risk);
  if (view.blocked) out.set('blocked', '1');
  if (view.flagged) out.set('flagged', '1');
  if (view.sort) {
    out.set('sort', view.sort.by);
    out.set('dir', view.sort.dir);
  }
  if (view.page !== 1) out.set('page', String(view.page));
  if (view.size !== null) out.set('size', String(view.size));
  return out;
}

/** The filters the list, the tiles and the export share. A search of one character waits for more input (F-352). */
export function filterParams(view: ListView): CustomerFilterParams {
  return {
    ...(view.q.length >= 2 && { search: view.q }),
    ...(view.town && { area: view.town }),
    ...(view.region && { region: view.region }),
    ...(view.risk && { risk: view.risk }),
    ...(view.blocked && { blocked: true }),
    ...(view.flagged && { flagged: true }),
  };
}

export function listParams(view: ListView, limit: number): CustomerListParams {
  return {
    ...filterParams(view),
    ...(view.segment !== 'all' && { segment: view.segment }),
    page: view.page,
    limit,
    ...(view.sort && { sortBy: view.sort.by, sortOrder: view.sort.dir }),
  };
}
