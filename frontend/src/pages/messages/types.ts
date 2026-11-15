// Response shapes of GET /api/conversations, /api/conversations/:id/messages, /api/messages/overview and /api/messages/log
// (backend: conversationService.ts, messageStats.ts, messageLogQuery.ts) and of GET /api/message-templates.

export type Channel = 'whatsapp' | 'sms' | 'email';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'replied' | 'skipped';

export interface ConversationRow {
  id: number;
  channel: Channel;
  phone: string;
  customerId: number | null;
  customerName: string | null;
  displayName: string;
  lastMessagePreview: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  lastMessageAt: string;
  unanswered: boolean;
  status: 'open' | 'done';
  assignedTo: { id: number; name: string | null } | null;
  windowOpen: boolean;
  windowExpiresAt: string | null;
}

export interface ConversationList {
  items: ConversationRow[];
  nextCursor: string | null;
}

export interface ThreadMessage {
  id: number;
  direction: 'inbound' | 'outbound';
  channel: Channel;
  messageBody: string;
  templateName: string | null;
  status: MessageStatus;
  errorMessage: string | null;
  inReplyToId: number | null;
  orderId: number | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  repliedAt: string | null;
}

export interface Thread {
  conversation: { id: number; phone: string; customerId: number | null; status: 'open' | 'done'; unanswered: boolean; windowOpen: boolean };
  messages: ThreadMessage[];
}

/** One WhatsApp template from GET /api/message-templates. Only a `sendable` one (approved by Meta) can be picked. */
export interface ReplyTemplate {
  id: number;
  name: string;
  body: string;
  variables: string[];
  status: string | null;
  sendable: boolean;
}

export interface Assignee {
  id: number;
  name: string;
}

export interface Figures {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
  skipped: number;
  /** Percent of sent, one decimal. Null when nothing was sent. */
  deliveredRate: number | null;
  readRate: number | null;
  failedRate: number | null;
  replyRate: number | null;
}

export interface Overview {
  channels: Partial<Record<Channel, Figures>>;
  /** Every channel under the filters, from the same definition. The tiles show this. */
  total: Figures;
}

export type LogStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'replied' | 'skipped' | 'pending';

export interface LogRow {
  id: number;
  channel: Channel;
  status: MessageStatus;
  recipient: string | null;
  at: string;
  sentAt: string | null;
  templateName: string | null;
  errorMessage: string | null;
  order: { id: number } | null;
  customer: { id: number; name: string } | null;
}

export interface LogPage {
  items: LogRow[];
  /** Every row under the filters. With a status figure this is that figure's tile in the overview. */
  total: number;
  nextCursor: string | null;
}
