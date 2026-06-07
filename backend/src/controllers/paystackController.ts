import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { paystackService } from '../services/paystackService';
import { digitalDeliveryService } from '../services/digitalDeliveryService';
import { GLAutomationService } from '../services/glAutomationService';
import { AppError } from '../middleware/errorHandler';
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

interface PaystackChargeData {
  reference: string;
  metadata?: { orderId?: number; order_id?: number };
  amount: number;
  fees: number;
  currency: string;
}

async function handleChargeSuccess(tenantId: string, data: PaystackChargeData): Promise<void> {
  const { reference, metadata, amount, fees, currency } = data;
  const rawOrderId = metadata?.orderId ?? metadata?.order_id;

  if (rawOrderId === undefined || rawOrderId === null) {
    logger.error('Paystack charge.success missing orderId in metadata', { tenantId, reference });
    return;
  }

  // Guard non-numeric metadata (Paystack lets clients put anything in metadata)
  // before it hits Prisma's findUnique and throws PrismaClientValidationError.
  const numericOrderId = Number(rawOrderId);
  if (!Number.isInteger(numericOrderId) || numericOrderId <= 0) {
    logger.error('Paystack charge.success has non-numeric orderId in metadata', {
      tenantId,
      reference,
      rawOrderId,
    });
    return;
  }

  // Anti-cross-tenant guard: the order's tenantId must match the webhook tenant.
  // Null orderRef.tenantId (legacy unscoped orders) is treated as a tenant
  // mismatch — anyone routing a webhook through a per-tenant URL must own that
  // order's tenant, including for backfilled rows.
  const orderRef = await prisma.order.findUnique({
    where: { id: numericOrderId },
    select: { tenantId: true, totalAmount: true },
  });
  if (orderRef && orderRef.tenantId !== tenantId) {
    logger.warn('Paystack webhook for order from a different tenant — ignoring', {
      webhookTenantId: tenantId,
      orderTenantId: orderRef.tenantId,
      orderId: numericOrderId,
      reference,
    });
    return;
  }

  // Alias for downstream code: orderId here is already numeric + validated.
  const orderId = numericOrderId;

  // Double-verify with Paystack API using the tenant's secret
  const verification = await paystackService.verifyTransaction(tenantId, reference);
  if (verification.data.status !== 'success') {
    logger.warn('Paystack verification failed', { tenantId, orderId, reference, status: verification.data.status });
    await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: 'payment_failed' },
    });
    return;
  }

  // SECURITY: confirm the amount actually paid covers the order total before
  // marking it paid. Without this, an underpayment (or a tampered initialize
  // amount) is accepted as full payment — and digital products auto-fulfil.
  // Paystack returns amount in minor units (pesewas/kobo).
  const paidMinorUnits = Number(verification.data.amount ?? amount);
  const expectedMinorUnits = Math.round(Number(orderRef?.totalAmount ?? 0) * 100);
  if (!orderRef || paidMinorUnits < expectedMinorUnits) {
    logger.warn('Paystack amount mismatch — underpaid, not fulfilling', {
      tenantId, orderId, reference, paidMinorUnits, expectedMinorUnits,
    });
    await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: 'payment_failed' },
    });
    return;
  }

  // Atomic idempotency: only update if not already paid.
  // Prevents TOCTOU race when concurrent webhooks arrive.
  const updated = await prisma.$queryRaw<{ id: number }[]>`
    UPDATE "orders"
    SET "payment_status" = 'paid', "status" = 'confirmed',
        "payment_reference" = ${reference}, "updated_at" = NOW()
    WHERE "id" = ${Number(orderId)}
      AND "payment_status" != 'paid'
    RETURNING "id"
  `;

  if (!updated || updated.length === 0) {
    logger.info('Paystack payment already processed, skipping', { tenantId, orderId, reference });
    return;
  }

  // Fetch the full order for downstream processing
  const order = await prisma.order.findUnique({
    where: { id: Number(orderId) },
    include: { orderItems: { include: { product: true } }, customer: true },
  });

  if (!order) {
    logger.error('Order not found after payment update', { tenantId, orderId, reference });
    return;
  }

  // Process remaining payment records in transaction
  await prisma.$transaction(async (tx) => {
    // Create transaction record
    await tx.transaction.create({
      data: {
        orderId: Number(orderId),
        type: 'payment',
        amount: amount / 100, // Convert from minor units
        paymentMethod: 'paystack',
        status: 'paid',
        reference,
        metadata: {
          currency,
          fees: fees / 100,
          paystackReference: reference,
        },
      },
    });

    // Create order history
    await tx.orderHistory.create({
      data: {
        orderId: Number(orderId),
        status: 'confirmed',
        notes: `Payment confirmed via Paystack (ref: ${reference})`,
      },
    });

    // Create GL entry for digital sale
    if (order.orderType === 'digital') {
      try {
        const glService = new GLAutomationService();
        const paystackFee = (fees || 0) / 100;
        await glService.createDigitalSaleEntry(tx as any, Number(orderId), amount / 100, paystackFee, order.customer?.id || 1);
      } catch (glError: any) {
        logger.warn('Failed to create GL entry for digital sale, continuing', { orderId, error: glError.message });
      }
    }
  });

  logger.info('Paystack payment processed successfully', { tenantId, orderId, reference, amount: amount / 100 });

  // For digital orders: generate download token and send links
  if (order.orderType === 'digital') {
    try {
      const token = await digitalDeliveryService.generateDownloadToken(Number(orderId), order);
      await digitalDeliveryService.sendDownloadLinks(Number(orderId), token, order);

      // Update status to digital_delivered
      await prisma.order.update({
        where: { id: Number(orderId) },
        data: { status: 'digital_delivered' },
      });
      await prisma.orderHistory.create({
        data: {
          orderId: Number(orderId),
          status: 'digital_delivered',
          notes: 'Download link sent to customer',
        },
      });
    } catch (err: any) {
      logger.error('Failed to deliver digital product — customer paid but delivery failed', {
        orderId,
        reference,
        error: err.message,
      });
      // Flag the order so admins can see and retry manually
      // Use 'confirmed' status (payment succeeded) with notes explaining delivery failure
      try {
        await prisma.order.update({
          where: { id: Number(orderId) },
          data: {
            notes: `DELIVERY FAILED: Digital delivery failed after payment (ref: ${reference}): ${err.message}. Manual intervention required.`,
          },
        });
        await prisma.orderHistory.create({
          data: {
            orderId: Number(orderId),
            status: 'confirmed',
            notes: `Automatic digital delivery failed: ${err.message}. Customer was charged. Manual resend required.`,
          },
        });
      } catch (flagErr: any) {
        logger.error('Failed to flag digital delivery failure on order', { orderId, error: flagErr.message });
      }
    }
  }
}

