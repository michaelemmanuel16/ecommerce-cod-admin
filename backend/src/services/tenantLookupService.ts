import prisma from '../utils/prisma';
import { withoutTenant } from '../utils/tenantContext';
import { withSoftDeleted } from '../utils/prismaExtensions';

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

/** The tenant that owns a payment reference: its pending checkout, else its order. Unscoped, so it sees every tenant. */
export async function findReferenceOwner(reference: string): Promise<string | null> {
  return withoutTenant('payment-reference-owner', async () => {
    const pendingRow = await prisma.pendingCheckout.findUnique({ where: { reference }, select: { tenantId: true } });
    if (pendingRow) return pendingRow.tenantId;
    const orderRow = await prisma.order.findFirst({ where: { paymentReference: reference }, select: { tenantId: true } });
    return orderRow?.tenantId ?? null;
  });
}

/** The id of the tenant with this slug (the tenant in a webhook URL), or null. */
export const tenantIdBySlug = async (slug: string): Promise<string | null> => {
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return tenant?.id ?? null;
};

/** The slugs among `candidates` that any form already holds, archived and switched-off forms included (slugs are unique across tenants). */
export const takenFormSlugs = async (candidates: string[]): Promise<Set<string>> => {
  const rows = await withoutTenant('clone slug check', () => withSoftDeleted(() =>
    prisma.checkoutForm.findMany({ where: { slug: { in: candidates } }, select: { slug: true } }),
  ));
  return new Set(rows.map((f) => f.slug));
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
