import { Conversation, MessageChannel, MessageDirection, Prisma, UserRole } from '@prisma/client';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import whatsappService, { formatPhoneNumber } from '../whatsappService';
import { notifyCustomerReply } from './replyNotify';
import { isOptedOut } from './optOutService';
import { assertSendable, getTemplate } from './templateService';
import { DAY_MS } from '../kpi/dates';
import { isManagerUp } from '../../utils/authUtils';
import { repConversationWhere } from './conversationScope';
import { conversationPhone, phoneForms } from '../../utils/phone';
import { orderScope } from '../../utils/authUtils';
import { whatsappCloudProvider } from './providers';

export interface Actor {
  id: number;
  role: UserRole;
  tenantId: string;
}

/** The WhatsApp customer-service window: free text is allowed this long after the customer's last message. */
export const WINDOW_MS = DAY_MS;
export const WINDOW_CLOSED_MESSAGE = 'The 24 hour window is closed. Send an approved template.';
/** Roles that can open the Conversations screen, so the only roles a conversation may be assigned to. */
export const CONVERSATION_ROLES: UserRole[] = ['super_admin', 'admin', 'manager', 'sales_rep'];
const PAGE_SIZE = 25;
const THREAD_LIMIT = 500;

export const windowOpen = (lastInboundAt: Date | null, now: number = Date.now()): boolean =>
  !!lastInboundAt && now - lastInboundAt.getTime() < WINDOW_MS;

/** Owner, admin and manager see every conversation of the tenant. A rep sees only (A) conversations of a customer with an order whose customerRepId is the rep, plus (B) conversations assigned to the rep. */
export function visibilityWhere(actor: Pick<Actor, 'id' | 'role' | 'tenantId'>): Prisma.ConversationWhereInput {
  if (isManagerUp(actor)) return { tenantId: actor.tenantId };
  return { tenantId: actor.tenantId, ...repConversationWhere(actor.id) };
}

/** The messages of a thread: its own rows, plus outbound messages sent to the same number before it existed. */
function threadWhere(c: Pick<Conversation, 'id' | 'tenantId' | 'channel' | 'phone'>): Prisma.MessageLogWhereInput {
  return {
    OR: [
      { conversationId: c.id },
      { tenantId: c.tenantId, channel: c.channel, direction: MessageDirection.outbound, metadata: { path: ['to'], equals: formatPhoneNumber(c.phone) } },
    ],
  };
}

async function loadVisible(id: number, actor: Actor): Promise<Conversation> {
  const conversation = await prisma.conversation.findFirst({ where: { AND: [{ id }, visibilityWhere(actor)] } });
  if (!conversation) throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
  return conversation;
}

export interface ListQuery {
  status?: 'open' | 'done';
  unanswered?: boolean;
  assignedTo?: string; // me | none | a user id
  channel?: MessageChannel;
  q?: string;
  cursor?: string;
  limit?: number;
}

const encodeCursor = (c: { lastMessageAt: Date; id: number }) => Buffer.from(`${c.lastMessageAt.toISOString()}|${c.id}`).toString('base64url');
function decodeCursor(cursor: string): { at: Date; id: number } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || !Number.isInteger(Number(id))) throw new AppError('Bad cursor', 400);
  return { at, id: Number(id) };
}

const personName = (p: { firstName: string; lastName: string; displayName?: string | null } | null) =>
  p ? (p.displayName || `${p.firstName} ${p.lastName}`.trim()) : null;

type RowSource = Conversation & {
  customer: { id: number; firstName: string; lastName: string } | null;
  assignedTo: { id: number; firstName: string; lastName: string; displayName: string | null } | null;
};

async function presentRow(c: RowSource) {
  const last = await prisma.messageLog.findFirst({
    where: threadWhere(c),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { messageBody: true, direction: true, createdAt: true },
  });
  return {
    id: c.id,
    channel: c.channel,
    phone: c.phone,
    customerId: c.customerId,
    customerName: c.customer ? `${c.customer.firstName} ${c.customer.lastName}`.trim() : null,
    displayName: c.customer ? `${c.customer.firstName} ${c.customer.lastName}`.trim() : c.phone,
    lastMessagePreview: last ? last.messageBody.slice(0, 140) : null,
    lastMessageDirection: last?.direction ?? null,
    lastMessageAt: c.lastMessageAt,
    unanswered: c.unanswered,
    status: c.status,
    assignedTo: c.assignedTo ? { id: c.assignedTo.id, name: personName(c.assignedTo) } : null,
    windowOpen: windowOpen(c.lastInboundAt),
    windowExpiresAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS) : null,
  };
}

