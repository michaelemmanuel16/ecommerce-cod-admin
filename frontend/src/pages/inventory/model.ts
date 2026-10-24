import { format, parseISO } from 'date-fns';
import type { TagTone } from '../../components/ui-v2';
import type {
  AdjustReason, CountReason, CountSource, DisputeReason, LocationCard, ReturnReason, StockLocationType, Transfer, TransferReason, TransferType,
} from '../../services/inventory.service';

export const TYPE_LABEL: Record<StockLocationType, string> = { own_store: 'Own store', partner_3pl: '3PL', agent: 'Agent' };

export const SOURCE_LABEL: Record<CountSource, string> = { own_count: 'Our count', three_pl_dashboard: '3PL dashboard count', agent_count: 'Agent count' };
export const COUNT_SOURCES: CountSource[] = ['own_count', 'three_pl_dashboard', 'agent_count'];

/** The count source that usually fits a location type; the sheet starts with it. */
export const DEFAULT_SOURCE: Record<StockLocationType, CountSource> = { own_store: 'own_count', partner_3pl: 'three_pl_dashboard', agent: 'agent_count' };

export const MOVE_LABEL: Record<TransferType, string> = {
  allocation: 'Allocation',
  order_fulfillment: 'Order fulfilled',
  agent_transfer: 'Agent transfer',
  return_to_warehouse: 'Return',
  adjustment: 'Adjustment',
  receipt: 'Shipment received',
  opening: 'Opening stock',
  order_reversal: 'Order reversed',
  count_adjustment: 'Count adjustment',
};
export const MOVE_TONE: Record<TransferType, TagTone> = {
  allocation: 'v', order_fulfillment: 'ok', agent_transfer: 'n', return_to_warehouse: 'warn', adjustment: 'n',
  receipt: 'ok', opening: 'n', order_reversal: 'warn', count_adjustment: 'n',
};
/** Tab order of the history modal. */
export const MOVE_TYPES: TransferType[] = [
  'allocation', 'order_fulfillment', 'agent_transfer', 'return_to_warehouse', 'adjustment', 'count_adjustment', 'receipt', 'opening', 'order_reversal',
];

export const REASON_LABEL: Record<TransferReason, string> = {
  short_in_package: 'Short in package',
  damaged: 'Damaged goods',
  not_received: 'Not received',
  failed_deliveries: 'Failed deliveries',
  customer_refused: 'Customer refused',
  agent_stopped_delivering: 'Agent stopped delivering',
  physical_count_correction: 'Physical count correction',
  lost_or_stolen: 'Lost or stolen',
  found_extra_stock: 'Found extra stock',
  short_on_arrival: 'Short on arrival',
  other: 'Other',
};
export const DISPUTE_REASONS: DisputeReason[] = ['short_in_package', 'damaged', 'not_received'];
export const RETURN_REASONS: ReturnReason[] = ['failed_deliveries', 'customer_refused', 'damaged', 'agent_stopped_delivering', 'other'];
export const ADJUST_REASONS: AdjustReason[] = ['physical_count_correction', 'damaged', 'lost_or_stolen', 'found_extra_stock', 'other'];
export const COUNT_REASONS: CountReason[] = ['physical_count_correction', 'damaged', 'lost_or_stolen', 'found_extra_stock', 'short_on_arrival', 'other'];

export const num = (n: number): string => n.toLocaleString('en-GB');

/** "15 Oct" from a YYYY-MM-DD day or an ISO time. */
export const shortDate = (iso: string): string => format(parseISO(iso), 'd MMM');
export const shortDateTime = (iso: string): string => format(parseISO(iso), 'd MMM, HH:mm');

export const personName = (u: { firstName: string; lastName: string }): string => `${u.firstName} ${u.lastName}`.trim();

/** Today as YYYY-MM-DD in the browser's zone (the count date input). */
export const today = (): string => format(new Date(), 'yyyy-MM-dd');

/** Where a stock row's gap tag points: "12 units off", "Matches", "Count is old" or nothing (no count yet). */
export function cardTag(card: LocationCard): { tone: TagTone; text: string } | null {
  const c = card.latestCount;
  if (!c) return null;
  if (c.isOld) return { tone: 'warn', text: 'Count is old' };
  return c.unitsOff > 0 ? { tone: 'bad', text: `${num(c.unitsOff)} ${c.unitsOff === 1 ? 'unit' : 'units'} off` } : { tone: 'ok', text: 'Matches' };
}

