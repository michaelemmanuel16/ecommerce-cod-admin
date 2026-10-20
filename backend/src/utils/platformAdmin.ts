import prisma from './prisma';
import { withoutTenant } from './tenantContext';

/**
 * Is this user a platform admin? Read from the DB, not the JWT. Unscoped on purpose:
 * the caller may have no tenant (a tenant-less JWT is only valid for a platform admin).
 */
export async function isPlatformAdmin(userId: number): Promise<boolean> {
  const user = await withoutTenant('platform-admin-check', () =>
    prisma.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } })
  );
  return user?.isPlatformAdmin === true;
}
