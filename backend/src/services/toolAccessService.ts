import prisma from '../utils/prisma';
import { hasPermission } from '../middleware/auth';

/**
 * M2-T04: the two database lookups behind runTool's access check. They live here because
 * tool files and the registry may not import the Prisma client (lint rule).
 * Both run in the tenant context of the caller.
 */

/** True when the actor's base role holds the permission cell ("resource:action"). */
export async function actorHasPermission(actorId: number, cell: string): Promise<boolean> {
  const user = await prisma.user.findFirst({ where: { id: actorId }, select: { id: true, role: true } });
  if (!user) return false;
  const [resource, action] = cell.split(':');
  return hasPermission(user, resource, action);
}

/** True when the role's `tools` list contains the tool. A role that does not exist in this tenant allows nothing. */
export async function roleAllowsTool(roleId: number, tool: string): Promise<boolean> {
  const role = await prisma.role.findFirst({ where: { id: roleId }, select: { tools: true } });
  return Array.isArray(role?.tools) && (role!.tools as unknown[]).includes(tool);
}
