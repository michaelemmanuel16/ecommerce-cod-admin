import type { Holder, HolderCount, ProductRow, ProductStatus, ProductTab } from '../../services/products.service';
import type { TagTone } from '../../components/ui-v2';

/** Shared bits of the Products page: tabs, status tags, wording of the stock notes. */

export const PRODUCT_TABS: Array<{ id: ProductTab; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
];

export const isProductTab = (v: string | null): v is ProductTab => v === 'active' || v === 'archived' || v === 'all';

/** Delivery success target of the Products table (Settings has no field for it yet; the Deliveries page reads the same 60). */
export const SUCCESS_TARGET = 60;

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

export const pct = (n: number | null | undefined): string => (n == null ? '—' : `${Math.round(n)}%`);

export const monthNow = (now: Date = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const SOURCE: Record<HolderCount['source'], string> = { own_count: 'own', three_pl_dashboard: '3PL dashboard', agent_count: 'agent' };

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
export const shortDay = (ymd: string): string => DAY.format(new Date(`${ymd}T12:00:00`));

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

export const HOLDER_TYPE: Record<Holder['type'], string> = { own_store: 'Own store', partner_3pl: '3PL', agent: 'Agent' };

/** Whole-number text of a possibly-string API number. */
export const num = (v: number | string | null | undefined): number => (v == null || v === '' ? 0 : Number(v));
