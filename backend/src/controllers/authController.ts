import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { AuthRequest } from '../types';
import prisma, { prismaBase } from '../utils/prisma';
import { deleteStoreData, deleteOwnerReferences } from '../services/storeDeletionService';
import { verifyRefreshToken } from '../utils/jwt';
import { mintTokens, mintAccessToken } from '../utils/mintTokens';
import { getCurrentUser, updateCurrentUser } from '../utils/currentUser';
import { slugify } from '../utils/slug';
import { AppError } from '../middleware/errorHandler';
import { adminService } from '../services/adminService';
import { sendPasswordResetEmail } from '../services/emailService';
import { SUBSCRIPTION_STATUS, SELF_SERVE_PLAN_NAMES } from '../config/billing';

export const register = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, firstName, lastName, phoneNumber, role } = req.body;

    if (!password || password.length > 72) {
      throw new AppError('Password is required and must be 72 characters or fewer', 400);
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError('User already exists', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phoneNumber,
        role
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        commissionAmount: true,
        deliveryRate: true,
        createdAt: true
      }
    });

    // Generate tokens (fail-closed mint — never a null-tenant token)
    const { accessToken, refreshToken } = await mintTokens(user);

    // Save refresh token
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });

    // Get user permissions from system config
    const allPermissions = await adminService.getRolePermissions(req.user as any) as Record<string, any>;
    const userPermissions = allPermissions[user.role] || {};

    res.status(201).json({
      message: 'User registered successfully',
      user,
      tokens: {
        accessToken,
        refreshToken
      },
      permissions: userPermissions
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!user.isActive) {
      throw new AppError('Account is deactivated', 403);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    const { accessToken, refreshToken } = await mintTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken,
        lastLogin: new Date()
      }
    });

    // Get user permissions from system config
    const allPermissions = await adminService.getRolePermissions(req.user as any) as Record<string, any>;
    const userPermissions = allPermissions[user.role] || {};

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isPlatformAdmin: user.isPlatformAdmin || false,
        commissionAmount: user.commissionAmount || 0,
        deliveryRate: user.deliveryRate,
        preferences: user.preferences,
      },
      tokens: {
        accessToken,
        refreshToken
      },
      permissions: userPermissions
    });
  } catch (error) {
    next(error);
  }
};

export const refresh = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token required', 400);
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (jwtError: any) {
      if (jwtError.message === 'TOKEN_FORMAT_OUTDATED') {
        throw new AppError('Token format outdated. Please log in again.', 401, 'TOKEN_FORMAT_OUTDATED');
      }
      throw new AppError('Session expired. Please log in again.', 401, 'SESSION_EXPIRED');
    }

    // Validate ID type - handle migration from string (CUID) to integer IDs
    if (typeof decoded.id !== 'number') {
      // Token contains old string ID (from pre-migration era)
      // Force user to re-login to get new token with integer ID
      throw new AppError('Token format outdated. Please log in again.', 401, 'TOKEN_FORMAT_OUTDATED');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    // SECURITY: Use timing-safe comparison to prevent timing attacks on refresh tokens
    const isValidToken = user && user.refreshToken && refreshToken &&
      user.refreshToken.length === refreshToken.length &&
      crypto.timingSafeEqual(Buffer.from(user.refreshToken), Buffer.from(refreshToken));
    if (!user || !isValidToken) {
      throw new AppError('Invalid refresh token', 401);
    }

    // Preserve the active store the refresh token was minted for (decoded.tenantId)
    // rather than re-resolving to default; still fail-closed via mintAccessToken.
    const { accessToken: newAccessToken } = await mintAccessToken(user, decoded.tenantId);

    res.json({
      accessToken: newAccessToken
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user) {
      // Unscoped: a null-tenant owner's active store must not filter out their
      // own row, or the refresh-token clear silently no-ops and logout is a lie.
      await updateCurrentUser(req.user.id, { refreshToken: null });
    }

    res.json({ message: 'Logout successful' });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.isActive && (user.role === 'super_admin' || user.role === 'admin')) {
      try {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expires = new Date(Date.now() + 15 * 60 * 1000);

        // Unscoped write (MAN-94 owner carve-out): a null-tenant owner's own row
        // must not be filtered out by an ambient active-store scope.
        await updateCurrentUser(user.id, {
          passwordResetToken: hashedToken,
          passwordResetExpires: expires,
        });

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

        await sendPasswordResetEmail(email, user.firstName, resetUrl);
      } catch (e) {
        console.error('Password reset email send failed:', e);
      }
    }

    res.json({ message: "If an account exists with that email, we've sent a reset link" });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { token, password } = req.body;

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new AppError('Invalid or expired reset token', 400);
    }

    if (!password || password.length > 72) {
      throw new AppError('Password is required and must be 72 characters or fewer', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Unscoped write (MAN-94 owner carve-out): reset must succeed for a
    // null-tenant owner, and it also invalidates their session (refreshToken).
    await updateCurrentUser(user.id, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
      refreshToken: null,
    });

    res.json({ message: 'Password reset successful. Please log in with your new password.' });
  } catch (error) {
    next(error);
  }
};

