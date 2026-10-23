import type { OrderStatus } from '../../types';
import type { TagTone } from '../../components/ui-v2';
import type { OrderCounts, OrderListRow } from '../../services/orders.service';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { personName } from '../../utils/people';

/** Tab ids are the URL values of `?status=`: a status, `payment_issues` (two statuses) or `all`. */
export type StatusTabId = 'all' | OrderStatus | 'payment_issues';

interface TabDef {
  id: StatusTabId;
  label: string;
  statuses: OrderStatus[];
  /** Shown only when its count is above 0 (F-308). */
  extra?: boolean;
}

/** Tab order of docs/mockups/v2/index.html#orders. "Unpaid by agent" (F-309) ships in M5. */
const STATUS_TABS: TabDef[] = [
  { id: 'all', label: 'All', statuses: [] },
  { id: 'pending_confirmation', label: ORDER_STATUS_LABELS.pending_confirmation, statuses: ['pending_confirmation'] },
  { id: 'confirmed', label: ORDER_STATUS_LABELS.confirmed, statuses: ['confirmed'] },
  { id: 'preparing', label: ORDER_STATUS_LABELS.preparing, statuses: ['preparing'] },
  { id: 'ready_for_pickup', label: ORDER_STATUS_LABELS.ready_for_pickup, statuses: ['ready_for_pickup'] },
  { id: 'out_for_delivery', label: ORDER_STATUS_LABELS.out_for_delivery, statuses: ['out_for_delivery'] },
  { id: 'delivered', label: ORDER_STATUS_LABELS.delivered, statuses: ['delivered'] },
  { id: 'failed_delivery', label: ORDER_STATUS_LABELS.failed_delivery, statuses: ['failed_delivery'] },
  { id: 'returned', label: ORDER_STATUS_LABELS.returned, statuses: ['returned'] },
  { id: 'cancelled', label: ORDER_STATUS_LABELS.cancelled, statuses: ['cancelled'] },
  { id: 'digital_delivered', label: 'Digital', statuses: ['digital_delivered'], extra: true },
  { id: 'payment_issues', label: 'Payment issues', statuses: ['payment_pending', 'payment_failed'], extra: true },
];

export const isTabId = (value: string | null): value is StatusTabId => STATUS_TABS.some((t) => t.id === value);

export const tabStatuses = (id: StatusTabId): OrderStatus[] => STATUS_TABS.find((t) => t.id === id)?.statuses ?? [];

export function tabCount(id: StatusTabId, counts: OrderCounts): number {
  if (id === 'all') return counts.all;
  return tabStatuses(id).reduce((sum, s) => sum + (counts.byStatus[s] ?? 0), 0);
}

/** The tabs to draw: every fixed tab, and an extra tab when it has orders or is the one selected. */
export function visibleTabs(counts: OrderCounts | null, selected: StatusTabId): TabDef[] {
  return STATUS_TABS.filter((t) => !t.extra || t.id === selected || (counts !== null && tabCount(t.id, counts) > 0));
}

/** Tag tone per status, as ST in the mockup (new statuses: payment waiting = warn, digital = ok, payment failed = bad). */
export const STATUS_TONE: Record<OrderStatus, TagTone> = {
  pending_confirmation: 'warn',
  payment_pending: 'warn',
  confirmed: 'n',
  preparing: 'n',
  ready_for_pickup: 'n',
  out_for_delivery: 'v',
  delivered: 'ok',
  digital_delivered: 'ok',
  cancelled: 'n',
  returned: 'bad',
  failed_delivery: 'bad',
  payment_failed: 'bad',
};

/** "#24118" (F-300). One place, so every screen writes an order number the same way. */
export const orderNumber = (id: number): string => `#${id}`;

export const customerName = (row: OrderListRow): string => personName(row.customer);

/** "Copybook set × 2 + 1 more": the first item and how many more (an upsell shows its own name). */
export function productSummary(row: OrderListRow): string {
  const [first, ...rest] = row.orderItems;
  if (!first) return '—';
  const name = first.metadata?.upsellName ?? first.product?.name ?? 'Unknown product';
  return `${name} × ${first.quantity}${rest.length ? ` + ${rest.length} more` : ''}`;
}

/** "17 Oct, 14:02", in store time (Africa/Accra, as the order drawer), not the browser's zone. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Orders that can be deleted (F-316). The others have money or stock effects. */
export const DELETABLE: OrderStatus[] = [
  'pending_confirmation', 'payment_pending', 'payment_failed', 'confirmed', 'preparing', 'ready_for_pickup', 'cancelled', 'failed_delivery',
];

/** Orders whose delivery agent can no longer change (F-314). */
export const CLOSED: OrderStatus[] = ['delivered', 'digital_delivered', 'returned', 'cancelled'];
