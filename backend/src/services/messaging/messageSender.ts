import { MessageChannel, MessageDirection, MessageStatus, Prisma } from '@prisma/client';
import prisma, { prismaBase } from '../../utils/prisma';
import logger from '../../utils/logger';
import { getTenantId, runInTenant } from '../../utils/tenantContext';
import { getProvider } from './providers';
import { messageStatus } from './messageStatus';
import { TemplateSend } from './types';

export interface SendMessageInput {
  tenantId: string | null;
  channel: MessageChannel;
  /** Already formatted for the channel */
  to: string;
  body?: string;
  template?: TemplateSend;
  /** What the log keeps instead of `body` (a text with a secret link, or the readable form of a template). */
  logBody?: string;
  /** Log label: the WhatsApp template name, the email template name */
  templateName?: string;
  orderId?: number | null;
  customerId?: number | null;
  campaignId?: number | null;
  conversationId?: number | null;
  inReplyToId?: number | null;
  fallbackOfId?: number | null;
  retryOfId?: number | null;
  metadata?: Prisma.InputJsonValue;
  // Email only
  subject?: string;
  headers?: Record<string, string>;
  sendAs?: 'platform' | 'tenant';
  /** Write a `skipped` row with this reason and send nothing (an opted-out customer). */
  skipReason?: string;
}

export interface SendMessageResult {
  messageLogId: number;
  status: MessageStatus;
  providerMessageId?: string;
  /** True when the provider accepted the message */
  sent: boolean;
  skipped: boolean;
  error?: string;
}

/** A failed send throws, as before, with the row id on the error so a caller can link a fallback to it. */
export function throwIfFailed(result: SendMessageResult): void {
  if (result.status === 'failed') {
    const error: any = new Error(result.error || 'Send failed');
    error.messageLogId = result.messageLogId;
    throw error;
  }
}

/**
 * Runs inside the short transaction that inserts the log row, before the insert. It may take a lock and check a gate;
 * a throw means nothing is inserted and nothing is sent. The provider is called only after the commit.
 */
export type SendGate = (tx: Prisma.TransactionClient) => Promise<void>;

async function run(input: SendMessageInput, gate?: SendGate): Promise<SendMessageResult> {
  const provider = getProvider(input.channel);
  const base = {
    tenantId: input.tenantId ?? undefined,
    orderId: input.orderId ?? undefined,
    customerId: input.customerId ?? undefined,
    campaignId: input.campaignId ?? undefined,
    conversationId: input.conversationId ?? undefined,
    inReplyToId: input.inReplyToId ?? undefined,
    fallbackOfId: input.fallbackOfId ?? undefined,
    retryOfId: input.retryOfId ?? undefined,
    channel: input.channel,
    direction: MessageDirection.outbound,
    templateName: input.templateName ?? input.template?.name,
    messageBody: input.logBody ?? input.body ?? '',
    provider: provider.name,
  };

  // Skipped: asked to skip, or the provider is off or not set up. A row is written and nothing throws.
  let skipReason = input.skipReason;
  let skipError: string | undefined;
  if (!skipReason) {
    let enabled = false;
    try {
      enabled = await provider.isEnabled(input.tenantId, { sendAs: input.sendAs });
    } catch (error: any) {
      logger.warn('Could not check whether the messaging provider is enabled', { channel: input.channel, error: error.message });
    }
    if (!enabled) {
      skipReason = 'provider_disabled';
      skipError = 'provider_disabled';
      logger.warn('Messaging provider disabled or not set up — message logged as skipped', { channel: input.channel });
    }
  }
  // With a gate the insert runs on a short transaction of its own: the gate checks, the row is written, then commit
  const insert = (data: Prisma.MessageLogUncheckedCreateInput) => gate
    ? prismaBase.$transaction(async (tx) => {
      await gate(tx);
      return tx.messageLog.create({ data });
    })
    : prisma.messageLog.create({ data });

  if (skipReason) {
    const row = await insert({
      ...base,
      status: MessageStatus.skipped,
      errorMessage: skipError,
      metadata: { ...(input.metadata as object | undefined), to: input.to, reason: skipReason },
    });
    return { messageLogId: row.id, status: MessageStatus.skipped, sent: false, skipped: true, error: skipError };
  }

  const row = await insert({
    ...base,
    status: MessageStatus.pending,
    metadata: { ...(input.metadata as object | undefined), to: input.to },
  });

  let result;
  try {
    result = await provider.send({
      tenantId: input.tenantId,
      to: input.to,
      body: input.body,
      template: input.template,
      subject: input.subject,
      headers: input.headers,
      sendAs: input.sendAs,
    });
  } catch (error: any) {
    result = { accepted: false, error: error?.message || 'Send failed' };
  }

  const providerName = (result as any).provider as string | undefined;
  if (!result.accepted) {
    await prisma.messageLog.update({
      where: { id: row.id },
      data: {
        status: MessageStatus.failed,
        errorMessage: result.error?.substring(0, 500),
        ...(providerName ? { provider: providerName } : {}),
      },
    });
    logger.error('Message not sent', { channel: input.channel, messageLogId: row.id, error: result.error });
    return { messageLogId: row.id, status: MessageStatus.failed, sent: false, skipped: false, error: result.error };
  }

  await prisma.messageLog.update({
    where: { id: row.id },
    data: {
      status: MessageStatus.sent,
      sentAt: new Date(),
      providerMessageId: result.providerMessageId,
      ...(providerName ? { provider: providerName } : {}),
    },
  });
  logger.info('Message sent', { channel: input.channel, messageLogId: row.id, providerMessageId: result.providerMessageId });

  // A status callback can beat this update: apply what was held for this id
  if (result.providerMessageId) {
    try {
      await messageStatus.applyPending(result.providerMessageId, providerName ?? provider.name);
    } catch (error: any) {
      logger.error('Could not apply held status events', { messageLogId: row.id, error: error.message });
    }
  }

  return { messageLogId: row.id, status: MessageStatus.sent, providerMessageId: result.providerMessageId, sent: true, skipped: false };
}

/**
 * The one place an outbound message is sent: writes the MessageLog row, calls the
 * channel adapter, updates the row. A disabled provider writes a `skipped` row
 * (errorMessage `provider_disabled`) and never throws.
 */
export const messageSender = {
  send(input: SendMessageInput, gate?: SendGate): Promise<SendMessageResult> {
    const ambient = getTenantId();
    if (input.tenantId && ambient !== input.tenantId) {
      return runInTenant(input.tenantId, () => run(input, gate));
    }
    return run(input, gate);
  },
};

export default messageSender;
