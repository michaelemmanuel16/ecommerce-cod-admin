import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { getPaymentProvider, type PaymentProvider } from '../services/payments';
import { findReferenceOwner, settlePayment } from '../services/paystackSettlementService';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { runInTenant } from '../utils/tenantContext';
import { withWebhookDedup } from '../utils/webhookDedup';
import { formatOrderNumber } from '../utils/orderNumber';

/** Provider the request names. The old Paystack URL has no `:provider`, so it is Paystack. */
function providerOf(req: Request): PaymentProvider | null {
  try {
    return getPaymentProvider(req.params.provider ?? 'paystack');
  } catch {
    return null;
  }
}

/**
 * Payment webhook handler — called by a provider when a payment succeeds
 * (`POST /api/payments/webhook/:provider/:tenantSlug`, and the old
 * `POST /api/paystack/webhook/:tenantSlug` as an alias for Paystack).
 * Uses raw body for signature verification, scoped to the URL tenant.
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    const provider = providerOf(req);
    if (!provider) {
      res.status(404).json({ error: 'Unknown payment provider' });
      return;
    }

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
    await runInTenant(tenant.id, () => processTenantWebhook(req, res, provider, tenant.id));
  } catch (error: any) {
    logger.error('Payment webhook error', { error: error.message });
    // Still return 200 to prevent retries for processing errors
    res.status(200).json({ received: true });
  }
}

async function processTenantWebhook(req: Request, res: Response, provider: PaymentProvider, tenantId: string): Promise<void> {
  // Use rawBody preserved by the verify callback in server.ts (avoids express.json() parsing issue)
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    logger.error('Payment webhook: rawBody not available — check server.ts verify callback', { tenantId, provider: provider.id });
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }
  const isValid = await provider.verifyWebhook(tenantId, rawBody, req.headers);
  if (!isValid) {
    logger.warn('Invalid payment webhook signature', { tenantId, provider: provider.id, event: null, result: 'bad_signature' });
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const event = provider.parseWebhook(rawBody);
  const log = (result: string) => logger.info('Payment webhook', { tenantId, provider: provider.id, event: event.eventType, result });

  if (event.kind !== 'payment_succeeded') {
    log('ignored');
    res.status(200).json({ received: true });
    return;
  }

  // A reference that belongs to another tenant is refused before the replay gate, so no WebhookEvent row is written.
  if (event.reference) {
    const owner = await findReferenceOwner(event.reference);
    if (owner && owner !== tenantId) {
      logger.warn('Payment webhook for a reference of another tenant — ignoring', { reference: event.reference, webhookTenantId: tenantId });
      log('wrong_tenant');
      res.status(404).json({ error: 'Reference not found' });
      return;
    }
  }

  const result = await withWebhookDedup(
    res,
    {
      provider: provider.id,
      eventType: event.eventType,
      reference: event.reference ?? undefined,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
      tenantId,
    },
    'Payment',
    () => handleChargeSuccess(tenantId, event.reference),
  );
  log(result ?? 'replay');
}

/**
 * Webhook payment_succeeded handler. Settlement is delegated to the shared
 * settlement service (deferred-creation model): the order is created from the
 * pending checkout the first time a confirmed payment arrives — here, via the
 * callback verify or the sweep, whichever is first. Idempotent.
 * Returns the result word for the webhook log line.
 */
async function handleChargeSuccess(tenantId: string, reference: string | null): Promise<string> {
  if (!reference) {
    logger.error('Payment webhook: success event without a reference', { tenantId });
    return 'no_reference';
  }

  const result = await settlePayment(reference, { webhookTenantId: tenantId });
  if (result.status === 'not_found') {
    // Unknown to every tenant: answer 200 so the provider stops retrying.
    logger.warn('Payment webhook for a reference no checkout owns — ignored', { tenantId, reference });
    return 'unknown_reference';
  }
  return result.status;
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

    const result = await settlePayment(reference);
    if (result.status === 'not_found' || !result.order) {
      res.status(404).json({ error: 'No checkout found for this payment reference' });
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
 * Public payment verification: GET /api/payments/verify/:reference (alias /api/paystack/verify/:reference).
 * Used by the payment callback page. Settlement re-verifies with the provider before doing anything, so an order is
 * recorded even if the webhook never fires. The reference is the unguessable secret.
 *
 * The body carries the outcome and nothing else (F-403): no customer data, no amounts, no ids. The email is returned only
 * for a paid digital order, masked ("a***@gmail.com"), so the page can say where the download link went.
 * A reference is looked up under the tenant that owns it, so it never shows another tenant's data; an unknown reference
 * is `not_found`.
 */
export async function publicVerifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const { reference } = req.params;
    if (!reference) {
      res.status(400).json({ error: 'Reference is required' });
      return;
    }

    const result = await settlePayment(reference);
    if (result.status === 'not_found') {
      res.json({ status: 'not_found', orderType: null, formSlug: null });
      return;
    }

    const tenantId = await findReferenceOwner(reference);
    const where = tenantId
      ? await runInTenant(tenantId, () => describeOutcome(reference, result.order))
      : { orderType: null, formSlug: null, redirectUrl: null };
    const order = result.order;
    const digitalSuccess = result.status === 'success' && where.orderType === 'digital';
    const email = digitalSuccess ? maskEmail((order as { customer?: { email?: string | null } } | null | undefined)?.customer?.email) : null;

    res.json({
      status: result.status,
      ...(result.status === 'success' && order ? { orderNumber: formatOrderNumber(order.id) } : {}),
      orderType: where.orderType,
      formSlug: where.formSlug,
      ...(result.status === 'success' && where.redirectUrl ? { redirectUrl: where.redirectUrl } : {}),
      ...(email ? { email } : {}),
    });
  } catch (error: any) {
    logger.error('Public payment verification failed', { error: error.message });
    res.status(500).json({ error: 'Could not check this payment' });
  }
}

/** "ama@gmail.com" gives "a***@gmail.com". Null when there is no usable address. */
export function maskEmail(email?: string | null): string | null {
  const at = email ? email.indexOf('@') : -1;
  return email && at > 0 ? `${email[0]}***${email.slice(at)}` : null;
}

/** The order type, form slug and thank-you page of a payment, from its order or its pending checkout. Runs inside the owning tenant. */
async function describeOutcome(reference: string, order?: { id: number; orderType?: string | null } | null) {
  let orderType: string | null = order?.orderType ?? null;
  let formId: number | null = null;
  if (order) {
    formId = (await prisma.formSubmission.findFirst({ where: { orderId: order.id }, select: { formId: true } }))?.formId ?? null;
  } else {
    const pending = await prisma.pendingCheckout.findUnique({ where: { reference }, select: { formId: true, orderType: true } });
    orderType = pending?.orderType ?? null;
    formId = pending?.formId ?? null;
  }
  const form = formId != null
    ? await prisma.checkoutForm.findFirst({ where: { id: formId }, select: { slug: true, redirectUrl: true } })
    : null;
  return { orderType, formSlug: form?.slug ?? null, redirectUrl: form?.redirectUrl ?? null };
}
