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
 * The tenant of a checkout form by slug, active or not (unscoped lookup on purpose), with whether it is on. A switched-off
 * form is "soft deleted" (isActive false), so the lookup has to see it. Null for an unknown slug.
 */
export const formTenantBySlug = async (slug: string): Promise<{ tenantId: string; isActive: boolean } | null> => {
  const form = await withoutTenant('public-form-slug', () =>
    withSoftDeleted(() => prisma.checkoutForm.findUnique({ where: { slug }, select: { tenantId: true, isActive: true } }))
  );
  return form?.tenantId ? { tenantId: form.tenantId, isActive: form.isActive } : null;
};

/**
 * A store's public support WhatsApp number, or null. The one source for the public form payload and the "form not
 * available" 404, so the buyer of a switched-off form still sees how to reach the store. It is a public contact: nothing
 * else about the store leaves through here.
 */
export const supportWhatsappForTenant = async (tenantId: string): Promise<string | null> => {
  const config = await withoutTenant('public-support-whatsapp', () =>
    prisma.systemConfig.findUnique({ where: { tenantId }, select: { supportWhatsapp: true } })
  );
  return config?.supportWhatsapp ?? null;
};