/** "Logiswift count, 15 Oct" style line under a card. */
export function cardNote(card: LocationCard): string {
  const c = card.latestCount;
  if (!c) return 'No stock count yet';
  return `${SOURCE_LABEL[c.source]}, ${shortDate(c.date)}`;
}

/** The place at one end of a move. The ends the move does not have read as what they are. */
export function placeName(t: Pick<Transfer, 'transferType' | 'fromLocation' | 'toLocation'>, side: 'from' | 'to'): string {
  const place = side === 'from' ? t.fromLocation : t.toLocation;
  if (place) return place.name;
  if (side === 'from') return t.transferType === 'receipt' ? 'Supplier' : '—';
  return t.transferType === 'order_fulfillment' ? 'Customer' : '—';
}

/** Quantity with a sign for the moves that only add or only remove at one place. */
export function signedQuantity(t: Pick<Transfer, 'transferType' | 'quantity' | 'fromLocation' | 'toLocation'>): string {
  const solo = t.transferType === 'adjustment' || t.transferType === 'count_adjustment';
  if (!solo) return num(t.quantity);
  return t.fromLocation && !t.toLocation ? `−${num(t.quantity)}` : `+${num(t.quantity)}`;
}

export interface StatusView {
  tone: TagTone;
  text: string;
  /** The line under the tag. */
  sub: string | null;
}

/** The status tag of a transfer and the line under it (docs/mockups/v2/inventory.html, Recent transfers). */
export function statusView(t: Transfer): StatusView {
  const counted = t.receivedQuantity;
  const reason = t.reason ? REASON_LABEL[t.reason] : null;
  switch (t.status) {
    case 'in_transit':
      return { tone: 'v', text: 'In transit', sub: null };
    case 'disputed': {
      const short = t.shortQuantity;
      return { tone: 'bad', text: `Received ${num(short)} short`, sub: [counted !== null ? `Counted ${num(counted)} of ${num(t.quantity)}` : null, reason].filter(Boolean).join(' · ') };
    }
    case 'cancelled':
      return { tone: 'n', text: 'Cancelled', sub: null };
    default: {
      // received. A resolved dispute keeps the counted quantity below the sent one.
      if (counted !== null && counted < t.quantity) {
        return { tone: 'n', text: 'Resolved', sub: `Counted ${num(counted)} of ${num(t.quantity)}${reason ? ` · ${reason}` : ''}` };
      }
      return { tone: 'ok', text: 'Received', sub: counted !== null ? `Counted ${num(counted)} of ${num(t.quantity)}` : null };
    }
  }
}

/** A person may confirm a transfer on behalf of a 3PL or own store when it is still in transit. */
export const canConfirmHere = (t: Transfer): boolean =>
  t.status === 'in_transit' && (t.toLocation?.type === 'partner_3pl' || t.toLocation?.type === 'own_store');

/** F-654: units a 3PL says it sent back never reached us, so they cannot be "returned to the source". */
export const canReturnToSource = (t: Transfer): boolean => !(t.transferType === 'return_to_warehouse' && t.fromLocation?.type === 'partner_3pl');

const CSV_COLUMNS = ['Date', 'Type', 'From', 'To', 'Product', 'SKU', 'Quantity', 'Status', 'Counted', 'Reason', 'Order', 'Note'] as const;

/** A text cell: quoted, and a leading = + - @ is defused so a spreadsheet never runs it as a formula. */
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The transfers as CSV, one row per move, oldest column order as in the history table (F-659). Numbers are plain. */
export function transfersToCsv(transfers: Transfer[]): string {
  const rows = transfers.map((t) => {
    const solo = t.transferType === 'adjustment' || t.transferType === 'count_adjustment';
    const quantity = solo && t.fromLocation && !t.toLocation ? -t.quantity : t.quantity;
    return [
      csvText(format(parseISO(t.createdAt), 'yyyy-MM-dd HH:mm')),
      csvText(MOVE_LABEL[t.transferType]),
      csvText(placeName(t, 'from')),
      csvText(placeName(t, 'to')),
      csvText(t.product.name),
      csvText(t.product.sku),
      String(quantity),
      csvText(statusView(t).text),
      t.receivedQuantity === null ? '' : String(t.receivedQuantity),
      csvText(t.reason ? REASON_LABEL[t.reason] : ''),
      t.orderId === null ? '' : String(t.orderId),
      csvText(t.notes ?? ''),
    ].join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

/** "Magic Groove copybook set × 20" */
export const itemsText = (t: Transfer): string => `${t.product.name} \u00d7 ${signedQuantity(t)}`;

export const whenText = (t: Transfer): string => shortDate(t.createdAt);
