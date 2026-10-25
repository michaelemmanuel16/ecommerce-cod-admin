import type { Holder, HolderCount, ProductRow, ProductStatus, ProductTab } from '../../services/products.service';
import type { TagTone } from '../../components/ui-v2';
import { formatPercentage, todayYmd } from '../../utils/format';
import { shortDay as dashboardShortDay } from '../dashboard/format';

/** Shared bits of the Products page: tabs, status tags, wording of the stock notes, and the margin formula. */

export const PRODUCT_TABS: Array<{ id: ProductTab; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
];

export const isProductTab = (v: string | null): v is ProductTab => v === 'active' || v === 'archived' || v === 'all';

export const STATUS_TAG: Record<ProductStatus, { label: string; tone: TagTone }> = {
  archived: { label: 'Archived', tone: 'n' },
  digital: { label: 'Digital', tone: 'v' },
  out_of_stock: { label: 'Out of stock', tone: 'bad' },
  low_stock: { label: 'Low stock', tone: 'warn' },
  active: { label: 'Active', tone: 'ok' },
};

export const FILE_TYPES = ['PDF', 'EPUB', 'MP3', 'MP4 video', 'ZIP', 'Other'] as const;

/** The line under the stock figure: days of cover, or why there is none. */
export function coverText(row: ProductRow): string | null {
  if (row.productType === 'digital') return null;
  if ((row.onHandTotal ?? 0) <= 0) return 'Sold out';
  if (row.daysOfCover === null) return 'Plenty';
  return `${row.daysOfCover} ${row.daysOfCover === 1 ? 'day' : 'days'} of cover`;
}

/** Whole percent, or a dash for no figure. */
export const pct = (n: number | null | undefined): string => (n == null ? '—' : formatPercentage(Math.round(n), 0));

/**
 * Margin before delivery: (price - cost) / price, whole percent. The server's rule (productService.marginPercent): null when the
 * price is 0 or a physical product has no cost set; a digital product at cost 0 is 100%.
 */
export function marginPercent(price: number, cost: number, productType: 'physical' | 'digital'): number | null {
  if (productType === 'physical' && cost === 0) return null;
  return price > 0 ? Math.round(((price - cost) / price) * 100) : null;
}

/** The current month, YYYY-MM, in the viewer's zone. */
export const monthNow = (): string => todayYmd().slice(0, 7);

/** "17 Oct" from a YYYY-MM-DD day or an ISO timestamp; a dash when empty. The one day formatter of the Products page. */
export const shortDay = (value: string | null | undefined): string => (value ? dashboardShortDay(value.slice(0, 10)) : '—');

/** "Oct" from YYYY-MM. */
export const monthShort = (ym: string): string => shortDay(`${ym}-01`).split(' ')[1];

const SOURCE: Record<HolderCount['source'], string> = { own_count: 'own', three_pl_dashboard: '3PL dashboard', agent_count: 'agent' };

/** "Our records say 100 on hand at Logiswift. The 3PL dashboard count of 15 Oct says 88." One note per holder whose count differs. */
export function countNote(h: Holder): string | null {
  const c = h.count;
  if (!c || c.status !== 'off') return null;
  return `Our records say ${h.onHand} on hand at ${h.name}. The ${SOURCE[c.source]} count of ${shortDay(c.date)} says ${c.counted}.`;
}

/** "Esi Badu and Kwesi Amoah hold none of this product right now." */
export function noneNote(names: string[]): string | null {
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? 'holds' : 'hold'} none of this product right now.`;
}
