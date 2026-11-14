import { notify } from '../inbox/inboxService';

const PREVIEW_MAX = 140;

export interface NotifyCustomerReplyInput {
  tenantId: string;
  conversationId: number;
  /** The person to tell, or 'owner' for the tenant admins. */
  recipientId: number | 'owner';
  preview: string;
  /** Default: "A customer replied". */
  title?: string;
  /** The person who caused it (never notified about their own action). */
  actorId?: number | null;
}

/**
 * The one place a conversation tells a person something: a customer reply, or a conversation assigned to them.
 * There is no separate "conversation assigned" inbox event, so both use `customer_reply`.
 */
export async function notifyCustomerReply(input: NotifyCustomerReplyInput): Promise<void> {
  const preview = input.preview.length > PREVIEW_MAX ? `${input.preview.slice(0, PREVIEW_MAX - 1)}…` : input.preview;
  await notify({
    tenantId: input.tenantId,
    event: 'customer_reply',
    kind: 'reply',
    subject: { type: 'conversation', id: input.conversationId },
    recipients: input.recipientId === 'owner' ? 'owner' : [input.recipientId],
    actorId: input.actorId ?? null,
    title: input.title ?? 'A customer replied',
    message: preview,
    data: { conversationId: input.conversationId },
  });
}
