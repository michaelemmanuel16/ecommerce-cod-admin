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

/** GET /api/orders/:id/messages and /api/customers/:id/messages (backend: messageTracking.ts). Newest first. */
export interface TrackedMessage {
  id: number;
  channel: Channel;
  direction: 'inbound' | 'outbound';
  status: MessageStatus;
  at: string;
  bodyPreview: string;
  inReplyToId: number | null;
  errorMessage: string | null;
}

export interface TrackedMessages {
  items: TrackedMessage[];
  /** Customer route only. */
  optOut?: { whatsapp: boolean; sms: boolean; email: boolean };
}

/** One template from GET /api/message-templates (backend templateService.toApi). `status` is Meta's, for WhatsApp only. */
export interface MessageTemplate {
  id: number;
  channel: Channel;
  name: string;
  key: string | null;
  subject: string | null;
  body: string;
  variables: string[];
  language: string | null;
  category: string | null;
  /** approved, pending, rejected or paused. Null for SMS and email, and for a WhatsApp template not yet read from Meta. */
  status: string | null;
  rejectReason: string | null;
  metaTemplateName: string | null;
  quickReplies: string[] | null;
  sendable: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The body of POST and PUT /api/message-templates. */
export interface TemplateInput {
  name?: string;
  subject?: string | null;
  body?: string;
  language?: string;
  category?: string;
  metaTemplateName?: string;
}

/** One row of GET /api/messages/opt-outs: a customer (or a bare phone) opted out of one channel. */
export interface OptOutRow {
  key: string;
  channel: Channel;
  customerId: number | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  area: string | null;
  since: string | null;
  reason: string | null;
}

export interface OptOutPage {
  items: OptOutRow[];
  total: number;
  page: number;
  limit: number;
}
