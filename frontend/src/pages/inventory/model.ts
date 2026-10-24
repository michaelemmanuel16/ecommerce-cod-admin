import { ArrowLeftRight, ClipboardCheck, PackagePlus, SlidersHorizontal, Undo2, type LucideIcon } from 'lucide-react';
import type { TagTone } from '../../components/ui-v2';
import type {
  AdjustReason, CountReason, CountSource, DisputeReason, ReturnReason, StockLocationType, Transfer, TransferReason, TransferType,
} from '../../services/inventory.service';
import { formatDate } from '../../utils/format';
import { count } from '../deliveries/model';

export const TYPE_LABEL: Record<StockLocationType, string> = { own_store: 'Own store', partner_3pl: '3PL', agent: 'Agent' };

export const SOURCE_LABEL: Record<CountSource, string> = { own_count: 'Our count', three_pl_dashboard: '3PL dashboard count', agent_count: 'Agent count' };
export const COUNT_SOURCES = Object.keys(SOURCE_LABEL) as CountSource[];

/** The count source that usually fits a location type; the sheet starts with it. */
export const DEFAULT_SOURCE: Record<StockLocationType, CountSource> = { own_store: 'own_count', partner_3pl: 'three_pl_dashboard', agent: 'agent_count' };

/** The stock moves a person starts: three that move units between places, and one that sets a quantity. */
export type MoveKind = 'allocate' | 'transfer' | 'return';
export type ModalKind = MoveKind | 'adjust';
/** What the page opens: a modal or the count sheet. Also the `?action=` values. */
export type StockAction = ModalKind | 'count';

interface ActionMeta {
  /** The one name of the action: menu, card button, table tooltip, modal title and submit button. */
  label: string;
  Icon: LucideIcon;
  /** Holder types the "From" (or "Holder") list offers. */
  from: StockLocationType[];
  /** Location types the stock can go to. Empty for an action that moves nothing. */
  to: StockLocationType[];
  /** The toast after a save. */
  done: (d: { quantity: number; product: string; from: string; to: string }) => string;
}

const ALL_HOLDERS: StockLocationType[] = ['own_store', 'partner_3pl', 'agent'];

export const ACTION_META: Record<StockAction, ActionMeta> = {
  allocate: {
    label: 'Allocate to an agent', Icon: PackagePlus, from: ['own_store', 'partner_3pl'], to: ['agent', 'partner_3pl', 'own_store'],
    done: (d) => `Allocated ${count(d.quantity)} of ${d.product} to ${d.to}. In transit until they confirm.`,
  },
  transfer: {
    label: 'Transfer to another agent', Icon: ArrowLeftRight, from: ['agent'], to: ['agent'],
    done: (d) => `Sent ${count(d.quantity)} of ${d.product} from ${d.from} to ${d.to}. In transit until they confirm.`,
  },
  return: {
    label: 'Return to warehouse', Icon: Undo2, from: ['agent', 'partner_3pl'], to: ['own_store', 'partner_3pl'],
    done: (d) => `${count(d.quantity)} of ${d.product} on the way back from ${d.from}. In transit until it is received.`,
  },
  adjust: {
    label: 'Adjust quantity', Icon: SlidersHorizontal, from: ALL_HOLDERS, to: [],
    done: (d) => `${d.from} now holds ${count(d.quantity)} of ${d.product}. Reason logged.`,
  },
  count: { label: 'Start stock count', Icon: ClipboardCheck, from: ALL_HOLDERS, to: [], done: () => 'Count saved.' },
};

/** The buttons under a card and in a table row: a store or 3PL sends stock out, an agent returns or passes it on. */
export const HOLDER_ACTIONS: Record<StockLocationType, ModalKind[]> = {
  own_store: ['allocate', 'adjust'],
  partner_3pl: ['allocate', 'adjust'],
  agent: ['return', 'transfer', 'adjust'],
};

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

/** "15 Oct" from a YYYY-MM-DD day or an ISO time. A bare day is read as local midnight, so no time zone moves it. */
export const shortDate = (iso: string): string => formatDate(iso.length === 10 ? `${iso}T00:00:00` : iso, 'd MMM');
export const shortDateTime = (iso: string): string => formatDate(iso, 'd MMM, HH:mm');

