import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError } from '../middleware/errorHandler';
import { adminService } from '../services/adminService';
import { sendPasswordResetEmail } from '../services/emailService';

export const register = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, firstName, lastName, phoneNumber, role } = req.body;

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

    // Generate tokens
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

    const decoded = verifyRefreshToken(refreshToken);

    // Validate ID type - handle migration from string (CUID) to integer IDs
    if (typeof decoded.id !== 'number') {
      // Token contains old string ID (from pre-migration era)
      // Force user to re-login to get new token with integer ID
      throw new AppError('Token format outdated. Please log in again.', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id }
    });

    if (!user || user.refreshToken !== refreshToken) {
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

    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.isActive && (user.role === 'super_admin' || user.role === 'admin')) {
      try {
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

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        refreshToken: null,
      },
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

    // Get user permissions from system config
    const allPermissions = await adminService.getRolePermissions(req.user as any) as Record<string, any>;
    const userPermissions = allPermissions[user?.role || ''] || {};

    res.json({ user, permissions: userPermissions });
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

    if (!companyName || !adminEmail || !adminPassword || !adminName) {
      throw new AppError('companyName, adminEmail, adminPassword, and adminName are required', 400);
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

      const tenant = await tx.tenant.create({
        data: { name: companyName, slug }
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

      return { tenant, user };
    });

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
