import { UserRole } from '@prisma/client';
import { prismaBase } from '../../../utils/prisma';
import { defaultRolePermissions } from '../../../config/defaultRolePermissions';
import { ROLE_NAME_BY_USER_ROLE } from '../../../config/defaultRoles';
import { clearPermissionsCache } from '../../../middleware/auth';

/**
 * Change what a base role may do in a tenant, as the owner does in Settings: since M6-T04 the grid of the position role mapped
 * from the UserRole is the one store. A resource named in `resources` replaces the default list; others keep the default.
 * `undefined` puts the defaults back. A tenant with no seeded roles gets the saved matrix instead (the fallback).
 */
export async function setRoleGrid(tenantId: string, userRole: UserRole, resources?: Record<string, string[]>): Promise<void> {
  const grid = { ...defaultRolePermissions()[userRole], ...(resources ?? {}) };
  const { count } = await prismaBase.role.updateMany({ where: { tenantId, name: ROLE_NAME_BY_USER_ROLE[userRole], presetRole: userRole }, data: { permissions: grid } });
  if (count === 0) {
    await prismaBase.systemConfig.upsert({
      where: { tenantId },
      update: { rolePermissions: resources ? { [userRole]: resources } : undefined },
      create: { tenantId, rolePermissions: resources ? { [userRole]: resources } : undefined } as never,
    });
  }
  clearPermissionsCache();
}
