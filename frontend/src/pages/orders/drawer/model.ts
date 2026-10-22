import type { TagTone } from '../../../components/ui-v2';
import type { OrderDetail, OrderEditBody, PaymentTagCode } from '../../../services/orders.service';
import type { OrderStatus } from '../../../types';
import { formatPhoneLocal } from '../../../utils/format';
import { personName } from '../../../utils/people';

/** Which fields an edit may change, by status group (F-318). The server enforces the same table. */
export type EditGroup = 'full' | 'dispatched' | 'notes';

export function editGroup(status: OrderStatus): EditGroup {
  if (status === 'out_for_delivery' || status === 'failed_delivery') return 'dispatched';
  if (status === 'delivered' || status === 'digital_delivered' || status === 'returned' || status === 'cancelled') return 'notes';
  return 'full';
}

/** Tag tone per payment tag, as PAY in the mockup. */
export const PAYMENT_TONE: Record<PaymentTagCode, TagTone> = {
  paid: 'ok',
  paid_in: 'ok',
  cash_with_agent: 'warn',
  overdue_from_agent: 'bad',
  pay_on_delivery: 'n',
  no_payment: 'n',
};

const METHODS: Record<string, string> = {
  cod: 'Cash on delivery',
  paystack: 'Online payment',
  paystack_full: 'Online payment',
  paystack_deposit: 'Online deposit, rest on delivery',
};
export const methodLabel = (method: string): string => METHODS[method] ?? method.replace(/_/g, ' ');

export const num = (v: string | number | null | undefined): number => Number(v ?? 0) || 0;

/** The call button: a `tel:` link on the stored E.164 number. */
export const telUrl = (e164: string): string => `tel:${e164.replace(/\s/g, '')}`;
/** The WhatsApp button: `https://wa.me/<number>` with the E.164 number and no "+". */
export const whatsappUrl = (e164: string): string => `https://wa.me/${e164.replace(/\D/g, '')}`;

/** "17 Oct, 14:02" in Accra time (F-322). */
export function accraTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Call outcomes the Log call form offers (the existing enum, F-324 renames them in M7). */
export const CALL_OUTCOMES: Array<[value: string, label: string]> = [
  ['confirmed', 'Confirmed'],
  ['rescheduled', 'Rescheduled'],
  ['no_answer', 'No answer'],
  ['cancelled', 'Cancelled'],
  ['other', 'Other'],
];

const OUTCOME_LABEL: Record<string, string> = {
  ...Object.fromEntries(CALL_OUTCOMES),
  not_reachable: 'Not reachable',
  declined: 'Declined',
  call_back_later: 'Call back later',
  wrong_number: 'Wrong number',
};
export const outcomeLabel = (o: string): string => OUTCOME_LABEL[o] ?? o.replace(/_/g, ' ');
export const outcomeTone = (o: string): TagTone =>
  o === 'confirmed' ? 'ok' : o === 'rescheduled' || o === 'call_back_later' ? 'v' : o === 'no_answer' || o === 'not_reachable' ? 'warn' : o === 'cancelled' || o === 'declined' || o === 'wrong_number' ? 'bad' : 'n';

/** The fields an edit form holds, as strings so a half-typed number is not lost. */
export interface EditDraft {
  name: string;
  email: string;
  phone: string;
  altPhone: string;
  address: string;
  region: string;
  town: string;
  notes: string;
  discount: string;
  total: string;
  shipping: number;
  /** The person typed the total; otherwise it follows the lines. */
  totalTouched: boolean;
  items: Array<{ key: string; productId: number; name: string; quantity: string; unitPrice: string }>;
}

