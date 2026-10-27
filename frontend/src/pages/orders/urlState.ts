import type { OrderListParams } from '../../services/orders.service';
import type { FailureReason } from '../../types';
import { positive } from '../../utils/urlState';
import { FAILURE_REASONS } from './reasons';
import { isTabId, isViewTab, tabStatuses, type StatusTabId } from './model';
import type { SortField, SortState } from './columns';

export type DateBasis = 'created' | 'delivery';
export type RangePreset = 'today' | 'yesterday' | 'last7' | 'month' | 'lastMonth' | 'custom';

/** Everything the list view depends on. It lives in the URL, so a copied link opens the same view (F-308, F-310 to F-312). */
export interface ListView {
  tab: StatusTabId;
  page: number;
  q: string;
  sort: SortState;
  /** Page size from the link. null: the person's saved size. */
  size: number | null;
  /** YYYY-MM-DD, both or neither. Neither means "This month" (F-311). */
  from: string | null;
  to: string | null;
  basis: DateBasis;
  product: number | null;
  agent: number | null;
  /** A call rep id, or 'none' for orders with no call rep. */
  rep: number | 'none' | null;
  flagged: boolean;
  /** Only failed or returned orders with this reason (the Deliveries reasons card links here). */
  failure: FailureReason | null;
  /** Only these orders: the ones an import made (F-319). While set, the date range is not applied. */
  ids: number[] | null;
}

export const PAGE_SIZES = [25, 50, 75, 100] as const;
const DEFAULT_SORT: SortState = { by: 'createdAt', dir: 'desc' };

export const DEFAULT_VIEW: ListView = {
  tab: 'all', page: 1, q: '', sort: DEFAULT_SORT, size: null, from: null, to: null, basis: 'created',
  product: null, agent: null, rep: null, flagged: false, failure: null, ids: null,
};

/** The import can make 2,000 orders; the API takes no more. */
export const MAX_IDS = 2000;

const SORT_FIELDS: SortField[] = ['id', 'customer', 'totalAmount', 'createdAt'];
const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A from/to pair from the URL: both valid YYYY-MM-DD dates, or neither. */
export const parseRange = (from: string | null, to: string | null): { from: string; to: string } | null =>
  from !== null && to !== null && DATE.test(from) && DATE.test(to) ? { from, to } : null;

const readIds = (v: string | null): number[] | null => {
  if (!v || !/^\d+(,\d+)*$/.test(v)) return null;
  const ids = v.split(',').map(Number);
  return ids.length <= MAX_IDS ? ids : null;
};

export function parseView(search: URLSearchParams): ListView {
  const tab = search.get('status');
  const page = positive(search.get('page'));
  const sort = search.get('sort');
  const size = positive(search.get('size'));
  const from = search.get('from');
  const to = search.get('to');
  const rep = search.get('rep');
  const failure = search.get('failure');
  const dated = parseRange(from, to);
  return {
    tab: isTabId(tab) ? tab : DEFAULT_VIEW.tab,
    page: page ?? 1,
    q: (search.get('q') ?? '').slice(0, 100),
    sort: {
      by: SORT_FIELDS.includes(sort as SortField) ? (sort as SortField) : DEFAULT_SORT.by,
      dir: search.get('dir') === 'asc' ? 'asc' : search.get('dir') === 'desc' ? 'desc' : DEFAULT_SORT.dir,
    },
    size: size !== null && (PAGE_SIZES as readonly number[]).includes(size) ? size : null,
    from: dated?.from ?? null,
    to: dated?.to ?? null,
    basis: search.get('basis') === 'delivery' ? 'delivery' : 'created',
    product: positive(search.get('product')),
    agent: positive(search.get('agent')),
    rep: rep === 'none' ? 'none' : positive(rep),
    flagged: search.get('flagged') === '1',
    failure: FAILURE_REASONS.some(([reason]) => reason === failure) ? (failure as FailureReason) : null,
    ids: readIds(search.get('ids')),
  };
}

