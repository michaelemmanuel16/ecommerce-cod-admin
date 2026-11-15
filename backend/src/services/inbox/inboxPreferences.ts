import { UserRole } from '@prisma/client';
import prisma from '../../utils/prisma';
import { resolveTenantId } from '../../utils/tenantContext';
import { AppError } from '../../middleware/errorHandler';
import { CHANNELS, ChannelSet, INBOX_EVENTS, InboxEventDef, eventDefaultFor, getEventDef, isOwnerRole } from './inboxEvents';
import { TenantChannels, getTenantChannels } from './inboxChannels';

type ChannelRow = { inApp: boolean; email: boolean; sms: boolean; whatsapp: boolean };
const pick = (r: ChannelRow): ChannelSet => ({ inApp: r.inApp, email: r.email, sms: r.sms, whatsapp: r.whatsapp });

export type ChannelSource = 'person' | 'role' | 'default';
export interface ResolvedChannels { channels: ChannelSet; source: ChannelSource }

/** What owners cannot turn off (F-1228): the in-app copy of an owner-required event. */
function enforceOwnerRequired(event: InboxEventDef, role: UserRole, channels: ChannelSet): ChannelSet {
  return event.ownerInAppRequired && isOwnerRole(role) ? { ...channels, inApp: true } : channels;
}

/**
 * Channels for several people for one event. Order: the person's own choice, then the tenant's role default,
 * then the event's own default for the role. Two queries for any number of people.
 */
export async function resolveChannelsFor(
  people: { id: number; role: UserRole }[],
  eventName: string,
): Promise<Map<number, ResolvedChannels>> {
  const event = getEventDef(eventName);
  const out = new Map<number, ResolvedChannels>();
  if (people.length === 0) return out;
  const [prefs, roleRows] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { event: eventName, userId: { in: people.map((p) => p.id) } } }),
    prisma.roleNotificationDefault.findMany({ where: { event: eventName, role: { in: [...new Set(people.map((p) => p.role))] } } }),
  ]);
  const prefBy = new Map(prefs.map((p) => [p.userId, p]));
  const roleBy = new Map(roleRows.map((r) => [r.role, r]));
  for (const person of people) {
    const pref = prefBy.get(person.id);
    const roleRow = roleBy.get(person.role);
    const resolved: ResolvedChannels = pref
      ? { channels: pick(pref), source: 'person' }
      : roleRow
        ? { channels: pick(roleRow), source: 'role' }
        : { channels: eventDefaultFor(event, person.role), source: 'default' };
    out.set(person.id, { ...resolved, channels: enforceOwnerRequired(event, person.role, resolved.channels) });
  }
  return out;
}

interface ChannelView { enabled: boolean; available: boolean; hint?: string; locked?: boolean }
export interface PreferenceRow {
  event: string;
  label: string;
  kind: string;
  source: ChannelSource;
  channels: Record<(typeof CHANNELS)[number], ChannelView>;
}

function view(event: InboxEventDef, role: UserRole, resolved: ResolvedChannels, available: TenantChannels): PreferenceRow {
  const channels = {} as PreferenceRow['channels'];
  for (const ch of CHANNELS) {
    const a = available[ch];
    channels[ch] = {
      enabled: resolved.channels[ch],
      available: a.available,
      ...(a.hint ? { hint: a.hint } : {}),
      ...(ch === 'inApp' && event.ownerInAppRequired && isOwnerRole(role) ? { locked: true } : {}),
    };
  }
  return { event: event.name, label: event.label, kind: event.kind, source: resolved.source, channels };
}

/** GET /preferences: every event with the person's merged channels. */
export async function getMyPreferences(user: { id: number; role: UserRole }): Promise<PreferenceRow[]> {
  const available = await getTenantChannels();
  const events = Object.values(INBOX_EVENTS);
  const [prefs, roleRows] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { userId: user.id } }),
    prisma.roleNotificationDefault.findMany({ where: { role: user.role } }),
  ]);
  const prefBy = new Map(prefs.map((p) => [p.event, p]));
  const roleBy = new Map(roleRows.map((r) => [r.event, r]));
  return events.map((event) => {
    const pref = prefBy.get(event.name);
    const roleRow = roleBy.get(event.name);
    const resolved: ResolvedChannels = pref
      ? { channels: pick(pref), source: 'person' }
      : roleRow
        ? { channels: pick(roleRow), source: 'role' }
        : { channels: eventDefaultFor(event, user.role), source: 'default' };
    return view(event, user.role, { ...resolved, channels: enforceOwnerRequired(event, user.role, resolved.channels) }, available);
  });
}