export function draftOf(o: OrderDetail): EditDraft {
  return {
    name: personName(o.customer),
    email: o.customer.email ?? '',
    phone: formatPhoneLocal(o.customer.phoneNumber),
    altPhone: o.customer.alternatePhone ? formatPhoneLocal(o.customer.alternatePhone) : '',
    address: o.deliveryAddress ?? '',
    region: o.deliveryState ?? '',
    town: o.deliveryArea ?? '',
    notes: o.notes ?? '',
    discount: String(num(o.discount)),
    total: String(num(o.totalAmount)),
    shipping: num(o.totalAmount) - num(o.subtotal) + num(o.discount),
    totalTouched: false,
    items: o.items.map((i) => ({ key: `i${i.id}`, productId: i.productId, name: i.metadata?.upsellName ?? i.product?.name ?? 'Unknown product', quantity: String(i.quantity), unitPrice: String(num(i.unitPrice)) })),
  };
}

/** Lines minus the discount: the total the form shows until the person types their own. */
export const linesTotal = (d: EditDraft): number =>
  d.items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0) - (Number(d.discount) || 0) + d.shipping;

const FIELDS: Record<EditGroup, ReadonlyArray<keyof EditBodyFields>> = {
  full: ['customerName', 'customerEmail', 'customerPhone', 'alternatePhone', 'deliveryAddress', 'deliveryState', 'deliveryArea', 'notes', 'orderItems', 'discount', 'totalAmount'],
  dispatched: ['customerPhone', 'alternatePhone', 'deliveryAddress', 'deliveryState', 'deliveryArea', 'notes'],
  notes: ['notes'],
};
type EditBodyFields = Omit<OrderEditBody, 'updatedAt' | 'confirmTotalChange' | 'confirmPhoneChange'>;

/**
 * What the form changed, as the PUT body: only the fields of the status group that differ from the stored order.
 * `total` is the new total when it changes (typed, or worked out from the lines), for the confirm tick on a confirmed order.
 */
export function buildEdit(o: OrderDetail, d: EditDraft): { body: EditBodyFields; changed: string[]; total: { was: number; now: number } | null } {
  const text = (v: string | null | undefined) => (v ?? '').trim();
  const c = o.customer;
  const lines = d.items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }));
  const key = (l: Array<{ productId: number; quantity: number; unitPrice: number }>) => l.map((i) => `${i.productId}:${i.quantity}:${i.unitPrice}`).sort().join('|');
  const itemsChanged = key(lines) !== key(o.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: num(i.unitPrice) })));
  const discountChanged = (Number(d.discount) || 0) !== num(o.discount);
  const was = num(o.totalAmount);
  const now = d.totalTouched ? Number(d.total) : itemsChanged || discountChanged ? linesTotal(d) : was;
  const totalChanged = Math.abs(now - was) > 0.00001;

  const all: EditBodyFields = {};
  if (text(d.name) !== personName(c)) all.customerName = text(d.name);
  if (text(d.email) !== text(c.email)) all.customerEmail = text(d.email);
  if (text(d.phone) !== formatPhoneLocal(c.phoneNumber)) all.customerPhone = text(d.phone);
  if (text(d.altPhone) !== (c.alternatePhone ? formatPhoneLocal(c.alternatePhone) : '')) all.alternatePhone = text(d.altPhone);
  if (text(d.address) !== text(o.deliveryAddress)) all.deliveryAddress = text(d.address);
  if (text(d.region) !== text(o.deliveryState)) all.deliveryState = text(d.region);
  if (text(d.town) !== text(o.deliveryArea)) all.deliveryArea = text(d.town);
  if (text(d.notes) !== text(o.notes)) all.notes = text(d.notes);
  if (itemsChanged) all.orderItems = lines;
  if (discountChanged) all.discount = Number(d.discount) || 0;
  if (d.totalTouched && totalChanged) all.totalAmount = now;

  const allowed = FIELDS[editGroup(o.status)];
  const body = Object.fromEntries(Object.entries(all).filter(([k]) => allowed.includes(k as keyof EditBodyFields))) as EditBodyFields;
  const changed = Object.keys(body);
  return { body, changed, total: totalChanged && (itemsChanged || discountChanged || d.totalTouched) && allowed.includes('totalAmount') ? { was, now } : null };
}
