import type { PartnerTab } from '../../services/delivery-partners.service';
import { presetRange } from '../orders/urlState';
import { isPartnerTab } from './model';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the Deliveries view depends on. It lives in the URL, so a copied link opens the same table, range and drawer. */
export interface DeliveriesView {
  tab: PartnerTab;
  /** YYYY-MM-DD, both or neither. Neither means "This month" (F-710). */
  from: string | null;
  to: string | null;
  /** The open partner drawer. */
  partner: number | null;
}

export const DEFAULT_VIEW: DeliveriesView = { tab: 'all', from: null, to: null, partner: null };

export function parseView(search: URLSearchParams): DeliveriesView {
  const tab = search.get('tab');
  const from = search.get('from');
  const to = search.get('to');
  const partner = Number(search.get('partner'));
  const dated = from !== null && to !== null && DATE.test(from) && DATE.test(to) && from <= to;
  return {
    tab: isPartnerTab(tab) ? tab : DEFAULT_VIEW.tab,
    from: dated ? from : null,
    to: dated ? to : null,
    partner: Number.isInteger(partner) && partner > 0 ? partner : null,
  };
}

/** Values equal to the default are left out, so the plain page keeps a plain URL. */
export function writeView(view: DeliveriesView): URLSearchParams {
  const out = new URLSearchParams();
  if (view.tab !== DEFAULT_VIEW.tab) out.set('tab', view.tab);
  if (view.from && view.to) {
    out.set('from', view.from);
    out.set('to', view.to);
  }
  if (view.partner !== null) out.set('partner', String(view.partner));
  return out;
}

/** The range the view shows: the dates in the URL, or this month. */
export const rangeOf = (view: DeliveriesView, now: Date = new Date()): { from: string; to: string } =>
  view.from && view.to ? { from: view.from, to: view.to } : presetRange('month', now);