const ROW_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, displayName: true } },
} as const;

/** GET /api/conversations/:id: one list row (the deep link of the rep app). 404 when the actor may not see it. */
export async function getConversation(id: number, actor: Actor) {
  const c = await prisma.conversation.findFirst({ where: { AND: [{ id }, visibilityWhere(actor)] }, include: ROW_INCLUDE });
  if (!c) throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
  return presentRow(c);
}

export async function listConversations(actor: Actor, query: ListQuery) {
  const and: Prisma.ConversationWhereInput[] = [visibilityWhere(actor)];
  if (query.status) and.push({ status: query.status });
  if (query.unanswered !== undefined) and.push({ unanswered: query.unanswered });
  if (query.channel) and.push({ channel: query.channel });
  if (query.assignedTo === 'me') and.push({ assignedToId: actor.id });
  else if (query.assignedTo === 'none') and.push({ assignedToId: null });
  else if (query.assignedTo) and.push({ assignedToId: Number(query.assignedTo) });
  if (query.q) {
    const q = query.q.trim();
    const digits = q.replace(/\D/g, '');
    and.push({
      OR: [
        { customer: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }] } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    });
  }
  if (query.cursor) {
    const { at, id } = decodeCursor(query.cursor);
    and.push({ OR: [{ lastMessageAt: { lt: at } }, { lastMessageAt: at, id: { lt: id } }] });
  }

  const limit = query.limit ?? PAGE_SIZE;
  const rows = await prisma.conversation.findMany({
    where: { AND: and },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: ROW_INCLUDE,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const items = await Promise.all(page.map(presentRow));

  return { items, nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
}

export async function getThread(id: number, actor: Actor) {
  const c = await loadVisible(id, actor);
  const rows = await prisma.messageLog.findMany({
    where: threadWhere(c),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: THREAD_LIMIT,
    select: {
      id: true, direction: true, channel: true, messageBody: true, templateName: true, status: true, errorMessage: true,
      inReplyToId: true, orderId: true, createdAt: true, sentAt: true, deliveredAt: true, readAt: true, repliedAt: true,
    },
  });
  return {
    conversation: { id: c.id, phone: c.phone, customerId: c.customerId, status: c.status, unanswered: c.unanswered, windowOpen: windowOpen(c.lastInboundAt) },
    messages: rows.reverse(),
  };
}

export interface ReplyInput {
  body?: string;
  templateId?: number;
  variables?: string[];
}

export async function replyToConversation(id: number, actor: Actor, input: ReplyInput) {
  const c = await loadVisible(id, actor);
  if (c.channel !== MessageChannel.whatsapp) throw new AppError('Only WhatsApp conversations can be answered here', 400, 'CHANNEL_NOT_SUPPORTED');

  // A template to send must exist in this tenant and be approved (409 otherwise), whatever the window says
  const template = input.templateId ? await getTemplate(c.tenantId, input.templateId) : null;
  if (template) {
    if (template.channel !== MessageChannel.whatsapp) throw new AppError('Pick a WhatsApp template', 400, 'TEMPLATE_CHANNEL');
    assertSendable(template);
  }

  const open = windowOpen(c.lastInboundAt);
  const isTemplate = !!input.templateId;
  if (!isTemplate && !open) throw new AppError(WINDOW_CLOSED_MESSAGE, 422, 'WINDOW_CLOSED');

  // A customer who wrote in the last 24 hours can always be answered; otherwise an opted-out number cannot be messaged,
  // found by the phone as well as by the customer (a conversation may have no customer)
  if (!open && await isOptedOut(c.tenantId, MessageChannel.whatsapp, c.phone, c.customerId)) {
    throw new AppError('The customer opted out of WhatsApp', 409, 'CUSTOMER_OPTED_OUT');
  }

  const latestInbound = await prisma.messageLog.findFirst({
    where: { conversationId: c.id, direction: MessageDirection.inbound },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  // optOutCheckedByCaller: the window and opt-out check above is this path's own
  const common = { to: c.phone, customerId: c.customerId ?? undefined, conversationId: c.id, inReplyToId: latestInbound?.id, optOutCheckedByCaller: true };

  let result: { messageLogId: number; providerMessageId?: string; sent: boolean };
  if (template) {
    result = await whatsappService.sendTemplate({
      ...common,
      templateName: template.metaTemplateName ?? template.name,
      languageCode: template.language ?? undefined,
      bodyParams: input.variables,
      bodyText: template.body,
    });
  } else {
    result = await whatsappService.sendText({ ...common, body: input.body! });
  }
  if (!result.sent) throw new AppError('WhatsApp is not set up', 409, 'WHATSAPP_NOT_SET_UP');

  await prisma.conversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date(), unanswered: false } });
  return { messageLogId: result.messageLogId, providerMessageId: result.providerMessageId };
}

export async function updateConversation(id: number, actor: Actor, patch: { assignedToId?: number | null; status?: 'open' | 'done' }) {
  const c = await loadVisible(id, actor);
  if (patch.assignedToId) {
    // A rep may hand a conversation only to themselves, or clear it
    if (actor.role === 'sales_rep' && patch.assignedToId !== actor.id) {
      throw new AppError('You can assign a conversation only to yourself', 403, 'ASSIGN_FORBIDDEN');
    }
    const assignee = await prisma.user.findFirst({ where: { id: patch.assignedToId, tenantId: actor.tenantId, isActive: true }, select: { role: true } });
    if (!assignee) throw new AppError('That user is not in this store', 400, 'ASSIGNEE_NOT_FOUND');
    if (!CONVERSATION_ROLES.includes(assignee.role)) throw new AppError('This person cannot see conversations', 400, 'ASSIGNEE_CANNOT_SEE');
  }
  const updated = await prisma.conversation.update({
    where: { id: c.id },
    data: {
      ...(patch.assignedToId !== undefined ? { assignedToId: patch.assignedToId } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    },
  });

  if (patch.assignedToId && patch.assignedToId !== c.assignedToId) {
    const last = await prisma.messageLog.findFirst({ where: threadWhere(c), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { messageBody: true } });
    await notifyCustomerReply({
      tenantId: actor.tenantId,
      conversationId: c.id,
      event: 'conversation_assigned',
      recipientId: patch.assignedToId,
      actorId: actor.id,
      title: 'A conversation was assigned to you',
      preview: last?.messageBody ?? c.phone,
    });
  }
  return { id: updated.id, assignedToId: updated.assignedToId, status: updated.status };
}

/** The order a rep opens a chat from: a rep gets only their own orders (404 otherwise), manager and up get any. */
async function loadOrderCustomer(orderId: number, actor: Actor) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...orderScope(actor) },
    select: { id: true, customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } } },
  });
  if (!order?.customer?.phoneNumber) throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  return { orderId: order.id, customer: order.customer, phone: conversationPhone(order.customer.phoneNumber) };
}

