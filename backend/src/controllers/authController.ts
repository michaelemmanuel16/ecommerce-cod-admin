import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { safeEqual } from '../utils/crypto';
import bcrypt from 'bcrypt';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { runInTenant, runInTenantOf, withoutTenant } from '../utils/tenantContext';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError } from '../middleware/errorHandler';
import navService from '../services/navService';
import { adminService } from '../services/adminService';
import { sendPasswordResetEmail } from '../services/emailService';
import { SUBSCRIPTION_STATUS, SELF_SERVE_PLAN_NAMES } from '../config/billing';
import { seedTenantDefaults } from '../services/tenantDefaultsService';
import logger from '../utils/logger';
import * as Money from '../utils/money';

export const login = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Email is globally unique and there is no tenant yet: look up unscoped on
    // purpose, then continue inside the user's own tenant.
    const user = await withoutTenant('auth-login', () => prisma.user.findUnique({ where: { email } }));
    // The system user and AI agents have no usable password and are never a login.
    if (!user || user.kind !== 'person') {
      throw new AppError('Invalid credentials', 401);
    }

    if (!user.isActive) {
      throw new AppError('Account is deactivated', 403);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    await runInTenantOf(user.tenantId, 'auth-login', async () => {
      const accessToken = generateAccessToken({
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId ?? null
      });

      const refreshToken = generateRefreshToken({
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId ?? null
      });

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
          commissionAmount: Money.orZero(user.commissionAmount),
          deliveryRate: user.deliveryRate,
          preferences: user.preferences,
        },
        tokens: {
          accessToken,
          refreshToken
        },
        permissions: userPermissions
      });
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

    const user = await withoutTenant('auth-refresh', () => prisma.user.findUnique({
      where: { id: decoded.id }
    }));

    // SECURITY: Use timing-safe comparison to prevent timing attacks on refresh tokens
    const isValidToken = user && user.refreshToken && refreshToken &&
      safeEqual(user.refreshToken, refreshToken);
    if (!user || !isValidToken) {
      throw new AppError('Invalid refresh token', 401);
    }

    const newAccessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ?? null
    });

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
      await prisma.user.update({
        where: { id: req.user.id },
        data: { refreshToken: null }
      });
    }

    res.json({ message: 'Logout successful' });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email } = req.body;

    const user = await withoutTenant('auth-forgot-password', () => prisma.user.findUnique({ where: { email } }));

    if (user && user.isActive && (user.role === 'super_admin' || user.role === 'admin')) {
      try {
        await runInTenantOf(user.tenantId, 'auth-forgot-password', async () => {
          const rawToken = crypto.randomBytes(32).toString('hex');
          const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
          const expires = new Date(Date.now() + 15 * 60 * 1000);

          await prisma.user.update({
            where: { id: user.id },
            data: {
              passwordResetToken: hashedToken,
              passwordResetExpires: expires,
            },
          });

          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
          const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

          await sendPasswordResetEmail(email, user.firstName, resetUrl);
        });
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

    const user = await withoutTenant('auth-reset-password', () => prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    }));

    if (!user) {
      throw new AppError('Invalid or expired reset token', 400);
    }

    if (!password || password.length > 72) {
      throw new AppError('Password is required and must be 72 characters or fewer', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await runInTenantOf(user.tenantId, 'auth-reset-password', () => prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        refreshToken: null,
      },
    }));

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

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        isAvailable: true,
        createdAt: true
      }
    });

    // Effective permissions (saved matrix merged over the defaults), home route, menu keys and role names for the shell
    const shell = user ? await navService.getShell(user.id, user.role) : { permissions: {} };

    res.json({ user, ...shell });
  } catch (error) {
    next(error);
  }
};

// Slugify helper
function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}


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
      // Check email uniqueness inside transaction. Deactivated users still hold
      // the email in the unique index, so this opts out of the soft-delete filter
      // — the P2002 catch below would otherwise turn a deactivated account into a
      // rolled-back transaction rather than this clean 400.
      const existing = await withoutTenant('register-email-check', () =>
        withSoftDeleted(() => tx.user.findUnique({ where: { email: adminEmail } }))
      );
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

      // The new tenant's first user is created inside that tenant
      const user = await runInTenant(tenant.id, async () => tx.user.create({
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
      }));

      return { tenant, user };
    });

    // A failed seed is logged, not fatal: the startup seed fills any gap
    await seedTenantDefaults(tenant.id).catch((err) => logger.error(`Seeding defaults failed for tenant ${tenant.id}:`, err));

    const accessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ?? null
    });

    const refreshToken = generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ?? null
    });

    await runInTenantOf(user.tenantId, 'register-tenant', () => prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    }));

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

    // Verify password
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new AppError('User not found', 404);

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new AppError('Incorrect password', 401);

    const tenantId = req.user.tenantId;
    if (!tenantId) throw new AppError('No tenant associated with this account', 400);

    // Delete all tenant data atomically in dependency order.
    // Uses parameterized queries (Prisma.sql) to prevent SQL injection.
    // Tables with RESTRICT FKs to users must be cleaned before user/tenant delete.
    await prisma.$transaction(async (tx) => {
      // 1. Delete records that reference users via RESTRICT FKs
      await tx.$executeRaw`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM payouts WHERE rep_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM calls WHERE sales_rep_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM agent_deposits WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM agent_collections WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM agent_aging_buckets WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM agent_balances WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM agent_stock WHERE agent_id IN (SELECT id FROM users WHERE tenant_id = ${tenantId})`;

      // 2. NULL out user FK columns on tenant-scoped tables (these cascade from tenant delete,
      //    but RESTRICT FKs on user columns would block the cascade)
      await tx.$executeRaw`UPDATE orders SET created_by_id = NULL, customer_rep_id = NULL, delivery_agent_id = NULL WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`UPDATE deliveries SET agent_id = NULL WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`UPDATE inventory_shipments SET created_by_id = NULL WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`UPDATE inventory_transfers SET from_agent_id = NULL, to_agent_id = NULL, created_by_id = NULL WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`UPDATE journal_entries SET created_by = NULL, voided_by = NULL WHERE tenant_id = ${tenantId}`;

      // 3. Delete remaining tenant-scoped data in dependency order
      await tx.$executeRaw`DELETE FROM form_submissions WHERE form_id IN (SELECT id FROM checkout_forms WHERE tenant_id = ${tenantId})`;
      await tx.$executeRaw`DELETE FROM inventory_transfers WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM inventory_shipments WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM account_transactions WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM journal_entries WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM system_config WHERE tenant_id = ${tenantId}`;

      // 4. Delete tenant — CASCADE handles remaining tenant_id FKs (orders, customers, etc.)
      //    Using raw SQL to bypass Prisma soft-delete extensions
      await tx.$executeRaw`DELETE FROM users WHERE tenant_id = ${tenantId}`;
      await tx.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}`;
    });

    res.json({ message: 'Account and all associated data have been permanently deleted' });
  } catch (error) {
    next(error);
  }
};
