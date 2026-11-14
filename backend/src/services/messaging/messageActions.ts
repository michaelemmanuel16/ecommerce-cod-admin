import { MessageChannel, MessageDirection, MessageStatus, UserRole } from '@prisma/client';
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

/** Send the same message again on the same channel. New row with `retryOfId`. */
export async function retryMessage(id: number, actor: Actor): Promise<SendMessageResult> {
  const log = await loadForActor(id, actor);

  const retryable = log.status === MessageStatus.failed
    || (log.status === MessageStatus.skipped && log.errorMessage === 'provider_disabled');
  if (!retryable) throw new AppError('Only a message that failed can be retried', 409, 'MESSAGE_NOT_RETRYABLE');
  if (optedOut(log.channel, log.customer)) throw new AppError('The customer opted out of this channel', 409, 'CUSTOMER_OPTED_OUT');

  const to = recipientOf(log);
  if (!to) throw new AppError('This message has no recipient to send to', 400, 'NO_RECIPIENT');

  const meta = (log.metadata ?? {}) as Record<string, any>;
  const isTemplate = log.channel === MessageChannel.whatsapp && !!log.templateName && Array.isArray(meta.bodyParams);

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
  });
}

/** Send the body of a message as an SMS. New row with `fallbackOfId`. */
export async function resendAsSms(id: number, actor: Actor): Promise<SendMessageResult> {
  const log = await loadForActor(id, actor);

  if (log.channel === MessageChannel.email) throw new AppError('An email cannot be sent as an SMS', 400, 'MESSAGE_IS_EMAIL');
  if (!log.messageBody) throw new AppError('This message has no text to send', 400, 'NO_BODY');
  if (optedOut(MessageChannel.sms, log.customer)) throw new AppError('The customer opted out of SMS', 409, 'CUSTOMER_OPTED_OUT');

  const to = recipientOf(log);
  if (!to) throw new AppError('This message has no recipient to send to', 400, 'NO_RECIPIENT');

  return messageSender.send({
    tenantId: log.tenantId ?? getTenantId(),
    channel: MessageChannel.sms,
    to: formatPhoneNumber(to),
    body: log.messageBody,
    orderId: log.orderId,
    customerId: log.customerId,
    fallbackOfId: log.id,
  });
}
