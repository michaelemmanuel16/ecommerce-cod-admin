import { MessageLog, Prisma } from '@prisma/client';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { Requester } from '../../utils/authUtils';
import { assertSubjectVisible } from '../inbox/subjectAccess';

/**
 * M9-T14 (F-464): the messages of one order or one customer, newest first, with status, time and a body preview.
 * Inbound replies are included: a reply points at the message it answers through `inReplyToId`.
 * Access is the order and customer access the rest of the API uses (assertSubjectVisible).
 */
const LIMIT = 200;
const PREVIEW_CHARS = 140;

const preview = (body: string): string => (body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS).trimEnd()}...` : body);

const toItem = (m: Pick<MessageLog, 'id' | 'channel' | 'direction' | 'status' | 'messageBody' | 'inReplyToId' | 'createdAt' | 'sentAt' | 'errorMessage'>) => ({
  id: m.id,
  channel: m.channel,
  direction: m.direction,
  status: m.status,
  at: m.sentAt ?? m.createdAt,
  bodyPreview: preview(m.messageBody),
  inReplyToId: m.inReplyToId,
  errorMessage: m.errorMessage,
});

const SELECT = { id: true, channel: true, direction: true, status: true, messageBody: true, inReplyToId: true, createdAt: true, sentAt: true, errorMessage: true } satisfies Prisma.MessageLogSelect;

export async function orderMessages(orderId: number, user: Requester) {
  await assertSubjectVisible('order', orderId, user);
  const outbound = await prisma.messageLog.findMany({ where: { orderId }, select: { id: true } });
  const rows = await prisma.messageLog.findMany({
    where: { OR: [{ orderId }, { inReplyToId: { in: outbound.map((m) => m.id) } }] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LIMIT,
    select: SELECT,
  });
  return { items: rows.map(toItem) };
}

export async function customerMessages(customerId: number, user: Requester) {
  await assertSubjectVisible('customer', customerId, user);
  const customer = await prisma.customer.findFirst({
    where: { id: customerId },
    select: { whatsappOptOut: true, smsOptOut: true, emailOptOut: true },
  });
  // The subject check passed, so the customer exists; guard anyway for a race with a delete
  if (!customer) throw new AppError('Customer not found', 404);
  // Rule: a rep who can see the customer (assertSubjectVisible above) sees every message to that customer, also
  // those about other reps' orders. This matches conversationService.visibilityWhere: a rep who sees the customer's
  // conversation already sees every message to that phone. Do not narrow this to the rep's own orders.
  const rows = await prisma.messageLog.findMany({
    where: { customerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LIMIT,
    select: SELECT,
  });
  return {
    items: rows.map(toItem),
    // M9: use optOutService.isOptedOut after lane A merges
    optOut: { whatsapp: customer.whatsappOptOut, sms: customer.smsOptOut, email: customer.emailOptOut },
  };
}