/** The WhatsApp conversation of this phone, found under any stored form of the number. A conversation with no customer is linked to the order's customer, so the rep may open it. */
async function findOrderConversation(tenantId: string, phone: string, customerId: number) {
  const found = await prisma.conversation.findFirst({ where: { tenantId, channel: MessageChannel.whatsapp, phone: { in: [phone, ...phoneForms(phone)] } } });
  if (found && !found.customerId) return prisma.conversation.update({ where: { id: found.id }, data: { customerId } });
  return found;
}

/** GET /api/conversations/for-order/:orderId: the conversation to open from a rep's WhatsApp button (null id: none yet, the first send starts it). */
export async function conversationForOrder(orderId: number, actor: Actor) {
  const { customer, phone } = await loadOrderCustomer(orderId, actor);
  const found = await findOrderConversation(actor.tenantId, phone, customer.id);
  return {
    conversationId: found?.id ?? null,
    orderId,
    phone,
    customerName: `${customer.firstName} ${customer.lastName}`.trim(),
    windowOpen: windowOpen(found?.lastInboundAt ?? null),
  };
}

/** POST /api/conversations/start: the first message to an order's customer. Creates the thread, then sends like a reply (a new thread has no 24 hour window, so it needs an approved template). */
export async function startOrderConversation(actor: Actor, input: ReplyInput & { orderId: number }) {
  const { orderId, ...reply } = input;
  const { customer, phone } = await loadOrderCustomer(orderId, actor);
  let conversation = await findOrderConversation(actor.tenantId, phone, customer.id);
  if (!conversation) {
    try {
      conversation = await prisma.conversation.create({ data: { tenantId: actor.tenantId, channel: MessageChannel.whatsapp, phone, customerId: customer.id, lastMessageAt: new Date() } });
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      conversation = await prisma.conversation.findFirstOrThrow({ where: { tenantId: actor.tenantId, channel: MessageChannel.whatsapp, phone } });
    }
  }
  const sent = await replyToConversation(conversation.id, actor, reply);
  return { conversationId: conversation.id, ...sent };
}

/** GET /api/conversations/whatsapp-status: is a WhatsApp connection set up and on? Any role that opens Conversations may ask (the rep buttons use it). */
export async function whatsappStatus(): Promise<{ connected: boolean }> {
  return { connected: await whatsappCloudProvider.isEnabled('') };
}
