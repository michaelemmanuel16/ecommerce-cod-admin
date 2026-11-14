import { MessageChannel, MessageDirection, MessageStatus, Prisma, UserRole } from '@prisma/client';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { getTenantId } from '../../utils/tenantContext';
import { formatPhoneNumber } from '../whatsappService';
import { messageSender, SendMessageResult } from './messageSender';

interface Actor {
  id: number;
  role: UserRole;
}

const STAFF_ROLES: UserRole[] = ['super_admin', 'admin', 'manager'];

/**
 * Load a message of this tenant. A message of another tenant is a 404, like a missing one.
 * Allowed: owner, admin, manager, and the sales rep of the message's order.
 */
async function loadForActor(id: number, actor: Actor) {
  const log = await prisma.messageLog.findFirst({
    where: { id },
    include: { customer: { select: { phoneNumber: true, smsOptOut: true, whatsappOptOut: true, emailOptOut: true } } },
  });
  if (!log) throw new AppError('Message not found', 404, 'MESSAGE_NOT_FOUND');

  if (!STAFF_ROLES.includes(actor.role)) {
    let allowed = false;
    if (actor.role === 'sales_rep' && log.orderId) {
      const order = await prisma.order.findFirst({ where: { id: log.orderId }, select: { customerRepId: true } });
      allowed = order?.customerRepId === actor.id;
    }
    if (!allowed) throw new AppError('You cannot act on this message', 403, 'MESSAGE_FORBIDDEN');
  }
  if (log.direction !== MessageDirection.outbound) {
    throw new AppError('Only messages we sent can be sent again', 400, 'MESSAGE_NOT_OUTBOUND');
  }
  return log;
}

function recipientOf(log: { metadata: unknown; customer: { phoneNumber: string } | null }): string | null {
  const to = (log.metadata as { to?: string } | null)?.to;
  return to || log.customer?.phoneNumber || null;
}

function optedOut(channel: MessageChannel, c: { smsOptOut: boolean; whatsappOptOut: boolean; emailOptOut: boolean } | null): boolean {
  if (!c) return false;
  if (channel === MessageChannel.sms) return c.smsOptOut;
  if (channel === MessageChannel.whatsapp) return c.whatsappOptOut;
  return c.emailOptOut;
}

/** One total limit of extra sends (retries and SMS resends together) for one original message. */
export const MAX_EXTRA_SENDS_PER_MESSAGE = 3;
/** A `sent` WhatsApp message with no delivery report after this long may be sent again as an SMS. */
export const RESEND_AFTER_MS = 10 * 60 * 1000;
const LIVE_STATUSES: MessageStatus[] = [MessageStatus.pending, MessageStatus.sent, MessageStatus.delivered, MessageStatus.read];

type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, 'messageLog'>;

/** The original message of a lineage: follow retryOfId and fallbackOfId back to a row that has neither. */
async function lineageRoot(id: number): Promise<number> {
  let current = id;
  for (let i = 0; i < 50; i++) {
    const row = await prisma.messageLog.findFirst({ where: { id: current }, select: { retryOfId: true, fallbackOfId: true } });
    const parent = row?.retryOfId ?? row?.fallbackOfId;
    if (!parent) return current;
    current = parent;
  }
  return current;
}

/** How many extra sends (retries and resends, any status) the lineage that starts at `rootId` has. */
async function extraSendsInLineage(db: Db, rootId: number): Promise<number> {
  let frontier = [rootId];
  let count = 0;
  while (frontier.length > 0 && count < 100) {
    const next = await db.messageLog.findMany({
      where: { OR: [{ retryOfId: { in: frontier } }, { fallbackOfId: { in: frontier } }] },
      select: { id: true },
    });
    count += next.length;
    frontier = next.map((r) => r.id);
  }
  return count;
}

const lock = (tx: Tx, key: number) => tx.$executeRaw`SELECT pg_advisory_xact_lock(7, ${key}::int)`;

