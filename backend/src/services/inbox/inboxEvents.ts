import { NotificationKind, UserRole } from '@prisma/client';

/**
 * The one list of inbox events (M9-T16). `notify` only accepts names from this file.
 * The stored `Notification.type` is the event name.
 */
export const CHANNELS = ['inApp', 'email', 'sms', 'whatsapp'] as const;
export type InboxChannel = (typeof CHANNELS)[number];
export type ChannelSet = Record<InboxChannel, boolean>;

export interface InboxEventDef {
  name: string;
  /** Name shown in the preference screens. */
  label: string;
  kind: NotificationKind;
  /** Channels when nobody (person or role default) has chosen. */
  defaults: ChannelSet;
  /** Per-role defaults that replace `defaults` for that role. */
  roleDefaults?: Partial<Record<UserRole, ChannelSet>>;
  /** The owner (admin, super_admin) may not turn in-app off. */
  ownerInAppRequired?: boolean;
}

const IN_APP: ChannelSet = { inApp: true, email: false, sms: false, whatsapp: false };
const IN_APP_EMAIL: ChannelSet = { inApp: true, email: true, sms: false, whatsapp: false };

const def = (name: string, label: string, kind: NotificationKind, rest: Partial<Omit<InboxEventDef, 'name' | 'label' | 'kind'>> = {}): InboxEventDef =>
  ({ name, label, kind, defaults: IN_APP, ...rest });

const LIST: InboxEventDef[] = [
  def('customer_reply', 'A customer replied', 'reply'),
  def('mention', 'Someone mentioned you', 'mention'),
  def('reminder_due', 'A reminder is due', 'reminder'),
  def('team_note', 'A team note on your work', 'note'),
  def('order_assigned', 'An order was assigned to you', 'alert'),
  def('late_callback', 'A call-back is late', 'alert'),
  def('overdue_collections', 'Agents have overdue collections', 'alert'),
  def('queue_wait', 'An order waits too long in the call queue', 'alert'),
  def('no_assignee_available', 'Nobody is available to take new orders', 'alert'),
  def('agent_blocked', 'An agent account was blocked', 'alert'),
  def('agent_unblocked', 'An agent account was unblocked', 'alert'),
  def('stock_incoming', 'Stock is on its way to you', 'alert'),
  def('payout_paid', 'A payout was paid', 'alert'),
  def('delivery_rescheduled', 'A delivery was rescheduled', 'alert'),
  def('system_problem', 'A connection or job problem', 'system', {
    roleDefaults: { admin: IN_APP_EMAIL, super_admin: IN_APP_EMAIL },
    ownerInAppRequired: true,
  }),
  def('workflow_failed', 'A workflow failed', 'alert'),
  def('connection_error', 'A connection stopped working', 'system'),
  def('finding_assigned', 'A Finding was assigned to you', 'alert'),
  def('target_returned', 'A target went back to the role pool', 'alert'),
];

export const INBOX_EVENTS: Readonly<Record<string, InboxEventDef>> = Object.freeze(
  Object.fromEntries(LIST.map((e) => [e.name, e])),
);
export type InboxEventName = string;

export const INBOX_EVENT_NAMES = LIST.map((e) => e.name);

/** Roles that count as the tenant owner (the same rule as `findTenantAdmins`). */
export const OWNER_ROLES: readonly UserRole[] = ['admin', 'super_admin'];

export function getEventDef(name: string): InboxEventDef {
  const found = INBOX_EVENTS[name];
  if (!found) throw new Error(`Unknown inbox event: ${name}`);
  return found;
}

/** The event's own default for one role (no database involved). */
export function eventDefaultFor(event: InboxEventDef, role: UserRole): ChannelSet {
  return event.roleDefaults?.[role] ?? event.defaults;
}

export const isOwnerRole = (role: UserRole): boolean => OWNER_ROLES.includes(role);
