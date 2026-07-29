import { Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { AuthRequest } from '../types';
import { prismaBase } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { mintTokens } from '../utils/mintTokens';
import { deleteStoreData } from '../services/storeDeletionService';
import { platformPaystackService } from '../services/platformPaystackService';
import { slugify, perStoreBillingEmail } from '../utils/slug';
import { SUBSCRIPTION_STATUS, SELF_SERVE_PLAN_NAMES } from '../config/billing';

/**
 * GET /api/stores — list the stores the caller owns (their StoreMembership rows).
 * Not behind requireResolvedTenant: an owner sitting on a null/pending active
 * store must still be able to see and switch stores. StoreMembership is not
 * tenant-scoped; read through prismaBase to stay off the ambient scope.
 */
export const getStores = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);

    const memberships = await prismaBase.storeMembership.findMany({
      where: { userId: req.user.id },
      select: {
        tenantId: true,
        role: true,
        isDefault: true,
        tenant: { select: { name: true, slug: true, subscriptionStatus: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const activeTenantId = req.user.tenantId ?? null;

    res.json({
      stores: memberships.map((m) => ({
        tenantId: m.tenantId,
        name: m.tenant.name,
        slug: m.tenant.slug,
        subscriptionStatus: m.tenant.subscriptionStatus,
        role: m.role,
        isDefault: m.isDefault,
        isActive: m.tenantId === activeTenantId,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/stores — provision an ADDITIONAL store for the caller (MAN-89).
 *
 * Pay-before-materialize: create the Tenant as `pending` + the owner's
 * StoreMembership + a per-store billing email, then kick off a Paystack
 * subscription and hand back the authorization_url. The store stays `pending`
 * (requireResolvedTenant 402s its data routes) until charge.success activates it
 * via the platform webhook — this endpoint never marks a store active itself.
 *
 * The per-store billing email (owner+store-<slug>@domain) makes Paystack mint a
 * DISTINCT customer per store, which is what makes webhook routing unambiguous.
 *
 * Not behind requireResolvedTenant: an owner provisions store 2 while their
 * active store may be pending/none.
 */
export const createStore = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);
    const ownerEmail = req.user.email;
    if (!ownerEmail) throw new AppError('Owner email required', 400);

    const name = (req.body?.name ?? '').toString().trim();
    if (!name) throw new AppError('name is required', 400);
    const planName = (req.body?.planName ?? req.body?.planId)?.toString();
    if (!planName) throw new AppError('planName is required', 400);

    // Resolve + validate the plan up front (server-computed amount, never trusted
    // from the client). Only self-serve tiers with a Paystack plan code + price.
    const plan = await prismaBase.plan.findFirst({ where: { name: planName, isActive: true } });
    if (!plan || !SELF_SERVE_PLAN_NAMES.includes(plan.name as any)) {
      throw new AppError('Invalid plan selected. Choose Growth or Scale.', 400);
    }
    if (!plan.paystackPlanCode || plan.priceNGN == null) {
      throw new AppError('This plan is not available for self-serve subscription', 400);
    }

    // Create the pending store + membership atomically. The owner user already
    // exists (req.user), so ownerUserId is set inline — no two-step link.
    const { tenantId, billingEmail } = await prismaBase.$transaction(async (tx) => {
      const baseSlug = slugify(name) || 'store';
      let slug = baseSlug;
      let suffix = 1;
      while (await tx.tenant.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${suffix++}`;
      }
      const billingEmail = perStoreBillingEmail(ownerEmail, slug);
      const tenant = await tx.tenant.create({
        data: {
          name,
          slug,
          currentPlanId: plan.id,
          subscriptionStatus: SUBSCRIPTION_STATUS.PENDING,
          billingEmail,
          ownerUserId: req.user!.id,
        },
        select: { id: true },
      });
      await tx.storeMembership.create({
        data: { userId: req.user!.id, tenantId: tenant.id, role: 'super_admin', isDefault: false },
      });
      return { tenantId: tenant.id, billingEmail };
    });

    // External Paystack call AFTER the store commit. If it fails, the store still
    // exists as `pending`; the owner retries payment and its data routes stay
    // locked until charge.success. Metadata carries tenantId so the webhook binds
    // the correct store.
    const amountMinor = Math.round(Number(plan.priceNGN) * 100);
    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings/billing/callback`;
    const result = await platformPaystackService.initializeSubscriptionTransaction(
      billingEmail,
      plan.paystackPlanCode,
      amountMinor,
      { tenantId, planId: plan.id, planName: plan.name, kind: 'saas_subscription' },
      callbackUrl,
    );

    res.status(201).json({
      tenantId,
      billingEmail,
      authorizationUrl: result.authorization_url,
      reference: result.reference,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/stores/switch { tenantId } — re-issue a token scoped to a store the
 * caller owns. 403 if the target is not one of their memberships. Single-active-
 * session: the new refresh token overwrites the old one, so the previous tab's
 * refresh token stops working (registry #5, v1 decision).
 */
export const switchStore = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);

    const { tenantId } = req.body ?? {};
    if (!tenantId || typeof tenantId !== 'string') {
      throw new AppError('tenantId is required', 400);
    }

    const membership = await prismaBase.storeMembership.findFirst({
      where: { userId: req.user.id, tenantId },
      select: { id: true },
    });
    if (!membership) {
      throw new AppError('Not a member of that store', 403, 'NOT_A_MEMBER');
    }

    const user = await prismaBase.user.findFirst({
      where: { id: req.user.id, isActive: true },
      select: { id: true, email: true, role: true, tenantId: true },
    });
    if (!user) throw new AppError('User not found', 404);

    // Explicit target = the store being switched to; mintTokens validates it
    // resolves (it does — it is a confirmed membership) and fails closed otherwise.
    const { accessToken, refreshToken } = await mintTokens(user, tenantId);

    await prismaBase.user.update({
      where: { id: user.id },
      data: { refreshToken },
    });

    res.json({ accessToken, refreshToken, activeTenantId: tenantId });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/stores/:id — delete-THIS-store. Owner-scoped (Tenant.ownerUserId),
 * requires the store name typed back + the owner's password, and refuses to
 * delete the owner's only store. Removes just this store's data; the owner and
 * their other stores survive. Whole-account deletion is DELETE /api/auth/account.
 */
export const deleteStore = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);
    const storeId = req.params.id;
    const { password, confirmName } = req.body ?? {};

    const tenant = await prismaBase.tenant.findUnique({
      where: { id: storeId },
      select: { ownerUserId: true, name: true },
    });
    if (!tenant) throw new AppError('Store not found', 404);
    if (tenant.ownerUserId !== req.user.id) {
      throw new AppError('Only the store owner can delete this store', 403);
    }
    if (confirmName !== tenant.name) {
      throw new AppError('Store name confirmation does not match', 400);
    }

    const user = await prismaBase.user.findFirst({ where: { id: req.user.id, isActive: true }, select: { password: true } });
    if (!user) throw new AppError('User not found', 404);
    const valid = await bcrypt.compare(password ?? '', user.password);
    if (!valid) throw new AppError('Incorrect password', 401);

    // Never leave an owner with zero stores — that would strand them.
    const owned = await prismaBase.tenant.count({ where: { ownerUserId: req.user.id } });
    if (owned <= 1) throw new AppError('You cannot delete your only store', 400);

    await prismaBase.$transaction(async (tx) => {
      await deleteStoreData(tx, storeId);
    });

    res.json({ message: 'Store and its data have been permanently deleted' });
  } catch (error) {
    next(error);
  }
};
