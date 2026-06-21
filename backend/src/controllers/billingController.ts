import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { getTenantId } from '../utils/tenantContext';
import { SUBSCRIPTION_STATUS } from '../config/billing';
import {
  platformPaystackService,
  isPlatformBillingConfigured,
} from '../services/platformPaystackService';
import { bindSubscription } from '../services/platformBillingService';
import logger from '../utils/logger';

/**
 * GET /api/billing/plans — list all active plans (public)
 */
export const listPlans = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceGHS: 'asc' },
    });
    res.json({ plans });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/billing/subscription — current tenant subscription + usage
 */
export const getSubscription = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = getTenantId();
    if (!tenantId) throw new AppError('Tenant context required', 401);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });
    if (!tenant) throw new AppError('Tenant not found', 404);

    // Current month order count
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const orderCount = await prisma.order.count({
      where: { tenantId, createdAt: { gte: monthStart } },
    });

    const plan = tenant.currentPlan;

    res.json({
      plan,
      subscriptionStatus: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
      subscriptionCode: tenant.paystackSubscriptionCode,
      renewsAt: tenant.subscriptionRenewsAt,
      paymentFailedAt: tenant.paymentFailedAt,
      cardLast4: tenant.paystackCardLast4,
      freeAccessExpiresAt: tenant.freeAccessExpiresAt,
      nextChargeAmount: plan?.priceNGN ?? null,
      // F2: lets the frontend render pricing/billing read-only and hide subscribe
      // CTAs when the platform keys are absent — never a 500.
      billingEnabled: isPlatformBillingConfigured(),
      usage: {
        ordersThisMonth: orderCount,
        maxOrders: plan?.maxOrders ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/billing/start-subscription — begin a Paystack subscription for the
 * tenant's chosen tier (super_admin). Returns the Paystack authorization URL.
 */
export const startSubscription = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = getTenantId();
    if (!tenantId) throw new AppError('Tenant context required', 401);

    const planName = (req.body.planName ?? req.body.planId)?.toString();
    if (!planName) throw new AppError('planName is required', 400);

    const plan = await prisma.plan.findFirst({ where: { name: planName, isActive: true } });
    if (!plan) throw new AppError(`Plan '${planName}' not found`, 404);
    // Blocks Enterprise (no plan code) and Free (no price): those never self-subscribe.
    if (!plan.paystackPlanCode || plan.priceNGN == null) {
      throw new AppError('This plan is not available for self-serve subscription', 400);
    }

    const email = req.user?.email;
    if (!email) throw new AppError('User email required', 400);

    // Amount is server-computed from the Plan row — never trusted from the client.
    const amountMinor = Math.round(Number(plan.priceNGN) * 100);
    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings/billing/callback`;

    const result = await platformPaystackService.initializeSubscriptionTransaction(
      email,
      plan.paystackPlanCode,
      amountMinor,
      { tenantId, planId: plan.id, planName: plan.name, kind: 'saas_subscription' },
      callbackUrl,
    );

    res.json({ authorizationUrl: result.authorization_url, reference: result.reference });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/billing/verify-subscription/:reference — confirm a Paystack
 * transaction and bind the subscription to the tenant (super_admin).
 */
export const verifySubscription = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = getTenantId();
    if (!tenantId) throw new AppError('Tenant context required', 401);

    const { reference } = req.params;
    if (!reference) throw new AppError('reference is required', 400);

    const result = await platformPaystackService.verifyTransaction(reference);
    const data = result?.data;
    if (!data || data.status !== 'success') {
      throw new AppError('Payment was not successful', 400, 'PAYMENT_NOT_SUCCESSFUL');
    }

    // Cross-tenant guard: a verified transaction can only bind to the tenant named
    // in its metadata, never to whoever is calling.
    const metaTenantId = data.metadata?.tenantId as string | undefined;
    if (metaTenantId && metaTenantId !== tenantId) {
      throw new AppError('Subscription does not belong to this tenant', 403);
    }

    await bindSubscription(tenantId, {
      currentPlanId: data.metadata?.planId as string | undefined,
      paystackCustomerCode: data.customer?.customer_code,
      paystackAuthorizationCode: data.authorization?.authorization_code,
      paystackCardLast4: data.authorization?.last4,
      paystackSubscriptionCode: data.subscription_code,
      subscriptionRenewsAt: data.next_payment_date ? new Date(data.next_payment_date) : undefined,
    });

    logger.info('Subscription verified + bound', { tenantId, reference });
    res.json({ status: 'active' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/billing/cancel-subscription — disable the tenant's Paystack
 * subscription; access continues until the current cycle ends (super_admin).
 */
export const cancelSubscription = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = getTenantId();
    if (!tenantId) throw new AppError('Tenant context required', 401);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { paystackSubscriptionCode: true, subscriptionRenewsAt: true },
    });
    if (!tenant?.paystackSubscriptionCode) {
      throw new AppError('No active subscription to cancel', 400);
    }

    // Paystack requires the email_token (from the subscription) to disable it.
    const sub = await platformPaystackService.getSubscription(tenant.paystackSubscriptionCode);
    const emailToken = sub?.data?.email_token;
    if (!emailToken) throw new AppError('Could not cancel subscription (missing token)', 502);

    await platformPaystackService.disableSubscription(tenant.paystackSubscriptionCode, emailToken);
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { subscriptionStatus: SUBSCRIPTION_STATUS.CANCELLED },
    });

    res.json({ status: 'cancelled', accessUntil: tenant.subscriptionRenewsAt });
  } catch (err) {
    next(err);
  }
};
