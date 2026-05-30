import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { getTenantId } from '../utils/tenantContext';
import { SUBSCRIPTION_STATUS } from '../config/billing';
import { paystackService } from '../services/paystackService';

function amountToMinorUnits(amount: unknown): number {
  return Math.round(Number(amount) * 100);
}

function getBillingCallbackUrl(): string | undefined {
  if (process.env.BILLING_CALLBACK_URL) return process.env.BILLING_CALLBACK_URL;
  if (process.env.FRONTEND_URL) return `${process.env.FRONTEND_URL.replace(/\/$/, '')}/billing`;
  return undefined;
}

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
 * POST /api/billing/start-subscription/:planId — start Paystack hosted checkout
 */
export const startSubscription = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = getTenantId();
    if (!tenantId) throw new AppError('Tenant context required', 401);
    if (!req.user?.email) throw new AppError('Authenticated user email required', 401);

    const { planId } = req.params;
    if (!planId) throw new AppError('planId is required', 400);

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new AppError('Plan not found', 404);
    if (!plan.paystackPlanCode) {
      throw new AppError('This plan is not linked to a Paystack plan code yet', 400);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    });
    if (!tenant) throw new AppError('Tenant not found', 404);

    const checkout = await paystackService.initializeSubscription(
      req.user.email,
      amountToMinorUnits(plan.priceGHS),
      tenant.currency || 'GHS',
      plan.paystackPlanCode,
      {
        tenantId,
        planId: plan.id,
        planName: plan.name,
      },
      getBillingCallbackUrl(),
    );

    res.json({
      authorizationUrl: checkout.authorization_url,
      accessCode: checkout.access_code,
      reference: checkout.reference,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/billing/cancel-subscription — disable the tenant's Paystack subscription
 */
export const cancelSubscription = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = getTenantId();
    if (!tenantId) throw new AppError('Tenant context required', 401);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        paystackSubscriptionCode: true,
        paystackSubscriptionToken: true,
      },
    });
    if (!tenant) throw new AppError('Tenant not found', 404);
    if (!tenant.paystackSubscriptionCode || !tenant.paystackSubscriptionToken) {
      throw new AppError('No active Paystack subscription is stored for this tenant', 400);
    }

    await paystackService.disableSubscription(
      tenant.paystackSubscriptionCode,
      tenant.paystackSubscriptionToken,
    );

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        subscriptionStatus: SUBSCRIPTION_STATUS.CANCELLED,
        paystackSubscriptionCode: null,
        paystackSubscriptionToken: null,
        paystackAuthorizationCode: null,
        subscriptionRenewsAt: null,
      },
      include: { currentPlan: true },
    });

    res.json({ message: 'Subscription cancelled', tenant: updatedTenant });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/billing/upgrade — manually change tenant plan (super_admin only)
 */
export const upgradePlan = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = getTenantId();
    if (!tenantId) throw new AppError('Tenant context required', 401);

    const { planName } = req.body;
    if (!planName) throw new AppError('planName is required', 400);

    const plan = await prisma.plan.findUnique({ where: { name: planName } });
    if (!plan) throw new AppError(`Plan '${planName}' not found`, 404);

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        currentPlanId: plan.id,
        subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
      },
      include: { currentPlan: true },
    });

    res.json({ message: `Plan updated to ${plan.displayName}`, tenant });
  } catch (err) {
    next(err);
  }
};
