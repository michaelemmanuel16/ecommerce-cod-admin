import { NotificationKind, UserRole } from '@prisma/client';

/**
 * The one list of inbox events (M9-T16). `notify` only accepts names from this file.
 * The stored `Notification.type` is the event name.
 */
export const CHANNELS = ['inApp', 'email'] as const;
export type InboxChannel = (typeof CHANNELS)[number];
export type ChannelSet = Record<InboxChannel, boolean>;

export interface InboxEventDef {
  name: string;
  /** Name shown in the preference screens. */
  label: string;
  kind: NotificationKind;
  /** Heading the settings page lists the event under. */
  group: string;
  /** The roles the code can send this event to. The settings screens show the event only to these roles. */
  roles: readonly UserRole[];
  /** Channels when nobody (person or role default) has chosen. */
  defaults: ChannelSet;
  /** Per-role defaults that replace `defaults` for that role. */
  roleDefaults?: Partial<Record<UserRole, ChannelSet>>;
  /** The owner (admin, super_admin) may not turn in-app off. */
  ownerInAppRequired?: boolean;
}

const IN_APP: ChannelSet = { inApp: true, email: false };
const IN_APP_EMAIL: ChannelSet = { inApp: true, email: true };

/** Group headings, in the order the settings page shows them. */
export const EVENT_GROUPS = ['Conversations', 'Orders and calls', 'Delivery and money', 'Team', 'System'] as const;

const ALL_ROLES: readonly UserRole[] = ['super_admin', 'admin', 'manager', 'sales_rep', 'inventory_manager', 'delivery_agent', 'accountant'];
const OWNERS: readonly UserRole[] = ['admin', 'super_admin'];
const MANAGEMENT: readonly UserRole[] = ['manager', 'admin', 'super_admin'];
const REPS_AND_UP: readonly UserRole[] = ['sales_rep', 'manager', 'admin', 'super_admin'];

type Rest = Partial<Pick<InboxEventDef, 'roleDefaults' | 'ownerInAppRequired'>>;
const def = (group: string, roles: readonly UserRole[], name: string, label: string, kind: NotificationKind, rest: Rest = {}): InboxEventDef =>
  ({ name, label, kind, group, roles, defaults: IN_APP, ...rest });

// Each `roles` list is what the call sites of `notify` can reach (checked against the code, not the wish list).
const LIST: InboxEventDef[] = [
  def('Conversations', REPS_AND_UP, 'customer_reply', 'A customer replied', 'reply'),
  def('Conversations', REPS_AND_UP, 'conversation_assigned', 'A conversation was assigned to you', 'reply'),
  def('Conversations', ALL_ROLES, 'mention', 'Someone mentioned you', 'mention'),
  def('Conversations', ALL_ROLES, 'team_note', 'A team note on your work', 'note'),
  def('Orders and calls', ['sales_rep', 'delivery_agent'], 'order_assigned', 'An order was assigned to you', 'alert'),
  def('Orders and calls', REPS_AND_UP, 'late_callback', 'A call-back is late', 'alert'),
  def('Orders and calls', ALL_ROLES, 'reminder_due', 'A reminder is due', 'reminder'),
  def('Orders and calls', MANAGEMENT, 'queue_wait', 'An order waits too long in the call queue', 'alert'),
  def('Orders and calls', OWNERS, 'no_assignee_available', 'Nobody is available to take new orders', 'alert'),
  def('Delivery and money', ['delivery_agent'], 'stock_incoming', 'Stock is on its way to you', 'alert'),
  def('Delivery and money', ['sales_rep', 'delivery_agent'], 'payout_paid', 'A payout was paid', 'alert'),
  def('Delivery and money', ['delivery_agent'], 'delivery_rescheduled', 'A delivery was rescheduled', 'alert'),
  def('Delivery and money', OWNERS, 'overdue_collections', 'Agents have overdue collections', 'alert'),
  // The name stays `agent_blocked` (stored preferences use it); the unblock notice is sent under the same name.
  def('Team', ['delivery_agent'], 'agent_blocked', 'Your account was blocked or unblocked', 'alert'),
  def('Team', ALL_ROLES, 'finding_assigned', 'A Finding was assigned to you', 'alert'),
  def('Team', MANAGEMENT, 'target_returned', 'A target went back to the role pool', 'alert'),
  def('System', OWNERS, 'system_problem', 'A connection or job problem', 'system', {
    roleDefaults: { admin: IN_APP_EMAIL, super_admin: IN_APP_EMAIL },
    ownerInAppRequired: true,
  }),
];

export const INBOX_EVENTS: Readonly<Record<string, InboxEventDef>> = Object.freeze(
  Object.fromEntries(LIST.map((e) => [e.name, e])),
);

export const INBOX_EVENT_NAMES = Object.keys(INBOX_EVENTS);

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

/** Does the event reach this role? The settings screens list only these. */
export const eventReachesRole = (event: InboxEventDef, role: UserRole): boolean => event.roles.includes(role);
