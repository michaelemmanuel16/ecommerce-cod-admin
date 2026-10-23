import { Request, Response, NextFunction } from 'express';
import { enterTenant } from '../utils/tenantContext';
import { formTenantBySlug, supportWhatsappForTenant } from '../services/tenantLookupService';
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
  let form: Awaited<ReturnType<typeof formTenantBySlug>>;
  try {
    form = await formTenantBySlug(slug);
  } catch (error) {
    next(error);
    return;
  }

  if (!form?.isActive) {
    const notFound = new AppError('Checkout form not found or inactive', 404);
    // The store's public support number (and nothing else) rides on the 404, so the "not available" screen can offer it.
    // An unknown slug has no store: no number, and no second query.
    notFound.details = { supportWhatsapp: form ? await supportWhatsappForTenant(form.tenantId) : null };
    next(notFound);
    return;
  }
  enterTenant(form.tenantId, next);
};
