import prisma from '../utils/prisma';
import { hasPermission } from '../middleware/auth';

/**
 * M2-T04: the database lookups behind the tool access decision. They live here because tool files and the
 * registry may not import the Prisma client (lint rule). Run them in the tenant context of the caller.
 */

/** What decides access for one actor: the user's base role and, when the call has a role, that role's tool names. */
export interface AccessFacts {
  /** Base role of the actor's user. Null when the user does not exist: nothing is permitted. */
  baseRole: string | null;
  /** The role's tool list. Null when the call has no role (no role filter). A role that is missing allows nothing. */
  roleTools: readonly string[] | null;
}

/** Load the actor's base role and the role's tool list: two queries, for the whole decision. */
export async function loadAccessFacts(actorId: number, roleId: number | null): Promise<AccessFacts> {
  const [user, role] = await Promise.all([
    prisma.user.findFirst({ where: { id: actorId }, select: { role: true } }),
    roleId === null ? null : prisma.role.findFirst({ where: { id: roleId }, select: { tools: true } }),
  ]);
  return {
    baseRole: user?.role ?? null,
    roleTools: roleId === null ? null : Array.isArray(role?.tools) ? (role!.tools as string[]) : [],
  };
}

/** Which of the permission cells ("resource:action") the base role holds. */
export async function permittedCells(baseRole: string | null, cells: readonly string[]): Promise<Set<string>> {
  if (baseRole === null) return new Set();
  const unique = [...new Set(cells)];
  const held = await Promise.all(unique.map((cell) => {
    const [resource, action] = cell.split(':');
    return hasPermission({ role: baseRole }, resource, action);
  }));
  return new Set(unique.filter((_, i) => held[i]));
}