export type PreferenceInput = { event: string; inApp?: boolean; email?: boolean; sms?: boolean; whatsapp?: boolean };

function assertKnownAndAllowed(role: UserRole, items: PreferenceInput[]): void {
  for (const item of items) {
    const event = INBOX_EVENTS[item.event];
    if (!event) throw new AppError(`Unknown event: ${item.event}`, 400);
    if (event.ownerInAppRequired && isOwnerRole(role) && item.inApp === false) {
      throw new AppError(`${event.label}: the owner cannot turn off in-app notifications for this event`, 400, 'OWNER_IN_APP_REQUIRED');
    }
  }
}

/** PUT /preferences: save the person's choices. Channels left out keep the value they have now. */
export async function savePreferences(user: { id: number; role: UserRole }, items: PreferenceInput[]): Promise<PreferenceRow[]> {
  assertKnownAndAllowed(user.role, items);
  const current = await resolveCurrent(user, items.map((i) => i.event));
  const tenantId = resolveTenantId();
  await prisma.$transaction(items.map((item) => {
    const next = merge(current.get(item.event)!, item);
    return prisma.notificationPreference.upsert({
      where: { userId_event: { userId: user.id, event: item.event } },
      create: { tenantId, userId: user.id, event: item.event, ...next },
      update: next,
    });
  }));
  return getMyPreferences(user);
}

async function resolveCurrent(user: { id: number; role: UserRole }, events: string[]): Promise<Map<string, ChannelSet>> {
  const all = await getMyPreferences(user);
  return new Map(all.filter((r) => events.includes(r.event)).map((r) => [r.event, {
    inApp: r.channels.inApp.enabled, email: r.channels.email.enabled, sms: r.channels.sms.enabled, whatsapp: r.channels.whatsapp.enabled,
  }]));
}

const merge = (base: ChannelSet, item: PreferenceInput): ChannelSet => ({
  inApp: item.inApp ?? base.inApp,
  email: item.email ?? base.email,
  sms: item.sms ?? base.sms,
  whatsapp: item.whatsapp ?? base.whatsapp,
});

/** GET /role-defaults?role=: the tenant's defaults for one role (or every role) merged with the event defaults. */
export async function getRoleDefaults(role?: UserRole): Promise<{ role: UserRole; defaults: PreferenceRow[] }[]> {
  const available = await getTenantChannels();
  const rows = await prisma.roleNotificationDefault.findMany({ where: role ? { role } : {} });
  const roles = role ? [role] : Object.values(UserRole);
  return roles.map((r) => ({
    role: r,
    defaults: Object.values(INBOX_EVENTS).map((event) => {
      const row = rows.find((x) => x.role === r && x.event === event.name);
      const resolved: ResolvedChannels = row
        ? { channels: pick(row), source: 'role' }
        : { channels: eventDefaultFor(event, r), source: 'default' };
      return view(event, r, { ...resolved, channels: enforceOwnerRequired(event, r, resolved.channels) }, available);
    }),
  }));
}

/** PUT /role-defaults: save the tenant's default channels for one role. */
export async function saveRoleDefaults(role: UserRole, items: PreferenceInput[]) {
  assertKnownAndAllowed(role, items);
  const tenantId = resolveTenantId();
  const existing = await prisma.roleNotificationDefault.findMany({ where: { role, event: { in: items.map((i) => i.event) } } });
  for (const item of items) {
    const event = getEventDef(item.event);
    const row = existing.find((e) => e.event === item.event);
    const next = merge(row ? pick(row) : eventDefaultFor(event, role), item);
    await prisma.roleNotificationDefault.upsert({
      where: { tenantId_role_event: { tenantId, role, event: item.event } },
      create: { tenantId, role, event: item.event, ...next },
      update: next,
    });
  }
  return getRoleDefaults(role);
}
