import { Notification, UserRole } from '@prisma/client';
import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { runInTenant } from '../../utils/tenantContext';
import { getSocketInstance } from '../../utils/socketInstance';
import { emitNotification } from '../../sockets';
import { HUMAN_USERS_WHERE } from '../systemUserService';
import { sendEmail } from '../emailService';
import { smsService } from '../smsService';
import { whatsappService } from '../whatsappService';
import { ChannelSet, InboxEventName, getEventDef, isOwnerRole } from './inboxEvents';
import { getTenantChannels } from './inboxChannels';
import { resolveChannelsFor } from './inboxPreferences';

/** Admins of the current tenant only (the scoped query adds tenantId); not the system user. The owner rule of the inbox. */
export const findTenantAdmins = () => prisma.user.findMany({
  where: { role: { in: ['admin', 'super_admin'] }, isActive: true, ...HUMAN_USERS_WHERE },
  select: { id: true },
});

export interface NotifyInput {
  tenantId: string;
  event: InboxEventName;
  /** Overrides the event's default kind. */
  kind?: Notification['kind'];
  /** What the row is about: the UI links to it. */
  subject?: { type: string; id: number };
  /** Person ids, or 'owner' for the tenant admins. An empty list, or only deactivated people, goes to the owner. */
  recipients: number[] | 'owner';
  /** The person who did it. Never notified about their own action. */
  actorId?: number | null;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  /** Update the person's unread row of this event instead of adding a copy (a daily job). */
  refreshUnread?: boolean;
}

interface Person { id: number; role: UserRole; email: string; phoneNumber: string | null }
const PERSON_SELECT = { id: true, role: true, email: true, phoneNumber: true } as const;

async function resolveRecipients(recipients: number[] | 'owner', actorId: number | null): Promise<Person[]> {
  const ids = recipients === 'owner' ? [] : [...new Set(recipients)];
  const named = ids.filter((id) => id !== actorId);
  // Only the actor was named: nobody else to tell, and no owner fallback.
  if (ids.length > 0 && named.length === 0) return [];

  const active = named.length > 0
    ? await prisma.user.findMany({ where: { id: { in: named }, isActive: true, ...HUMAN_USERS_WHERE }, select: PERSON_SELECT })
    : [];
  if (active.length > 0) return active;

  const ownerIds = (await findTenantAdmins()).map((a) => a.id).filter((id) => id !== actorId);
  if (ownerIds.length === 0) return [];
  return prisma.user.findMany({ where: { id: { in: ownerIds } }, select: PERSON_SELECT });
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Send the external copies. Each failure is logged and never reaches the caller. */
async function sendExternal(person: Person, channels: ChannelSet, input: NotifyInput, available: Awaited<ReturnType<typeof getTenantChannels>>): Promise<void> {
  const text = `${input.title}: ${input.message}`;
  const jobs: Array<[string, () => Promise<unknown>]> = [];
  if (channels.email && available.email.available && person.email) {
    jobs.push(['email', () => sendEmail({ to: person.email, subject: input.title, html: `<p>${escapeHtml(input.message)}</p>` })]);
  }
  if (channels.sms && available.sms.available && person.phoneNumber) {
    jobs.push(['sms', () => smsService.sendSms({ to: person.phoneNumber!, body: text })]);
  }
  if (channels.whatsapp && available.whatsapp.available && person.phoneNumber) {
    jobs.push(['whatsapp', () => whatsappService.sendText({ to: person.phoneNumber!, body: text })]);
  }
  await Promise.all(jobs.map(async ([channel, send]) => {
    try {
      await send();
    } catch (error) {
      logger.warn('Inbox: external notification failed', {
        event: input.event, userId: person.id, channel, error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
}

async function writeRow(person: Person, input: NotifyInput, kind: Notification['kind']): Promise<Notification> {
  const data = input.data ?? {};
  if (input.refreshUnread) {
    const unread = await prisma.notification.findFirst({
      where: { userId: person.id, type: input.event, isRead: false, doneAt: null },
      select: { id: true },
    });
    if (unread) {
      return prisma.notification.update({
        where: { id: unread.id },
        data: {
          title: input.title, message: input.message, data: data as object, createdAt: new Date(),
          subjectType: input.subject?.type ?? null, subjectId: input.subject?.id ?? null,
        },
      });
    }
  }
  return prisma.notification.create({
    data: {
      tenantId: input.tenantId,
      userId: person.id,
      type: input.event,
      kind,
      title: input.title,
      message: input.message,
      data: data as object,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      actorId: input.actorId ?? null,
    },
  });
}

/**
 * The one way to tell a person something (M9-T16). The in-app row is written first and is never undone by an
 * external failure. Email, SMS and WhatsApp follow each person's choice: person, else role default, else event default.
 * Returns the in-app rows written.
 */
export async function notify(input: NotifyInput): Promise<Notification[]> {
  const event = getEventDef(input.event);
  const kind = input.kind ?? event.kind;
  return runInTenant(input.tenantId, async () => {
    const people = await resolveRecipients(input.recipients, input.actorId ?? null);
    if (people.length === 0) return [];
    const resolved = await resolveChannelsFor(people, input.event);
    const rows: Notification[] = [];
    const external: Person[] = [];

    for (const person of people) {
      const channels = resolved.get(person.id)!.channels;
      if (channels.inApp || (event.ownerInAppRequired && isOwnerRole(person.role))) {
        const row = await writeRow(person, input, kind);
        rows.push(row);
        emitNotification(getSocketInstance() as any, String(person.id), row);
      }
      if (channels.email || channels.sms || channels.whatsapp) external.push(person);
    }

    if (external.length > 0) {
      try {
        const available = await getTenantChannels();
        await Promise.all(external.map((p) => sendExternal(p, resolved.get(p.id)!.channels, input, available)));
      } catch (error) {
        logger.warn('Inbox: external channels failed', { event: input.event, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return rows;
  });
}
