import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { tenantStorage, withoutTenant } from '../utils/tenantContext';
import { AppError } from './errorHandler';

/**
 * Public routes have no JWT. This resolves the tenant from the checkout form slug
 * (minimal lookup, unscoped on purpose) and runs the rest of the request inside
 * tenantStorage.run(tenantId). Unknown or inactive slug gives 404 before any other query.
 * Use as router.param('slug', resolveFormSlugTenant).
 */
export const resolveFormSlugTenant = async (
  _req: Request,
  _res: Response,
  next: NextFunction,
  slug: string
): Promise<void> => {
  let tenantId: string | null = null;
  try {
    const form = await withoutTenant('public-form-slug', () =>
      prisma.checkoutForm.findUnique({ where: { slug, isActive: true }, select: { tenantId: true } })
    );
    tenantId = form?.tenantId ?? null;
  } catch (error) {
    next(error);
    return;
  }

  if (!tenantId) {
    next(new AppError('Checkout form not found or inactive', 404));
    return;
  }
  tenantStorage.run({ tenantId }, next);
};
