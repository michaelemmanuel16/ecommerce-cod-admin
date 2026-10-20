import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { currencyForCountry } from '../utils/currency';
import { changeStoreCurrency } from '../services/fxService';
import { AppError } from '../middleware/errorHandler';

export const setupOnboarding = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    // Get tenantId and preferences in one read (handles stale JWT tokens)
    let tenantId = req.user.tenantId;
    const existingUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { tenantId: true, email: true, firstName: true, preferences: true } });
    if (!tenantId) {
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

    const { country, currency, businessEmail, businessPhone, businessAddress, taxId } = req.body;

    // Picking a country sets the store currency (O3, O6). An explicit currency wins.
    const storeCurrency = currency ?? (typeof country === 'string' ? currencyForCountry(country) : undefined) ?? undefined;
    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(country !== undefined && { region: country }),
      }
    });
    // Saves the code and fetches rates for the new pairs; a provider outage does not fail onboarding.
    if (storeCurrency !== undefined) updatedTenant.currency = await changeStoreCurrency(tenantId, storeCurrency);

    // Save business details to SystemConfig (create if needed)
    if (businessEmail || businessPhone || businessAddress || taxId) {
      let config = await prisma.systemConfig.findFirst({ where: { tenantId } });
      if (config) {
        await prisma.systemConfig.update({
          where: { id: config.id },
          data: {
            ...(businessEmail && { businessEmail }),
            ...(businessPhone && { businessPhone }),
            ...(businessAddress && { businessAddress }),
            ...(taxId && { taxId }),
            businessName: updatedTenant.name,
          },
        });
      } else {
        await prisma.systemConfig.create({
          data: {
            businessName: updatedTenant.name,
            ...(businessEmail && { businessEmail }),
            ...(businessPhone && { businessPhone }),
            ...(businessAddress && { businessAddress }),
            ...(taxId && { taxId }),
            tenantId,
          },
        });
      }
    }

    // Mark onboarding as complete in user preferences (using data from initial read)
    const currentPreferences = (existingUser?.preferences as any) || {};
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
