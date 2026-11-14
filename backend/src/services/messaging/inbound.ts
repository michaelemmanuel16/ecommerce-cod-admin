import { Conversation, MessageChannel, MessageDirection, MessageStatus, OrderStatus } from '@prisma/client';
import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import whatsappService from '../whatsappService';
import orderService from '../orderService';
import { normalizeInternationalPhone, phoneLookupVariants } from '../../utils/phone';
import { CallbackRequest, ParsedInbound } from './types';
import { whatsappCloudProvider } from './providers';
import { notifyCustomerReply } from './replyNotify';
import { setOptOut } from './optOutService';

const PAYLOAD_KIND = { CONFIRM: 'yes', CHANGE: 'change', CANCEL: 'cancel' } as const;

/** Reply text per response kind. A kind with no entry (typed "no") gets no reply. */
const REPLY_TEXT: Record<string, ((firstName: string, orderId: number) => string) | undefined> = {
  yes: (name, id) => `Thank you, ${name}. Your order #${id} is confirmed. We will send it out for delivery.`,
  change: (name) => `Thank you, ${name}. One of our team will call you soon to make the change.`,
  cancel: (name) => `Thank you, ${name}. One of our team will call you shortly about your order.`,
};

const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop all']);
const START_WORDS = new Set(['start']);
const CLOSED_ORDER_STATUSES: OrderStatus[] = ['delivered', 'digital_delivered', 'returned', 'cancelled'];
const REPLY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Trim, drop leading and trailing punctuation, lower-case: "YES.", "Stop!" */
const clean = (text: string) => text.trim().replace(/^[\s.,!?;:"'()]+|[\s.,!?;:"'()]+$/g, '').toLowerCase();

/** E.164 as stored on Customer. */
export function conversationPhone(from: string): string {
  const digits = from.replace(/\D/g, '');
  return normalizeInternationalPhone(`+${digits}`) ?? `+${digits}`;
}

async function findCustomer(tenantId: string, fromPhone: string) {
  const rawNoPlus = fromPhone.replace(/^\+/, '');
  const rawPlus = `+${rawNoPlus}`;
  const variants = Array.from(new Set([
    fromPhone, rawNoPlus, rawPlus, ...phoneLookupVariants(fromPhone), ...phoneLookupVariants(rawPlus),
  ]));
  return prisma.customer.findFirst({
    where: { tenantId, OR: [{ phoneNumber: { in: variants } }, { alternatePhone: { in: variants } }] },
  });
}

/** Find or open the conversation of this number. Linked to the customer when one has the phone. */
async function findOrCreateConversation(tenantId: string, phone: string, customerId: number | null, at: Date): Promise<Conversation> {
  const where = { tenantId, channel: MessageChannel.whatsapp, phone };
  const found = await prisma.conversation.findFirst({ where });
  if (found) {
    if (!found.customerId && customerId) {
      return prisma.conversation.update({ where: { id: found.id }, data: { customerId } });
    }
    return found;
  }
  try {
    return await prisma.conversation.create({ data: { ...where, customerId, lastMessageAt: at } });
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err;
    return prisma.conversation.findFirstOrThrow({ where });
  }
}

/** The outbound message this one answers: the context id, else the latest outbound to that number in 7 days. */
async function findAnsweredMessage(tenantId: string, from: string, contextId: string | null | undefined) {
  if (contextId) {
    const byContext = await prisma.messageLog.findFirst({ where: { providerMessageId: contextId } });
    if (byContext) return byContext;
  }
  const digits = from.replace(/\D/g, '');
  return prisma.messageLog.findFirst({
    where: {
      tenantId,
      channel: MessageChannel.whatsapp,
      direction: MessageDirection.outbound,
      createdAt: { gte: new Date(Date.now() - REPLY_LOOKBACK_MS) },
      metadata: { path: ['to'], equals: digits },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** Who hears about a reply: the assignee, else the rep of the customer's latest open order, else the owner. */
async function replyRecipient(tenantId: string, conversation: Conversation): Promise<number | 'owner'> {
  if (conversation.assignedToId) return conversation.assignedToId;
  if (conversation.customerId) {
    const order = await prisma.order.findFirst({
      where: { tenantId, customerId: conversation.customerId, deletedAt: null, status: { notIn: CLOSED_ORDER_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: { customerRepId: true },
    });
    if (order?.customerRepId) return order.customerRepId;
  }
  return 'owner';
}

/** Everything one inbound WhatsApp message does. Idempotent by the provider message id. */
export async function processInboundMessage(tenantId: string, msg: ParsedInbound): Promise<void> {
  if (msg.providerMessageId) {
    const existing = await prisma.messageLog.findFirst({ where: { providerMessageId: msg.providerMessageId } });
    if (existing) {
      logger.info('Duplicate WhatsApp webhook message ignored', { messageId: msg.providerMessageId });
      return;
    }
  }

  const fromPhone = msg.from;
  const raw: any = msg.raw ?? {};
  let responseKind: 'yes' | 'change' | 'cancel' | 'no' | null = null;
  if (msg.buttonPayload) {
    responseKind = PAYLOAD_KIND[msg.buttonPayload as keyof typeof PAYLOAD_KIND] ?? null;
  }
  const trimmed = msg.text.trim();
  const cleanText = clean(msg.text);
  if (!responseKind) {
    if (cleanText === 'yes' || cleanText === 'y' || cleanText === 'confirm') responseKind = 'yes';
    else if (cleanText === 'no' || cleanText === 'n' || cleanText === 'cancel') responseKind = 'no';
  }

  const customer = fromPhone ? await findCustomer(tenantId, fromPhone) : null;

  // The message this one answers by its context id (it also names the order); else the latest outbound to the number
  const contextMessage = msg.contextMessageId
    ? await prisma.messageLog.findFirst({ where: { providerMessageId: msg.contextMessageId } })
    : null;
  const answeredMessage = contextMessage ?? await findAnsweredMessage(tenantId, fromPhone, null);
  const customerRecord = customer ?? (contextMessage?.customerId
    ? await prisma.customer.findFirst({ where: { tenantId, id: contextMessage.customerId } })
    : null);

  const phone = conversationPhone(fromPhone);
  const conversation = await findOrCreateConversation(tenantId, phone, customerRecord?.id ?? contextMessage?.customerId ?? null, msg.occurredAt);

  // Store first: create the MessageLog row before any order change. providerMessageId is unique.
  let createdLog: { id: number };
  try {
    createdLog = await prisma.messageLog.create({
      data: {
        tenantId,
        customerId: customerRecord?.id ?? contextMessage?.customerId ?? null,
        orderId: null,
        conversationId: conversation.id,
        inReplyToId: answeredMessage?.id ?? null,
        channel: MessageChannel.whatsapp,
        direction: MessageDirection.inbound,
        status: MessageStatus.delivered,
        provider: whatsappCloudProvider.name,
        messageBody: trimmed || msg.buttonPayload || `[${msg.type || 'message'}]`,
        providerMessageId: msg.providerMessageId || null,
        metadata: {
          from: fromPhone,
          type: msg.type,
          context: raw.context ?? null,
          answeredMessageLogId: contextMessage?.id ?? null,
          matchedKeyword: responseKind,
        },
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      logger.info('Duplicate WhatsApp webhook message ignored', { messageId: msg.providerMessageId });
      return;
    }
    throw err;
  }

  // The outbound message is answered. This is the only place that sets `replied`.
  if (answeredMessage) {
    const live: MessageStatus[] = [MessageStatus.pending, MessageStatus.sent, MessageStatus.delivered, MessageStatus.read];
    await prisma.messageLog.update({
      where: { id: answeredMessage.id },
      data: {
        repliedAt: answeredMessage.repliedAt ?? msg.occurredAt,
        ...(live.includes(answeredMessage.status) ? { status: MessageStatus.replied } : {}),
      },
    });
  }

  const isStop = STOP_WORDS.has(cleanText);
  const isStart = START_WORDS.has(cleanText);
  let handledByAutoConfirm = false;

  if (isStop || isStart) {
    await setOptOut({
      tenantId, phone, customerId: customerRecord?.id ?? null, channel: MessageChannel.whatsapp,
      optedOut: isStop, reason: isStop ? 'stop_reply' : 'resubscribe',
    });
  } else {
    handledByAutoConfirm = await runAutoConfirm(tenantId, {
      responseKind, fromPhone, customer: customerRecord, contextMessage, logId: createdLog.id,
    });
  }

  const lastMessageAt = conversation.lastMessageAt > msg.occurredAt ? conversation.lastMessageAt : msg.occurredAt;
  const needsAnswer = !isStop && !isStart && !handledByAutoConfirm;
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt,
      lastInboundAt: msg.occurredAt,
      status: 'open',
      ...(needsAnswer ? { unanswered: true } : {}),
    },
  });

  if (needsAnswer) {
    try {
      await notifyCustomerReply({
        tenantId,
        conversationId: updated.id,
        recipientId: await replyRecipient(tenantId, updated),
        title: `New reply from ${customerRecord ? `${customerRecord.firstName} ${customerRecord.lastName}`.trim() : phone}`,
        preview: trimmed || `[${msg.type || 'message'}]`,
      });
    } catch (err: any) {
      logger.error('Could not notify about a customer reply', { conversationId: updated.id, error: err.message });
    }
  }
}

/** The M7 auto-confirm step, as it was in the controller. Returns true when it acted on an open auto-confirm. */
async function runAutoConfirm(
  tenantId: string,
  ctx: { responseKind: 'yes' | 'change' | 'cancel' | 'no' | null; fromPhone: string; customer: any; contextMessage: any; logId: number },
): Promise<boolean> {
  const { responseKind, fromPhone, customer, contextMessage, logId } = ctx;
  let targetOrder: any = null;
  if (contextMessage?.orderId) {
    targetOrder = await prisma.order.findFirst({
      where: { tenantId, id: contextMessage.orderId, deletedAt: null },
      include: { customer: true },
    });
  } else if (customer) {
    // First: open auto-confirm order
    targetOrder = await prisma.order.findFirst({
      where: {
        tenantId,
        customerId: customer.id,
        status: 'pending_confirmation',
        autoConfirmSentAt: { not: null },
        customerResponse: null,
        deletedAt: null,
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  let acted = false;
  // Acts only on an open auto-confirm: status pending_confirmation and autoConfirmSentAt not null.
  if (targetOrder && targetOrder.status === 'pending_confirmation' && targetOrder.autoConfirmSentAt !== null && responseKind) {
    acted = true;
    const firstName = targetOrder.customer?.firstName || customer?.firstName || 'there';

    if (responseKind === 'yes') {
      await orderService.confirmByCustomer(targetOrder.id);
    } else {
      await prisma.order.update({
        where: { id: targetOrder.id },
        data: { saidNo: true, requiresManualCall: true, customerResponse: responseKind },
      });
    }
    await prisma.confirmToken.updateMany({
      where: { orderId: targetOrder.id, usedAt: null },
      data: { usedAt: new Date(), response: responseKind },
    });

    const replyText = REPLY_TEXT[responseKind];
    if (replyText) {
      try {
        const reply = await whatsappService.sendText({
          to: fromPhone,
          body: replyText(firstName, targetOrder.id),
          orderId: targetOrder.id,
          customerId: targetOrder.customer?.id ?? customer?.id,
        });
        if (!reply.sent) {
          logger.warn(`${responseKind} reply WhatsApp message not sent: WhatsApp is not set up`, { orderId: targetOrder.id, customerId: targetOrder.customer?.id ?? customer?.id });
        }
      } catch (err: any) {
        logger.error(`Failed to send ${responseKind === 'yes' ? 'confirmation' : responseKind} reply WhatsApp message`, { error: err.message, orderId: targetOrder.id });
      }
    }
  }

  // After the order step, update that row's orderId if an order was found
  const resolvedOrderId = targetOrder?.id ?? contextMessage?.orderId ?? null;
  if (resolvedOrderId) {
    await prisma.messageLog.update({ where: { id: logId }, data: { orderId: resolvedOrderId } });
  }
  return acted;
}

/** Process the inbound messages of one verified webhook change. The caller has checked the signature. */
export async function processInboundWhatsapp(tenantId: string, req: CallbackRequest): Promise<void> {
  for (const msg of whatsappCloudProvider.parseInbound!(req)) {
    await processInboundMessage(tenantId, msg);
  }
}
