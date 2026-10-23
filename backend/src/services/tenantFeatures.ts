import prisma from '../utils/prisma';

export interface TenantFeatures {
  /** Physical forms may take online payment (F-402). Off by default. */
  prepaidPhysical: boolean;
}

/** The tenant's feature switches from SystemConfig.features. Must run inside the tenant's context. */
export async function getTenantFeatures(tenantId: string | null | undefined): Promise<TenantFeatures> {
  if (!tenantId) return { prepaidPhysical: false };
  const config = await prisma.systemConfig.findUnique({ where: { tenantId }, select: { features: true } });
  const features = (config?.features ?? {}) as Record<string, unknown>;
  return { prepaidPhysical: features.prepaidPhysical === true };
}