/** Today as YYYY-MM-DD in the browser's zone (the count date input). */
export const today = (): string => formatDate(new Date(), 'yyyy-MM-dd');

/**
 * The tag for a count against our records. `difference` is counted minus our records, the sign of a count line: -12 is 12
 * units fewer than we thought. A card says "12 units off" (`wording: 'off'`), a table row says "−12 units".
 */
export function countTag({ isOld, difference, wording = 'signed' }: { isOld: boolean; difference: number; wording?: 'signed' | 'off' }): { tone: TagTone; text: string } {
  if (isOld) return { tone: 'warn', text: 'Count is old' };
  if (difference === 0) return { tone: 'ok', text: 'Matches' };
  const units = Math.abs(difference);
  const noun = units === 1 ? 'unit' : 'units';
  return { tone: 'bad', text: wording === 'off' ? `${count(units)} ${noun} off` : `${difference < 0 ? '−' : '+'}${count(units)} ${noun}` };
}

/** "Logiswift count, 15 Oct" style line under a card. */
export function cardNote(latest: { source: CountSource; date: string } | null): string {
  return latest ? `${SOURCE_LABEL[latest.source]}, ${shortDate(latest.date)}` : 'No stock count yet';
}

/** The place at one end of a move. The ends the move does not have read as what they are. */
export function placeName(t: Pick<Transfer, 'transferType' | 'fromLocation' | 'toLocation'>, side: 'from' | 'to'): string {
  const place = side === 'from' ? t.fromLocation : t.toLocation;
  if (place) return place.name;
  if (side === 'from') return t.transferType === 'receipt' ? 'Supplier' : '—';
  return t.transferType === 'order_fulfillment' ? 'Customer' : '—';
}

/** The quantity of a move. An adjustment or count fix that only takes units out of a place is negative; every other move is unsigned. */
export function signedValue(t: Pick<Transfer, 'transferType' | 'quantity' | 'fromLocation' | 'toLocation'>): number {
  const solo = t.transferType === 'adjustment' || t.transferType === 'count_adjustment';
  return solo && t.fromLocation && !t.toLocation ? -t.quantity : t.quantity;
}

/** `signedValue` as text: a solo move shows its sign ("−2", "+3"), a move between places shows the plain number. */
export function signedQuantity(t: Pick<Transfer, 'transferType' | 'quantity' | 'fromLocation' | 'toLocation'>): string {
  const solo = t.transferType === 'adjustment' || t.transferType === 'count_adjustment';
  const value = signedValue(t);
  return solo ? `${value < 0 ? '−' : '+'}${count(Math.abs(value))}` : count(value);
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
      return { tone: 'bad', text: `Received ${count(short)} short`, sub: [counted !== null ? `Counted ${count(counted)} of ${count(t.quantity)}` : null, reason].filter(Boolean).join(' · ') };
    }
    case 'cancelled':
      return { tone: 'n', text: 'Cancelled', sub: null };
    default: {
      // received. A resolved dispute keeps the counted quantity below the sent one.
      if (counted !== null && counted < t.quantity) {
        return { tone: 'n', text: 'Resolved', sub: `Counted ${count(counted)} of ${count(t.quantity)}${reason ? ` · ${reason}` : ''}` };
      }
      return { tone: 'ok', text: 'Received', sub: counted !== null ? `Counted ${count(counted)} of ${count(t.quantity)}` : null };
    }
  }
}

/** A person may confirm a transfer on behalf of a 3PL or own store when it is still in transit. */
export const canConfirmHere = (t: Transfer): boolean =>
  t.status === 'in_transit' && (t.toLocation?.type === 'partner_3pl' || t.toLocation?.type === 'own_store');

/** F-654: units a 3PL says it sent back never reached us, so they cannot be "returned to the source". */
export const canReturnToSource = (t: Transfer): boolean => !(t.transferType === 'return_to_warehouse' && t.fromLocation?.type === 'partner_3pl');
