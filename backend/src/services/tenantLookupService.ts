import prisma from '../utils/prisma';
import { withoutTenant } from '../utils/tenantContext';

/** Tenant id of an ACTIVE checkout form (unscoped lookup on purpose), or null. */
export const tenantIdForFormSlug = async (slug: string): Promise<string | null> => {
  const form = await withoutTenant('public-form-slug', () =>
    prisma.checkoutForm.findUnique({ where: { slug, isActive: true }, select: { tenantId: true } })
  );
  return form?.tenantId ?? null;
};
