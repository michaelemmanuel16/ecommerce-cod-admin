import { AlarmClock, AtSign, Inbox, MessageCircle, MessagesSquare, Settings2, Siren, UserCheck, type LucideIcon } from 'lucide-react';
import type { InboxItem, InboxKind, InboxStatus, InboxSubject, InboxView } from '../../services/inbox.service';
import { formatOrderNumber } from '../../utils/orderNumber';

/** The subjects a thread or a reminder can point at (the API's NOTE_SUBJECT_TYPES). */
const NOTE_SUBJECT_TYPES = ['order', 'customer', 'payout', 'product'] as const;
export const isNoteSubject = (s: InboxSubject | null): s is InboxSubject => !!s && (NOTE_SUBJECT_TYPES as readonly string[]).includes(s.type);

export interface ViewDef { id: InboxView; label: string; icon: LucideIcon; empty: string }

/** Only the views the API serves. */
export const VIEWS: ViewDef[] = [
  { id: 'all', label: 'All', icon: Inbox, empty: 'Nothing needs you right now.' },
  { id: 'assigned', label: 'Assigned to me', icon: UserCheck, empty: 'No orders or conversations assigned to you have news.' },
  { id: 'mentions', label: 'Mentions', icon: AtSign, empty: 'Nobody has mentioned you.' },
  { id: 'replies', label: 'Replies', icon: MessageCircle, empty: 'No customer replies waiting.' },
  { id: 'reminders', label: 'Reminders', icon: AlarmClock, empty: 'No reminders are due.' },
  { id: 'notes', label: 'Team notes', icon: MessagesSquare, empty: 'No team notes on your work.' },
  { id: 'alerts', label: 'Alerts', icon: Siren, empty: 'No alerts. Everything is running.' },
];

/** The rep app shows these. */
export const REP_VIEWS: InboxView[] = ['all', 'reminders', 'mentions', 'notes', 'alerts'];

export const STATUS_EMPTY: Record<Exclude<InboxStatus, 'open'>, string> = {
  snoozed: 'Nothing is snoozed.',
  done: 'Nothing is marked done yet.',
};

const KIND_ICON: Record<InboxKind, { icon: LucideIcon; tone: string }> = {
  alert: { icon: Siren, tone: 'coral' },
  reply: { icon: MessageCircle, tone: 'pine' },
  mention: { icon: AtSign, tone: 'violet' },
  reminder: { icon: AlarmClock, tone: 'gold' },
  note: { icon: MessagesSquare, tone: 'violet' },
  system: { icon: Settings2, tone: 'n' },
};
export const kindIcon = (kind: InboxKind) => KIND_ICON[kind] ?? KIND_ICON.system;

const KIND_LABEL: Record<InboxKind, string> = { alert: 'Alert', reply: 'Reply', mention: 'Mention', reminder: 'Reminder', note: 'Team note', system: 'System' };
export const kindLabel = (kind: InboxKind): string => KIND_LABEL[kind] ?? 'System';

const VIEW_KIND: Partial<Record<InboxView, InboxKind>> = { alerts: 'alert', replies: 'reply', mentions: 'mention', reminders: 'reminder', notes: 'note' };

/** Does a row that just arrived belong in this view? `assigned` needs the server (it checks the order), so it asks for a reload. */
export const matchesView = (item: InboxItem, view: InboxView): boolean | 'ask' =>
  view === 'all' ? true : view === 'assigned' ? 'ask' : VIEW_KIND[view] === item.kind;

/** What the subject is called on a row: "Order #12", "Customer #4". */
export function subjectLabel(s: InboxSubject): string {
  switch (s.type) {
    case 'order': return `Order ${formatOrderNumber(s.id)}`;
    case 'customer': return `Customer #${s.id}`;
    case 'payout': return `Payout #${s.id}`;
    case 'product': return `Product #${s.id}`;
    case 'conversation': return `Conversation #${s.id}`;
    case 'workflow': return `Workflow #${s.id}`;
    case 'connection': return 'Connection';
    default: return `${s.type} #${s.id}`;
  }
}

/** Where "Open" goes in the admin app. */
export function adminLink(s: InboxSubject): string | null {
  switch (s.type) {
    case 'order': return `/orders/${s.id}`;
    case 'customer': return `/customers/${s.id}`;
    case 'payout': return '/finance';
    case 'product': return '/products';
    case 'conversation': return '/messages?tab=conversations';
    case 'workflow': return `/workflows/${s.id}`;
    case 'connection': return '/connections';
    default: return null;
  }
}

/** The rep app has a screen for an order (the call card). A conversation opens the chat panel instead of a page. */
export const repLink = (s: InboxSubject): string | null => (s.type === 'order' ? `/rep/call/${s.id}` : null);

export interface SnoozeChoice { label: string; at: Date }

/** Snooze choices that are still in the future (the API refuses a time that has passed). */
export function snoozeChoices(now: Date = new Date()): SnoozeChoice[] {
  const at = (d: Date, h: number) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
  const inOneHour = new Date(now.getTime() + 3_600_000);
  const tonight = at(now, 18);
  const tomorrow = at(new Date(now.getTime() + 86_400_000), 9);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7));
  const list: SnoozeChoice[] = [
    { label: 'In 1 hour', at: inOneHour },
    { label: 'This evening, 18:00', at: tonight },
    { label: 'Tomorrow, 09:00', at: tomorrow },
    { label: 'Next Monday, 09:00', at: at(monday, 9) },
  ];
  return list.filter((c) => c.at.getTime() > now.getTime() + 60_000);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** `YYYY-MM-DD` in the viewer's own zone. */
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The moment a date and a time field name, or null when either is empty. */
export function dueAtOf(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}