/** Values equal to the default are left out, so the plain page keeps a plain URL. */
export function writeView(view: ListView): URLSearchParams {
  const out = new URLSearchParams();
  if (view.tab !== DEFAULT_VIEW.tab) out.set('status', view.tab);
  if (view.q) out.set('q', view.q);
  if (view.sort.by !== DEFAULT_SORT.by) out.set('sort', view.sort.by);
  if (view.sort.dir !== DEFAULT_SORT.dir || view.sort.by !== DEFAULT_SORT.by) out.set('dir', view.sort.dir);
  if (view.page !== 1) out.set('page', String(view.page));
  if (view.size !== null) out.set('size', String(view.size));
  if (view.from && view.to) {
    out.set('from', view.from);
    out.set('to', view.to);
  }
  if (view.basis !== 'created') out.set('basis', view.basis);
  if (view.product !== null) out.set('product', String(view.product));
  if (view.agent !== null) out.set('agent', String(view.agent));
  if (view.rep !== null) out.set('rep', String(view.rep));
  if (view.flagged) out.set('flagged', '1');
  if (view.failure) out.set('failure', view.failure);
  if (view.ids) out.set('ids', view.ids.join(','));
  return out;
}

/* ---- the date range (F-311). Africa/Accra is UTC, so every date here is a UTC date. ---- */

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m, d));

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now: Date = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = utc(y, m, now.getUTCDate());
  switch (preset) {
    case 'today': return { from: iso(today), to: iso(today) };
    case 'yesterday': return { from: iso(new Date(+today - DAY)), to: iso(new Date(+today - DAY)) };
    case 'last7': return { from: iso(new Date(+today - 6 * DAY)), to: iso(today) };
    case 'month': return { from: iso(utc(y, m, 1)), to: iso(utc(y, m + 1, 0)) };
    case 'lastMonth': return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) };
  }
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', month: 'This month', lastMonth: 'Last month', custom: 'Custom',
};

/** The range the view shows: the dates in the URL, or this month. */
export function rangeOf(view: ListView, now: Date = new Date()): { from: string; to: string } {
  return view.from && view.to ? { from: view.from, to: view.to } : presetRange('month', now);
}

export function presetOf(range: { from: string; to: string }, now: Date = new Date()): RangePreset {
  const names = ['today', 'yesterday', 'last7', 'month', 'lastMonth'] as const;
  return names.find((n) => {
    const r = presetRange(n, now);
    return r.from === range.from && r.to === range.to;
  }) ?? 'custom';
}

/** "in October", "today", "from 1 Oct to 17 Oct": the end of the page sub-line. `lead` 'for' gives "for October" and "for the last 7 days". */
export function rangePhrase(range: { from: string; to: string }, now: Date = new Date(), lead: 'in' | 'for' = 'in'): string {
  const preset = presetOf(range, now);
  const month = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  switch (preset) {
    case 'today': return 'today';
    case 'yesterday': return 'yesterday';
    case 'last7': return `${lead} the last 7 days`;
    case 'month':
    case 'lastMonth': return `${lead} ${month(range.from)}`;
    default: return range.from === range.to ? `on ${day(range.from)}` : `from ${day(range.from)} to ${day(range.to)}`;
  }
}

export const sizeOf = (view: ListView, saved: number): number => view.size ?? saved;

export function listParams(view: ListView, limit: number, now: Date = new Date()): OrderListParams {
  const status = tabStatuses(view.tab);
  const range = rangeOf(view, now);
  return {
    ...(status.length && { status }),
    ...(view.tab === 'unpaid_by_agent' && { tab: view.tab }),
    ...(view.q && { search: view.q }),
    sortBy: view.sort.by,
    sortOrder: view.sort.dir,
    page: view.page,
    limit,
    // imported history orders can be older than the range, so a list of ids shows them whatever the dates
    // and the Unpaid by agent view counts every overdue order, so it sends no dates
    ...(!view.ids && !isViewTab(view.tab) && { startDate: range.from, endDate: range.to, dateBasis: view.basis }),
    ...(view.ids && { ids: view.ids.join(',') }),
    ...(view.product !== null && { productId: [view.product] }),
    ...(view.agent !== null && { deliveryAgentId: view.agent }),
    ...(view.rep === 'none' && { unassigned: true }),
    ...(typeof view.rep === 'number' && { customerRepId: view.rep }),
    ...(view.flagged && { flag: 'any' as const }),
    ...(view.failure && { failureReason: view.failure }),
  };
}
