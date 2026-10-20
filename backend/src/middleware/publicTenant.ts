import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { tenantStorage, withoutTenant } from '../utils/tenantContext';
import { AppError } from './errorHandler';

/** Tenant id of an ACTIVE checkout form (unscoped lookup on purpose), or null. */
export const tenantIdForFormSlug = async (slug: string): Promise<string | null> => {
  const form = await withoutTenant('public-form-slug', () =>
    prisma.checkoutForm.findUnique({ where: { slug, isActive: true }, select: { tenantId: true } })
  );
  return form?.tenantId ?? null;
};

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
    tenantId = await tenantIdForFormSlug(slug);
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