/** Send the same message again on the same channel. New row with `retryOfId`. */
export async function retryMessage(id: number, actor: Actor): Promise<SendMessageResult> {
  const log = await loadForActor(id, actor);
  const root = await lineageRoot(id);

  const retryable = log.status === MessageStatus.failed
    || (log.status === MessageStatus.skipped && log.errorMessage === 'provider_disabled');
  if (!retryable) throw new AppError('Only a message that failed can be retried', 409, 'MESSAGE_NOT_RETRYABLE');
  if (optedOut(log.channel, log.customer)) throw new AppError('The customer opted out of this channel', 409, 'CUSTOMER_OPTED_OUT');

  const to = recipientOf(log);
  if (!to) throw new AppError('This message has no recipient to send to', 400, 'NO_RECIPIENT');

  const meta = (log.metadata ?? {}) as Record<string, any>;
  const isTemplate = log.channel === MessageChannel.whatsapp && !!log.templateName && Array.isArray(meta.bodyParams);

  // Lock the lineage, check the gates and write the pending row in one short transaction; the provider is called after it
  const gate = async (tx: Tx) => {
    await lock(tx, root);
    const live = await tx.messageLog.findFirst({ where: { retryOfId: log.id, status: { in: LIVE_STATUSES } }, select: { id: true } });
    if (live) throw new AppError('This message was already retried', 409, 'MESSAGE_ALREADY_RETRIED');
    if ((await extraSendsInLineage(tx, root)) >= MAX_EXTRA_SENDS_PER_MESSAGE) {
      throw new AppError(`A message can be sent again ${MAX_EXTRA_SENDS_PER_MESSAGE} times`, 409, 'MESSAGE_RETRY_LIMIT');
    }
  };

  return messageSender.send({
    tenantId: log.tenantId ?? getTenantId(),
    channel: log.channel,
    to,
    ...(isTemplate
      ? {
        template: {
          name: log.templateName!,
          languageCode: meta.languageCode,
          bodyParams: meta.bodyParams,
          headerParams: meta.headerParams,
          buttonPayloads: meta.buttonPayloads,
        },
      }
      : { body: log.messageBody }),
    logBody: log.messageBody,
    templateName: log.templateName ?? undefined,
    subject: meta.subject,
    sendAs: meta.sendAs,
    orderId: log.orderId,
    customerId: log.customerId,
    conversationId: log.conversationId,
    inReplyToId: log.inReplyToId,
    retryOfId: log.id,
    metadata: isTemplate
      ? { bodyParams: meta.bodyParams, headerParams: meta.headerParams, buttonPayloads: meta.buttonPayloads, languageCode: meta.languageCode }
      : { subject: meta.subject, sendAs: meta.sendAs },
  }, gate);
}

/** Send the body of a message as an SMS. New row with `fallbackOfId`. */
export async function resendAsSms(id: number, actor: Actor): Promise<SendMessageResult> {
  const log = await loadForActor(id, actor);
  const root = await lineageRoot(id);

  if (log.channel === MessageChannel.email) throw new AppError('An email cannot be sent as an SMS', 400, 'MESSAGE_IS_EMAIL');
  if (log.channel === MessageChannel.sms || log.fallbackOfId) {
    throw new AppError('This message is already an SMS', 409, 'MESSAGE_ALREADY_SMS');
  }
  if (!log.messageBody) throw new AppError('This message has no text to send', 400, 'NO_BODY');
  const stuck = log.status === MessageStatus.sent && !log.deliveredAt
    && Date.now() - (log.sentAt ?? log.createdAt).getTime() >= RESEND_AFTER_MS;
  if (log.status !== MessageStatus.failed && log.status !== MessageStatus.skipped && !stuck) {
    throw new AppError('Only a failed, skipped or undelivered message can be sent as an SMS', 409, 'MESSAGE_NOT_RESENDABLE');
  }
  if (optedOut(MessageChannel.sms, log.customer)) throw new AppError('The customer opted out of SMS', 409, 'CUSTOMER_OPTED_OUT');

  const to = recipientOf(log);
  if (!to) throw new AppError('This message has no recipient to send to', 400, 'NO_RECIPIENT');

  const gate = async (tx: Tx) => {
    await lock(tx, root);
    const already = await tx.messageLog.findFirst({ where: { fallbackOfId: log.id, status: { not: MessageStatus.failed } }, select: { id: true } });
    if (already) throw new AppError('This message was already sent as an SMS', 409, 'MESSAGE_ALREADY_RESENT');
    if ((await extraSendsInLineage(tx, root)) >= MAX_EXTRA_SENDS_PER_MESSAGE) {
      throw new AppError(`A message can be sent again ${MAX_EXTRA_SENDS_PER_MESSAGE} times`, 409, 'MESSAGE_RETRY_LIMIT');
    }
  };

  return messageSender.send({
    tenantId: log.tenantId ?? getTenantId(),
    channel: MessageChannel.sms,
    to: formatPhoneNumber(to),
    body: log.messageBody,
    orderId: log.orderId,
    customerId: log.customerId,
    fallbackOfId: log.id,
  }, gate);
}
