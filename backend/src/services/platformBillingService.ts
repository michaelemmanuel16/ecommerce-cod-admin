import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { SUBSCRIPTION_STATUS } from '../config/billing';

/**
 * Shared SaaS-subscription binding logic (MAN-61), used by both the platform
 * webhook controller and the verify-subscription callback. The two can arrive in
 * either order, so binding is idempotent and "first writer wins" for identity
 * codes — neither path clobbers a code the other already wrote.
 */

export interface SubscriptionBindFields {
  currentPlanId?: string | null;
  paystackCustomerCode?: string | null;
  paystackAuthorizationCode?: string | null;
  paystackSubscriptionCode?: string | null;
  paystackCardLast4?: string | null;
  subscriptionRenewsAt?: Date | null;
}

/**
 * Bind a successful subscription to a tenant: mark it active, clear any prior
 * payment failure, and persist the Paystack identity codes. Identity codes are
 * first-writer-wins (never overwritten once set); the plan, card last-4, and
 * renews-at always reflect the latest known value.
 */
export async function bindSubscription(tenantId: string, fields: SubscriptionBindFields): Promise<void> {
  const current = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      paystackCustomerCode: true,
      paystackAuthorizationCode: true,
      paystackSubscriptionCode: true,
    },
  });
  if (!current) {
    logger.warn('bindSubscription: tenant not found', { tenantId });
    return;
  }

  const data: Record<string, unknown> = {
    subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
    paymentFailedAt: null,
  };

  // First-writer-wins: only set an identity code if it is not already stored.
  if (fields.paystackCustomerCode && !current.paystackCustomerCode) {
    data.paystackCustomerCode = fields.paystackCustomerCode;
  }
  if (fields.paystackAuthorizationCode && !current.paystackAuthorizationCode) {
    data.paystackAuthorizationCode = fields.paystackAuthorizationCode;
  }
  if (fields.paystackSubscriptionCode && !current.paystackSubscriptionCode) {
    data.paystackSubscriptionCode = fields.paystackSubscriptionCode;
  }

  // Always reflect the latest plan / card / renewal where provided.
  if (fields.currentPlanId) data.currentPlanId = fields.currentPlanId;
  if (fields.paystackCardLast4) data.paystackCardLast4 = fields.paystackCardLast4;
  if (fields.subscriptionRenewsAt) data.subscriptionRenewsAt = fields.subscriptionRenewsAt;

  await prisma.tenant.update({ where: { id: tenantId }, data });
}

/** Resolve a tenant by their stored Paystack customer code (webhook routing). */
export async function resolveTenantByCustomerCode(code?: string | null): Promise<string | null> {
  if (!code) return null;
  const t = await prisma.tenant.findFirst({ where: { paystackCustomerCode: code }, select: { id: true } });
  return t?.id ?? null;
}

/** Resolve a tenant by their stored Paystack subscription code. */
export async function resolveTenantBySubscriptionCode(code?: string | null): Promise<string | null> {
  if (!code) return null;
  const t = await prisma.tenant.findFirst({ where: { paystackSubscriptionCode: code }, select: { id: true } });
  return t?.id ?? null;
}

/**
 * Resolve a tenant by an id supplied in event metadata, but only after confirming
 * the tenant exists — never trust the id blindly (cross-tenant binding guard).
 */
export async function resolveTenantById(id?: string | null): Promise<string | null> {
  if (!id) return null;
  const t = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  return t?.id ?? null;
}
