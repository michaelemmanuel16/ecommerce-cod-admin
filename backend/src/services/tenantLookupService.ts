import prisma from '../utils/prisma';
import { withoutTenant } from '../utils/tenantContext';
import { withSoftDeleted } from '../utils/prismaExtensions';

/** Tenant id of an ACTIVE checkout form (unscoped lookup on purpose), or null. */
export const tenantIdForFormSlug = async (slug: string): Promise<string | null> => {
  const form = await withoutTenant('public-form-slug', () =>
    prisma.checkoutForm.findUnique({ where: { slug, isActive: true }, select: { tenantId: true } })
  );
  return form?.tenantId ?? null;
};

/**
 * The store's public support WhatsApp number for a form slug, active or not (unscoped lookup on purpose), or null.
 * Used by the "form not available" 404, so the buyer of a switched-off form still sees how to reach the store.
 * It returns this one public contact and nothing else about the store.
 */
export const supportWhatsappForFormSlug = async (slug: string): Promise<string | null> =>
  withoutTenant('public-form-support', async () => {
    // A switched-off form is "soft deleted" (isActive false): the lookup has to see it.
    const form = await withSoftDeleted(() => prisma.checkoutForm.findUnique({ where: { slug }, select: { tenantId: true } }));
    if (!form?.tenantId) return null;
    const config = await prisma.systemConfig.findUnique({ where: { tenantId: form.tenantId }, select: { supportWhatsapp: true } });
    return config?.supportWhatsapp ?? null;
  });
