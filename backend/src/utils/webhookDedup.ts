import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import logger from './logger';

interface DedupKey {
  provider: string;
  eventType: string;
  /** No reference = nothing to dedupe on: the handler runs ungated. */
  reference?: string;
  payloadHash: string;
  tenantId: string;
}

/**
 * Idempotency gate for a webhook: record (tenant_id, provider, event_type, reference)
 * before any side effect. A unique-constraint violation is a replay: ack and skip
 * the handler. If the handler throws, the row is removed so the provider's retry can
 * re-enter, then the error is rethrown. On success, acks with 200.
 * Must run inside the tenant context (WebhookEvent is tenant-scoped).
 */
export async function withWebhookDedup(
  res: Response,
  key: DedupKey,
  label: string,
  handler: () => Promise<void>
): Promise<void> {
  let dedupRowId: number | null = null;
  if (key.reference) {
    try {
      const created = await prisma.webhookEvent.create({
        data: { ...key, reference: key.reference },
        select: { id: true },
      });
      dedupRowId = created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        logger.info(`${label} webhook replay ignored`, { tenantId: key.tenantId, eventType: key.eventType, reference: key.reference });
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
      throw err;
    }
  }

  try {
    await handler();
  } catch (processingError) {
    // Side-effect processing failed: remove the dedup row so the provider's
    // retries can re-enter the handler. Otherwise a transient miss permanently
    // burns the reference because we 200 the ACK regardless.
    if (dedupRowId !== null) {
      try {
        await prisma.webhookEvent.delete({ where: { id: dedupRowId } });
      } catch (cleanupError: any) {
        logger.error(`Failed to delete ${label} dedup row after processing error`, {
          dedupRowId,
          error: cleanupError.message,
        });
      }
    }
    throw processingError;
  }

  // Always return 200 to acknowledge receipt
  res.status(200).json({ received: true });
}
