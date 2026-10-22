import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { addPartner, getStatus, saveStore, setOwnerPrefs } from '../services/onboardingService';

/** The tenant of the signed-in user; the JWT can be stale, so fall back to the user row. */
async function tenantOf(req: AuthRequest): Promise<string> {
  if (!req.user) throw new AppError('Not authenticated', 401);
  const tenantId = req.user.tenantId ?? (await prisma.user.findUnique({ where: { id: req.user.id }, select: { tenantId: true } }))?.tenantId;
  if (!tenantId) throw new AppError('User has no tenant assigned', 400);
  return tenantId;
}

/** POST /api/onboarding/setup: `step` 1 (store, the default) or 2 (first delivery partner, or `skip`). */
export const setupOnboarding = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = await tenantOf(req);
    const user = req.user!;
    const step = req.body.step === undefined ? 1 : Number(req.body.step);

    if (step === 1) {
      const tenant = await saveStore(tenantId, req.body);
      // A body without `step` is the old single-call form: it also closes the old wizard.
      if (req.body.step === undefined) await setOwnerPrefs(user.id, { onboardingCompleted: true, onboardingCompletedAt: new Date().toISOString() });
      res.json({ message: 'Onboarding setup complete', tenant });
    } else if (step === 2) {
      if (req.body.skip === true) {
        await setOwnerPrefs(user.id, { onboardingPartnerSkipped: true });
        res.json({ message: 'Step skipped', skipped: true });
        return;
      }
      const partner = await addPartner({ id: user.id, role: user.role }, req.body);
      res.status(201).json({ message: 'Partner added', partner });
    } else {
      throw new AppError('Step must be 1 or 2', 400);
    }
  } catch (error) {
    next(error);
  }
};

export const getOnboardingStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = await tenantOf(req);
    res.json(await getStatus(tenantId, req.user!.id));
  } catch (error) {
    next(error);
  }
};