export const me = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Unauthorized', 401);
    }

    // Unscoped identity read: a null-tenant owner must resolve to their own row
    // regardless of which store is active.
    const user = await getCurrentUser(req.user.id, {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phoneNumber: true,
      role: true,
      isActive: true,
      isAvailable: true,
      createdAt: true
    });

    // Get user permissions from system config
    const allPermissions = await adminService.getRolePermissions(req.user as any) as Record<string, any>;
    const userPermissions = allPermissions[user?.role || ''] || {};

    res.json({ user, permissions: userPermissions });
  } catch (error) {
    next(error);
  }
};

// Slugify helper
export const registerTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { companyName, adminEmail, adminPassword, adminName } = req.body;
    // Pricing-first registration (MAN-61): the chosen tier arrives as a plan name
    // (growth/scale). Optional — admin-created tenants may register without one.
    // Alias `planId` is accepted for the frontend's field name.
    const planName: string | undefined = (req.body.planName ?? req.body.planId)?.toString() || undefined;

    if (!companyName || !adminEmail || !adminPassword || !adminName) {
      throw new AppError('companyName, adminEmail, adminPassword, and adminName are required', 400);
    }

    if (adminPassword.length > 72) {
      throw new AppError('Password must be 72 characters or fewer', 400);
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Split adminName into first/last
    const nameParts = adminName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || nameParts[0];

    // All uniqueness checks + creation inside a single transaction to prevent TOCTOU races
    const { tenant, user } = await prisma.$transaction(async (tx) => {
      // Check email uniqueness inside transaction
      const existing = await tx.user.findUnique({ where: { email: adminEmail } });
      if (existing) {
        throw new AppError('An account with this email already exists', 400);
      }

      // Build unique slug inside transaction
      const baseSlug = slugify(companyName) || 'company';
      let slug = baseSlug;
      let suffix = 1;
      while (await tx.tenant.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${suffix++}`;
      }

      // Resolve the chosen self-serve tier (if any). The tenant lands `pending`
      // until the first Paystack charge succeeds; hard lockout of pending tenants
      // is sibling enforcement, so this only sets the correct status + plan.
      // Default to `pending` even with no plan: never inherit the schema default
      // ('active') for an unpaid signup, or a no-plan tenant would land active and
      // the enforcement sibling (which locks pending/past_due/cancelled) could
      // never reach it — a permanent no-charge access hole.
      let planFields: { currentPlanId?: string; subscriptionStatus?: string } = {
        subscriptionStatus: SUBSCRIPTION_STATUS.PENDING,
      };
      if (planName) {
        const plan = await tx.plan.findFirst({ where: { name: planName, isActive: true } });
        if (!plan || !SELF_SERVE_PLAN_NAMES.includes(plan.name as any)) {
          throw new AppError('Invalid plan selected. Choose Growth or Scale.', 400);
        }
        planFields = { currentPlanId: plan.id, subscriptionStatus: SUBSCRIPTION_STATUS.PENDING };
      }

      const tenant = await tx.tenant.create({
        data: { name: companyName, slug, ...planFields }
      });

      const user = await tx.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          firstName,
          lastName,
          role: 'super_admin',
          tenantId: tenant.id,
          preferences: { onboardingCompleted: false }
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          tenantId: true,
          preferences: true,
          createdAt: true
        }
      });

      // MAN-87: point the tenant at its owner. Two-step because the FK is
      // circular (tenant.ownerUserId → user, user.tenantId → tenant); the
      // tenant is created ownerless, then linked once the user row exists.
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { ownerUserId: user.id }
      });

      // The owner's default StoreMembership for their own store — without this,
      // GET /api/stores, POST /api/stores/switch, and POST /api/stores all fail
      // to recognize the owner as a member of the store they just created.
      await tx.storeMembership.create({
        data: { userId: user.id, tenantId: tenant.id, role: 'super_admin', isDefault: true }
      });

      return { tenant, user };
    });

    const { accessToken, refreshToken } = await mintTokens(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });

    res.status(201).json({
      message: 'Tenant registered successfully',
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user,
      tokens: { accessToken, refreshToken }
    });
  } catch (error: any) {
    // Handle Prisma unique constraint violation (P2002) gracefully
    if (error?.code === 'P2002') {
      const target = error?.meta?.target;
      if (target?.includes('email')) {
        return next(new AppError('An account with this email already exists', 400));
      }
      if (target?.includes('slug')) {
        return next(new AppError('A tenant with this name already exists. Please choose a different name.', 400));
      }
      return next(new AppError('A record with this information already exists', 400));
    }
    next(error);
  }
};

/**
 * Delete the current tenant and all associated data.
 * Only super_admin can do this. Requires password confirmation.
 */
export const deleteTenantAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);
    if (req.user.role !== 'super_admin') throw new AppError('Only the super admin can delete the account', 403);

    const { password } = req.body;
    if (!password) throw new AppError('Password is required to confirm deletion', 400);

    // Verify password. Unscoped (MAN-98): the owner is null-tenant, so the
    // extended client would inject the active-store tenant and miss them (404).
    const user = await prismaBase.user.findFirst({ where: { id: req.user.id, isActive: true } });
    if (!user) throw new AppError('User not found', 404);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new AppError('Incorrect password', 401);

    // MAN-98: whole-account delete = every store this user OWNS (resolved by the
    // ownerUserId FK, never the ambiguous active-store JWT tenant), then the owner
    // row LAST. A legacy single-store user's own tenantId is folded in too.
    const ownedStores = await prismaBase.tenant.findMany({
      where: { ownerUserId: req.user.id },
      select: { id: true },
    });
    const storeIds = new Set(ownedStores.map((s) => s.id));
    if (req.user.tenantId) storeIds.add(req.user.tenantId);
    if (storeIds.size === 0) throw new AppError('No stores associated with this account', 400);

    // Delete all owned stores atomically, then the owner. Raw parameterized SQL
    // in dependency order; RESTRICT FKs to users are cleaned before user delete.
    // prismaBase: the deletes bypass extensions and the helper takes a plain tx.
    await prismaBase.$transaction(async (tx) => {
      for (const sid of storeIds) {
        await deleteStoreData(tx, sid);
      }
      // Owner row last — deleteStoreData never removes the (null-tenant) owner.
      await deleteOwnerReferences(tx, req.user!.id);
    });

    res.json({ message: 'Account and all associated data have been permanently deleted' });
  } catch (error) {
    next(error);
  }
};
