import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { platformPaystackService } from '../services/platformPaystackService';
import {
  bindSubscription,
  resolveTenantByCustomerCode,
  resolveTenantBySubscriptionCode,
  resolveTenantById,
} from '../services/platformBillingService';
import { SUBSCRIPTION_STATUS } from '../config/billing';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

const PROVIDER = 'paystack-platform';

/**
 * Platform Paystack webhook (MAN-61). Reconciles CodAdmin's OWN subscription
 * billing — the inverse of the per-tenant buyer webhook. HMAC is verified with the
 * platform secret; the tenant is resolved from the event payload (customer code,
 * subscription code, or metadata.tenantId) and validated, never trusted blindly.
 *
 * NOTE: raw body for HMAC is preserved by the verify callback in server.ts, which
 * must include '/api/paystack/platform-webhook' — without it every call 500s.
 */
export async function handlePlatformWebhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['x-paystack-signature'] as string;
    if (!signature) {
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      logger.error('Platform webhook: rawBody not available — check server.ts verify callback');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    if (!platformPaystackService.validateWebhookSignature(rawBody, signature)) {
      logger.warn('Invalid platform Paystack webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const event = req.body;
    const data = event?.data ?? {};

    // Resolve (and validate) the owning tenant from the payload.
    const tenantId = await resolveTenantForEvent(event.event, data);
    if (!tenantId) {
      // Unresolvable (e.g. a non-subscription charge or an event for a tenant we
      // don't track). Ack so Paystack stops retrying; nothing to do.
      logger.info('Platform webhook: no matching tenant, ignored', { eventType: event?.event });
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    // Idempotency gate (tenant-scoped). reference falls back through the codes a
    // given event carries, then the payload hash, so every event type dedupes.
    const reference: string =
      data.reference ||
      data.subscription_code ||
      data.subscription?.subscription_code ||
      data.invoice_code ||
      createHash('sha256').update(rawBody).digest('hex');
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    let dedupRowId: number | null = null;
    try {
      const created = await prisma.webhookEvent.create({
        data: { provider: PROVIDER, eventType: event.event, reference, payloadHash, tenantId },
        select: { id: true },
      });
      dedupRowId = created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        logger.info('Platform webhook replay ignored', { tenantId, eventType: event.event, reference });
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
      throw err;
    }

    try {
      await dispatchEvent(event.event, data, tenantId);
    } catch (processingError) {
      // Remove the dedup row so Paystack's retries can re-enter the handler.
      if (dedupRowId !== null) {
        try {
          await prisma.webhookEvent.delete({ where: { id: dedupRowId } });
        } catch (cleanupError: any) {
          logger.error('Failed to delete platform dedup row after processing error', {
            dedupRowId,
            error: cleanupError.message,
          });
        }
      }
      throw processingError;
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error('Platform webhook error', { error: error.message });
    // 200 so transient processing errors don't trigger a retry storm; the dedup
    // row was already removed above so a genuine retry can reprocess.
    res.status(200).json({ received: true });
  }
}

async function resolveTenantForEvent(eventType: string, data: any): Promise<string | null> {
  switch (eventType) {
    case 'subscription.create':
      return resolveTenantByCustomerCode(data.customer?.customer_code);
    case 'charge.success': {
      // Only subscription charges concern us; ignore one-off charges.
      if (data.metadata?.kind !== 'saas_subscription') return null;
      return (
        (await resolveTenantById(data.metadata?.tenantId)) ||
        (await resolveTenantByCustomerCode(data.customer?.customer_code))
      );
    }
    case 'invoice.payment_failed':
      return resolveTenantBySubscriptionCode(
        data.subscription?.subscription_code || data.subscription_code,
      );
    case 'subscription.disable':
    case 'subscription.not_renew':
      return resolveTenantBySubscriptionCode(data.subscription_code || data.subscription?.subscription_code);
    default:
      return null;
  }
}

async function dispatchEvent(eventType: string, data: any, tenantId: string): Promise<void> {
  const nextPaymentDate = parseDate(data.next_payment_date || data.subscription?.next_payment_date);
  const planCode = data.plan?.plan_code || data.plan_object?.plan_code || data.metadata?.planId;
  const amountNGN = typeof data.amount === 'number' ? data.amount / 100 : undefined;

  // Structured log line (F3) so subscribe/charge/fail are traceable.
  logger.info('Platform billing event', { tenantId, event: eventType, plan: planCode, amountNGN });

  switch (eventType) {
    case 'subscription.create':
      await bindSubscription(tenantId, {
        paystackSubscriptionCode: data.subscription_code,
        paystackCustomerCode: data.customer?.customer_code,
        subscriptionRenewsAt: nextPaymentDate,
      });
      return;

    case 'charge.success':
      // Recurring renewal succeeded (or first charge). Mark active, clear failure,
      // bump renews-at when the payload carries it.
      await bindSubscription(tenantId, {
        paystackCustomerCode: data.customer?.customer_code,
        subscriptionRenewsAt: nextPaymentDate,
      });
      return;

    case 'invoice.payment_failed':
      // Set past_due + stamp the first failure (don't overwrite an earlier stamp).
      await prisma.tenant.updateMany({
        where: { id: tenantId, paymentFailedAt: null },
        data: { subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE, paymentFailedAt: new Date() },
      });
      // Ensure status reflects past_due even if a stamp already existed.
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE },
      });
      return;

    case 'subscription.disable':
    case 'subscription.not_renew':
      // Cancelled at Paystack; keep access until the cycle end (renews-at unchanged).
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { subscriptionStatus: SUBSCRIPTION_STATUS.CANCELLED },
      });
      return;

    default:
      logger.info('Platform webhook: unhandled event type', { eventType, tenantId });
  }
}

function parseDate(value: unknown): Date | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
