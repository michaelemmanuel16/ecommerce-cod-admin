import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

export const setupOnboarding = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const tenantId = req.user.tenantId;
    if (!tenantId) throw new AppError('User has no tenant assigned', 400);

    const { companyLogo, region, currency, defaultDeliveryFee } = req.body;

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(companyLogo !== undefined && { logo: companyLogo }),
        ...(region !== undefined && { region }),
        ...(currency !== undefined && { currency }),
        ...(defaultDeliveryFee !== undefined && { defaultDeliveryFee: Number(defaultDeliveryFee) })
      }
    });

    // Mark onboarding as complete in user preferences
    const currentPreferences = (req.user as any).preferences || {};
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
