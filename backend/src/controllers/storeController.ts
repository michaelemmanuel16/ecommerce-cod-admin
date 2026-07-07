import { Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { AuthRequest } from '../types';
import { prismaBase } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { mintTokens } from '../utils/mintTokens';
import { deleteStoreData } from '../services/storeDeletionService';

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
