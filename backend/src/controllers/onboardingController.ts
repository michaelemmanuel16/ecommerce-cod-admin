import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

export const setupOnboarding = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    // Get tenantId from JWT or fall back to DB lookup (handles stale tokens)
    let tenantId = req.user.tenantId;
    if (!tenantId) {
      const existingUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { tenantId: true, email: true, firstName: true } });
      tenantId = existingUser?.tenantId ?? null;

      // Legacy user with no tenant — create one automatically
      if (!tenantId && existingUser) {
        const slug = `company-${req.user.id}`;
        const tenant = await prisma.tenant.create({
          data: { name: `${existingUser.firstName}'s Company`, slug }
        });
        await prisma.user.update({ where: { id: req.user.id }, data: { tenantId: tenant.id } });
        tenantId = tenant.id;
      }
    }
    if (!tenantId) throw new AppError('User has no tenant assigned', 400);

    const { country, currency } = req.body;

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(country !== undefined && { region: country }),
        ...(currency !== undefined && { currency }),
      }
    });

    // Mark onboarding as complete in user preferences
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { preferences: true } });
    const currentPreferences = (dbUser?.preferences as any) || {};
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        preferences: {
          ...currentPreferences,
          onboardingCompleted: true,
          onboardingCompletedAt: new Date().toISOString()
        }
      }
    });

    res.json({
      message: 'Onboarding setup complete',
      tenant: updatedTenant
    });
  } catch (error) {
    next(error);
  }
};

export const getOnboardingStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const userWithPrefs = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { preferences: true, tenantId: true }
    });

    const preferences = (userWithPrefs?.preferences as any) || {};
    res.json({ onboardingCompleted: preferences.onboardingCompleted ?? false });
  } catch (error) {
    next(error);
  }
};
