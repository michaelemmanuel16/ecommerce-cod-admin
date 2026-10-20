import { Request, Response, NextFunction } from 'express';
import { enterTenant } from '../utils/tenantContext';
import { tenantIdForFormSlug } from '../services/tenantLookupService';
import { AppError } from './errorHandler';

/**
 * Public routes have no JWT. This resolves the tenant from the checkout form slug
 * (minimal lookup, unscoped on purpose) and runs the rest of the request inside
 * enterTenant(tenantId). Unknown or inactive slug gives 404 before any other query.
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
  enterTenant(tenantId, next);
};
