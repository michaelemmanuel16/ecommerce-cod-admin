import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { getTenantId } from '../utils/tenantContext';
import { clearAuthCache } from '../mcp/auth';
import { clearPermissionsCache } from './permissionService';

/**
 * M6-T04: the one place that says "access changed". Drops the cached permissions and the cached MCP keys of the current tenant
 * (so the next request, and the next tool call of a key, sees the change at once), and, when a role is named, tells the browsers
 * of the people holding it. Call it after anything that changes what a person may do: a role grid, an assignment, the base role of
 * a role. Call inside the tenant context.
 */
export async function invalidateAccess(roleId?: number): Promise<void> {
  const tenantId = getTenantId();
  clearPermissionsCache(tenantId);
  clearAuthCache(tenantId);
  if (roleId === undefined) return;
  const [{ getSocketInstance }, { emitPermissionsUpdated }] = await Promise.all([import('../utils/socketInstance'), import('../sockets')]);
  const io = getSocketInstance();
  if (io) emitPermissionsUpdated(io, await holderBaseRoles(roleId));
}

/** The base roles of the people holding a role now: the socket rooms to tell. */
async function holderBaseRoles(roleId: number): Promise<UserRole[]> {
  const rows = await prisma.roleAssignment.findMany({ where: { roleId, toDate: null }, select: { holder: { select: { role: true } } } });
  return [...new Set(rows.map((r) => r.holder.role))];
}
