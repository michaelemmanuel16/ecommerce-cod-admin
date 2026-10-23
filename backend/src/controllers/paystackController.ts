import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { getPaymentProvider } from '../services/payments';
import { settlePaystackPayment } from '../services/paystackSettlementService';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { runInTenant } from '../utils/tenantContext';
import { withWebhookDedup } from '../utils/webhookDedup';

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

    // Everything below runs inside the URL tenant's context
    await runInTenant(tenant.id, () => processTenantWebhook(req, res, tenant.id));
  } catch (error: any) {
    logger.error('Paystack webhook error', { error: error.message });
    // Still return 200 to prevent retries for processing errors
    res.status(200).json({ received: true });
  }
}

async function processTenantWebhook(req: Request, res: Response, tenantId: string): Promise<void> {
  // The legacy Paystack URL: the provider is fixed by the route. The neutral route (M3b-T06) takes it from the path.
  const provider = getPaymentProvider('paystack');

  // Use rawBody preserved by the verify callback in server.ts (avoids express.json() parsing issue)
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    logger.error('Paystack webhook: rawBody not available — check server.ts verify callback');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }
  const isValid = await provider.verifyWebhook(tenantId, rawBody, req.headers);
  if (!isValid) {
    logger.warn('Invalid Paystack webhook signature', { tenantId });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const event = provider.parseWebhook(rawBody);
  logger.info('Paystack webhook received', { tenantId: tenantId, event: event.eventType });

  await withWebhookDedup(
    res,
    {
      provider: provider.id,
      eventType: event.eventType,
      reference: event.eventType ? event.reference ?? undefined : undefined,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      tenantId,
    },
    'Paystack',
    async () => {
      if (event.kind === 'payment_succeeded') {
        await handleChargeSuccess(tenantId, event.reference);
      }
    }
  );
}

/**
 * Webhook charge.success handler. Settlement is delegated to the shared
 * settlement service (deferred-creation model): the order is created from the
 * pending checkout the first time a confirmed payment arrives — here or via the
 * callback verify, whichever is first. Idempotent.
 */
async function handleChargeSuccess(tenantId: string, reference: string | null): Promise<void> {
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
