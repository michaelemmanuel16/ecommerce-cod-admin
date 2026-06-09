import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { paystackService } from '../services/paystackService';
import { settlePaystackPayment } from '../services/paystackSettlementService';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

/**
 * Paystack webhook handler — called by Paystack on charge.success.
 * Uses raw body for HMAC signature verification, scoped to the URL tenant.
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    const tenantSlug = req.params.tenantSlug;
    if (!tenantSlug) {
      res.status(400).json({ error: 'Missing tenant slug' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const signature = req.headers['x-paystack-signature'] as string;
    if (!signature) {
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    // Use rawBody preserved by the verify callback in server.ts (avoids express.json() parsing issue)
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      logger.error('Paystack webhook: rawBody not available — check server.ts verify callback');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }
    const isValid = await paystackService.validateWebhookSignature(tenant.id, rawBody, signature);
    if (!isValid) {
      logger.warn('Invalid Paystack webhook signature', { tenantId: tenant.id });
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // req.body is already parsed by express.json(); use it directly
    const event = req.body;
    logger.info('Paystack webhook received', { tenantId: tenant.id, event: event.event });

    // Idempotency gate: record (tenant_id, provider, event_type, reference) before any side effect.
    // Unique-constraint violation = replay; ack and return without re-processing.
    // If side-effect processing throws below, the row is removed so Paystack retries succeed.
    const reference: string | undefined = event?.data?.reference;
    let dedupRowId: number | null = null;
    if (reference && event?.event) {
      const payloadHash = createHash('sha256').update(rawBody).digest('hex');
      try {
        const created = await prisma.webhookEvent.create({
          data: {
            provider: 'paystack',
            eventType: event.event,
            reference,
            payloadHash,
            tenantId: tenant.id,
          },
          select: { id: true },
        });
        dedupRowId = created.id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          logger.info('Paystack webhook replay ignored', { tenantId: tenant.id, eventType: event.event, reference });
          res.status(200).json({ received: true, duplicate: true });
          return;
        }
        throw err;
      }
    }

    try {
      if (event.event === 'charge.success') {
        await handleChargeSuccess(tenant.id, event.data);
      }
    } catch (processingError: any) {
      // Side-effect processing failed — remove the dedup row so Paystack's
      // retries can re-enter the handler. Otherwise a transient miss (Paystack
      // API blip, isEnabled toggled mid-flight, GL error) permanently burns
      // the reference because we 200 the ACK regardless.
      if (dedupRowId !== null) {
        try {
          await prisma.webhookEvent.delete({ where: { id: dedupRowId } });
        } catch (cleanupError: any) {
          logger.error('Failed to delete dedup row after processing error', {
            dedupRowId,
            error: cleanupError.message,
          });
        }
      }
      throw processingError;
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error('Paystack webhook error', { error: error.message });
    // Still return 200 to prevent retries for processing errors
    res.status(200).json({ received: true });
  }
}

/**
 * Legacy unscoped webhook — pointed at by tenants who haven't updated their
 * Paystack dashboard yet. Returns 410 so the failure is loud.
 *
 * TODO(MAN-66 cleanup, sunset 2026-09-01): delete this handler + its route
 * after Phase 6 migrations are done (all live tenants pointed at the
 * per-tenant URL). Log volume to /api/paystack/webhook should be zero before
 * removal; until then this stays as a visible 410 rather than a 404.
 */
export function handleLegacyWebhook(_req: Request, res: Response): void {
  logger.warn('Paystack webhook hit legacy unscoped URL — tenant Paystack dashboard still misconfigured');
  res.status(410).json({
    error: 'Webhook URL has moved.',
    hint: 'Use the per-tenant URL from Settings → Integrations → Paystack: /api/paystack/webhook/<tenant-slug>',
  });
}

/**
 * Webhook charge.success handler. Settlement is delegated to the shared
 * settlement service (deferred-creation model): the order is created from the
 * pending checkout the first time a confirmed payment arrives — here or via the
 * callback verify, whichever is first. Idempotent.
 */
async function handleChargeSuccess(tenantId: string, data: { reference?: string }): Promise<void> {
  const reference = data?.reference;
  if (!reference) {
    logger.error('Paystack charge.success missing reference', { tenantId });
    return;
  }

  const result = await settlePaystackPayment(reference, { webhookTenantId: tenantId });
  if (result.status === 'not_found') {
    logger.warn('Paystack charge.success with no matching pending checkout', { tenantId, reference });
  }
}

/**
 * Verify a payment by reference (admin use, authenticated). Settles the payment
 * if it's confirmed but not yet materialized into an order.
 */
export async function verifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const { reference } = req.params;
    if (!reference) {
      res.status(400).json({ error: 'Reference is required' });
      return;
    }

    const result = await settlePaystackPayment(reference);
    if (result.status === 'not_found' || !result.order) {
      res.status(404).json({ error: 'No checkout found for this Paystack reference' });
      return;
    }

    res.json({
      success: result.status === 'success',
      paymentStatus: result.status,
      reference,
      order: result.order,
    });
  } catch (error: any) {
    logger.error('Payment verification failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/**
 * Public endpoint used by the PaymentCallback page after the Paystack redirect.
 * Settles the payment — creating the confirmed order on success — so the buyer's
 * order is recorded even if the webhook never fires. The reference is the
 * unguessable secret; settlement re-verifies with Paystack before doing anything.
 */
export async function publicVerifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const { reference } = req.params;
    if (!reference) {
      res.status(400).json({ error: 'Reference is required' });
      return;
    }

    const result = await settlePaystackPayment(reference);
    if (result.status === 'not_found') {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    res.json({
      success: result.status === 'success',
      paymentStatus: result.status,
      order: result.order
        ? { id: result.order.id, status: result.order.status, paymentStatus: result.order.paymentStatus }
        : null,
    });
  } catch (error: any) {
    logger.error('Public payment verification failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}
