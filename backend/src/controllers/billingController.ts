import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { getTenantId } from '../utils/tenantContext';

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

    const plan = tenant.currentPlan ?? (await prisma.plan.findUnique({ where: { name: tenant.plan } }));

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
        plan: plan.name,
        currentPlanId: plan.id,
        subscriptionStatus: 'active',
      },
      include: { currentPlan: true },
    });

    res.json({ message: `Plan updated to ${plan.displayName}`, tenant });
  } catch (err) {
    next(err);
  }
};
