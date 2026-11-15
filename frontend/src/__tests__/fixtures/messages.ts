import type { ConversationRow, Figures, LogRow, Thread, ThreadMessage } from '../../pages/messages/types';

export const conversation = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  id: 1, channel: 'whatsapp', phone: '+233241111111', customerId: 7, customerName: 'Ama Mensah', displayName: 'Ama Mensah',
  lastMessagePreview: 'Where is my order?', lastMessageDirection: 'inbound', lastMessageAt: new Date(Date.now() - 3600_000).toISOString(),
  unanswered: true, status: 'open', assignedTo: null, windowOpen: true, windowExpiresAt: null, ...over,
});

export const message = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: 1, direction: 'outbound', channel: 'whatsapp', messageBody: 'Hello', templateName: null, status: 'sent', errorMessage: null,
  inReplyToId: null, orderId: null, createdAt: '2026-11-10T09:00:00.000Z', sentAt: null, deliveredAt: null, readAt: null, repliedAt: null, ...over,
});

export const thread = (messages: ThreadMessage[], over: Partial<Thread['conversation']> = {}): Thread => ({
  conversation: { id: 1, phone: '+233241111111', customerId: 7, status: 'open', unanswered: true, windowOpen: true, ...over },
  messages,
});

export const figures = (over: Partial<Figures> = {}): Figures => ({
  sent: 100, delivered: 94, read: 63, failed: 4, replied: 11, skipped: 2,
  deliveredRate: 94, readRate: 63, failedRate: 4, replyRate: 11, ...over,
});

export const logRow = (over: Partial<LogRow> = {}): LogRow => ({
  id: 1, channel: 'whatsapp', status: 'delivered', recipient: '+233241111111', at: '2026-11-10T09:00:00.000Z', sentAt: null,
  templateName: 'order_confirmed', errorMessage: null, order: { id: 55 }, customer: { id: 7, name: 'Ama Mensah' }, ...over,
});