/**
 * Shared verification helper. Returns verification data and order.
 * Order lookup is the source of truth for tenantId.
 *
 * Pass `expectedOrderId` when the caller already knows which order this should
 * resolve to (PaymentCallback page after Paystack redirect). The reference may
 * not be linked to the order locally yet because the webhook hasn't fired;
 * using the orderId lets us resolve the tenant from the order row directly,
 * then verify against Paystack and post-check that metadata matches.
 */
async function verifyPaymentCore(reference: string, expectedOrderId?: number) {
  // Primary path: order has been linked to the reference (webhook ran already).
  let order = await prisma.order.findFirst({
    where: { paymentReference: reference },
    select: { id: true, status: true, paymentStatus: true, totalAmount: true, tenantId: true },
  });

  // Fallback path: webhook hasn't fired yet but the caller knows the orderId
  // (PaymentCallback gets it from the callback URL query param). Resolve tenant
  // from the order, verify against Paystack, then post-check metadata matches
  // so a guessed-reference can't return a different tenant's order.
  if (!order && expectedOrderId && Number.isInteger(expectedOrderId) && expectedOrderId > 0) {
    order = await prisma.order.findUnique({
      where: { id: expectedOrderId },
      select: { id: true, status: true, paymentStatus: true, totalAmount: true, tenantId: true },
    });
  }

  if (!order) {
    return { verification: null, order: null };
  }

  if (!order.tenantId) {
    throw new AppError('Order has no tenant — cannot verify Paystack reference', 500);
  }

  const verification = await paystackService.verifyTransaction(order.tenantId, reference);

  // When we resolved via the expectedOrderId fallback, the reference came from
  // the URL and the order from the query string — verify Paystack agrees they
  // belong together. Stops reference-guessing / cross-stitching attacks.
  const metaOrderId = (verification as any)?.data?.metadata?.orderId ?? (verification as any)?.data?.metadata?.order_id;
  if (metaOrderId !== undefined && metaOrderId !== null && Number(metaOrderId) !== order.id) {
    logger.warn('Paystack metadata.orderId mismatches resolved order', {
      reference,
      resolvedOrderId: order.id,
      metadataOrderId: metaOrderId,
    });
    return { verification: null, order: null };
  }

  return { verification, order };
}

/**
 * Verify a payment by reference (admin use, authenticated).
 */
export async function verifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const { reference } = req.params;
    if (!reference) {
      res.status(400).json({ error: 'Reference is required' });
      return;
    }

    const expectedOrderId = req.query.orderId ? Number(req.query.orderId) : undefined;
    const { verification, order } = await verifyPaymentCore(reference, expectedOrderId);

    if (!verification) {
      res.status(404).json({ error: 'No order linked to this Paystack reference yet' });
      return;
    }

    res.json({
      success: verification.data.status === 'success',
      paymentStatus: verification.data.status,
      reference: verification.data.reference,
      amount: verification.data.amount / 100,
      currency: verification.data.currency,
      order,
    });
  } catch (error: any) {
    logger.error('Payment verification failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/**
 * Public endpoint to verify payment status (used by PaymentCallback page).
 * Requires orderId query param to prevent reference enumeration.
 */
export async function publicVerifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const { reference } = req.params;
    const expectedOrderId = req.query.orderId as string;

    if (!reference) {
      res.status(400).json({ error: 'Reference is required' });
      return;
    }

    const parsedExpectedOrderId = expectedOrderId ? Number(expectedOrderId) : undefined;
    const { verification, order } = await verifyPaymentCore(reference, parsedExpectedOrderId);

    if (!verification || !order) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    // Require orderId correlation to prevent enumeration attacks
    if (parsedExpectedOrderId && order.id !== parsedExpectedOrderId) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    res.json({
      success: verification.data.status === 'success',
      paymentStatus: verification.data.status,
      order: { id: order.id, status: order.status, paymentStatus: order.paymentStatus },
    });
  } catch (error: any) {
    logger.error('Public payment verification failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}
