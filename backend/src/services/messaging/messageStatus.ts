import { MessageStatus, Prisma } from '@prisma/client';
import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { runInTenant, runInTenantOf, withoutTenant } from '../../utils/tenantContext';
import { MESSAGE_LOG_RETENTION_DAYS, PENDING_EVENT_TTL_MS } from './constants';
import { DAY_MS } from '../kpi/dates';

export interface StatusDetail {
  providerStatus?: string;
  failureReason?: string;
  /** Set when the callback is already tied to a verified tenant (WhatsApp): only that tenant's rows can match. */
  tenantId?: string;
  /** The callback proved who sent it (WhatsApp signature, Arkesel token). Only such events are held. */
  authenticated?: boolean;
  /** Do not hold the event when no row matches (used when applying held events). */
  noHold?: boolean;
}

export type RecordOutcome = 'applied' | 'held' | 'ignored';

// pending < sent < delivered < read. `failed` is allowed before delivered; `replied` is set by inbound only.
const RANK: Partial<Record<MessageStatus, number>> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/** The status the row should have after `incoming` arrives, or null when it must stay as it is. */
export function nextStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus | null {
  if (incoming === MessageStatus.failed) {
    return current === MessageStatus.pending || current === MessageStatus.sent ? MessageStatus.failed : null;
  }
  const from = RANK[current];
  const to = RANK[incoming];
  if (from === undefined || to === undefined) return null; // failed, skipped, replied stay put
  return to > from ? incoming : null;
}

/** What a held event keeps, because the PendingMessageEvent table has no columns for it. */
interface HeldEnvelope {
  occurredAt: string;
  providerStatus?: string;
  failureReason?: string;
  tenantId?: string;
  raw?: unknown;
}

const MAX_HELD_PAYLOAD_BYTES = 4096;

/** A held event keeps at most 4 KB of the provider payload. */
function capPayload(payload: unknown): unknown {
  if (payload === undefined) return undefined;
  const size = Buffer.byteLength(JSON.stringify(payload) ?? '');
  return size > MAX_HELD_PAYLOAD_BYTES ? { truncated: true, bytes: size } : payload;
}

async function record(
  provider: string,
  providerMessageId: string,
  status: MessageStatus,
  occurredAt: Date,
  payload?: unknown,
  detail: StatusDetail = {},
): Promise<RecordOutcome> {
  // A callback with a verified tenant only reaches that tenant's rows. One without a tenant (Arkesel)
  // finds the row by provider id, unscoped on purpose.
  const find = () =>
    prisma.messageLog.findFirst({
      // The provider is part of the key: a WhatsApp callback can never change an Arkesel row
      where: { providerMessageId, provider },
      select: { id: true, tenantId: true, status: true, createdAt: true, sentAt: true, deliveredAt: true, readAt: true },
    });
  const log = detail.tenantId ? await runInTenant(detail.tenantId, find) : await withoutTenant('message-status', find);

  if (!log) {
    if (detail.noHold || !detail.authenticated) return 'ignored';
    const envelope: HeldEnvelope = {
      occurredAt: occurredAt.toISOString(),
      providerStatus: detail.providerStatus,
      failureReason: detail.failureReason,
      tenantId: detail.tenantId,
      raw: capPayload(payload),
    };
    await prisma.pendingMessageEvent.create({
      data: {
        provider,
        providerMessageId,
        status,
        payload: envelope as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + PENDING_EVENT_TTL_MS),
      },
    });
    logger.info('Status event held: no message row yet', { provider, providerMessageId, status });
    return 'held';
  }

  const cutoff = Date.now() - MESSAGE_LOG_RETENTION_DAYS * DAY_MS;
  if (log.createdAt.getTime() < cutoff) {
    logger.info('Status event ignored: message is older than the retention', { provider, providerMessageId, status });
    return 'ignored';
  }

  await runInTenantOf(log.tenantId, 'message-status', async () => {
    if (log.tenantId) {
      const eventData = {
        providerStatus: detail.providerStatus,
        failureReason: detail.failureReason,
        payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined,
      };
      await prisma.messageEvent.upsert({
        where: { messageLogId_status: { messageLogId: log.id, status } },
        create: { messageLogId: log.id, tenantId: log.tenantId, status, occurredAt, ...eventData },
        update: eventData,
      });
    }

    const data: Prisma.MessageLogUpdateInput = {};
    const next = nextStatus(log.status, status);
    if (next) data.status = next;
    if (status === MessageStatus.sent && !log.sentAt) data.sentAt = occurredAt;
    if (status === MessageStatus.delivered && !log.deliveredAt) data.deliveredAt = occurredAt;
    if (status === MessageStatus.read && !log.readAt) data.readAt = occurredAt;
    if (next === MessageStatus.failed && detail.failureReason) data.errorMessage = detail.failureReason;
    if (Object.keys(data).length > 0) {
      await prisma.messageLog.update({ where: { id: log.id }, data });
    }
  });

  logger.info('Message status event recorded', { provider, providerMessageId, status });
  return 'applied';
}

/** Apply the events held for a provider id, now that its MessageLog row has the id. */
async function applyPending(providerMessageId: string, provider: string): Promise<number> {
  const held = await prisma.pendingMessageEvent.findMany({
    where: { providerMessageId, provider },
    orderBy: { receivedAt: 'asc' },
  });
  if (!held || held.length === 0) return 0;

  for (const event of held) {
    const envelope = (event.payload ?? {}) as unknown as HeldEnvelope;
    await record(
      provider,
      providerMessageId,
      event.status,
      envelope.occurredAt ? new Date(envelope.occurredAt) : event.receivedAt,
      envelope.raw,
      { providerStatus: envelope.providerStatus, failureReason: envelope.failureReason, tenantId: envelope.tenantId, noHold: true },
    );
  }
  await prisma.pendingMessageEvent.deleteMany({ where: { id: { in: held.map((e) => e.id) } } });
  return held.length;
}

/** Drop held events nobody claimed within the hour. One log line each. */
async function dropExpired(now: Date = new Date()): Promise<number> {
  const expired = await prisma.pendingMessageEvent.findMany({ where: { expiresAt: { lt: now } } });
  for (const event of expired) {
    logger.info('Dropped expired status event: no message row matched', {
      provider: event.provider,
      providerMessageId: event.providerMessageId,
      status: event.status,
    });
  }
  if (expired.length > 0) {
    await prisma.pendingMessageEvent.deleteMany({ where: { id: { in: expired.map((e) => e.id) } } });
  }
  return expired.length;
}

export const messageStatus = { record, applyPending, dropExpired };
export default messageStatus;
