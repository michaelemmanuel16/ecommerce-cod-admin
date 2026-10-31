import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { Requester } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';
import { clearAuthCache } from '../mcp/auth';
import { PERMISSION_CATALOG, PermissionGrid, mergeRolePermissions } from '../config/defaultRolePermissions';
import { isOwnerRole } from '../config/defaultRoles';
import { isKnownTool, missingReadTools } from '../config/roleToolRules';
import { assertMayTouchRole, findRole, getRole } from './roleService';

/** M6-T04 (F-1153, F-1154): the tool switches and the permission matrix of one role. Call inside the tenant context. */

type GridSource = { permissions: unknown; presetRole: UserRole | null };


const isGrid = (v: unknown): v is PermissionGrid => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The grid a role gives its holders: its own `permissions`, else the tenant's matrix for its base role, else nothing. One rule,
 * shared with the middleware (which reads the same two sources).
 */
export function gridOfRole(role: GridSource, matrix: Record<UserRole, PermissionGrid>): PermissionGrid {
  if (isGrid(role.permissions)) return role.permissions;
  return role.presetRole ? matrix[role.presetRole] : {};
}

/** A role of the tenant with its own grid (roleService's select leaves `permissions` out of the role views), or 404. */
async function findRoleWithGrid(id: number) {
  const [role, own] = await Promise.all([findRole(id), prisma.role.findFirst({ where: { id }, select: { permissions: true } })]);
  return { ...role, permissions: own?.permissions ?? null };
}

const tenantMatrix = async () => mergeRolePermissions((await prisma.systemConfig.findFirst({ select: { rolePermissions: true } }))?.rolePermissions);

/** Tools and the Owner/system rules both setters share: only the Owner touches the Owner role, which is locked anyway. */
function assertEditable(actor: Requester, role: GridSource & { isSystem: boolean }, what: string): void {
  assertMayTouchRole(actor, role);
  if (role.isSystem) throw new AppError('A system role cannot be changed', 400);
  if (isOwnerRole(role)) throw new AppError(`The Owner ${what} are locked`, 400, 'OWNER_LOCKED');
}

/**
 * Replace the tool switches of a role. Every name must be a registry tool, and a write tool needs a read tool on its resource
 * ("Needs View orders"). The Owner's switches are locked. MCP keys of the role see the change at once (auth cache cleared).
 */
export async function setRoleTools(actor: Requester, roleId: number, tools: string[]) {
  const role = await findRoleWithGrid(roleId);
  assertEditable(actor, role, 'switches');
  const unique = [...new Set(tools)];
  const unknown = unique.filter((t) => !isKnownTool(t));
  if (unknown.length) throw new AppError(`Unknown tool: ${unknown.join(', ')}`, 400, 'UNKNOWN_TOOL');
  const missing = missingReadTools(unique);
  if (missing.length) throw new AppError(`Needs ${missing.join(' and ')}`, 400, 'TOOL_NEEDS_READ');
  await prisma.role.update({ where: { id: roleId }, data: { tools: unique } });
  clearAuthCache();
  return getRole(roleId);
}

/** The grid of a role and the cells that may be set (for the "Advanced permissions" panel). */
export async function getRolePermissions(roleId: number) {
  const role = await findRoleWithGrid(roleId);
  return { permissions: gridOfRole(role, await tenantMatrix()), catalog: PERMISSION_CATALOG, custom: isGrid(role.permissions) };
}

/** Keep only known resources and actions; an unknown one is an error that names it. Empty resources stay (an explicit "none"). */
function cleanGrid(input: PermissionGrid): PermissionGrid {
  const clean: PermissionGrid = {};
  for (const [resource, actions] of Object.entries(input)) {
    const allowed = PERMISSION_CATALOG[resource];
    if (!allowed) throw new AppError(`Unknown resource: ${resource}`, 400, 'UNKNOWN_PERMISSION');
    const bad = actions.filter((a) => !allowed.includes(a));
    if (bad.length) throw new AppError(`Unknown action on ${resource}: ${bad.join(', ')}`, 400, 'UNKNOWN_PERMISSION');
    clean[resource] = [...new Set(actions)];
  }
  return clean;
}

const grants = (grid: PermissionGrid, resource: string, action: string) => (grid[resource] ?? []).includes(action);

const hasActiveHolder = async (roleId: number) =>
  (await prisma.roleAssignment.count({ where: { roleId, toDate: null, holder: { isActive: true } } })) > 0;

/** Does another role grant `users:update` to a person who can still use it? An inactive user (invited, deactivated) cannot. */
async function otherRoleKeepsUsersUpdate(roleId: number, matrix: Record<UserRole, PermissionGrid>): Promise<boolean> {
  const assignments = await prisma.roleAssignment.findMany({
    where: { toDate: null, roleId: { not: roleId }, holder: { isActive: true } },
    select: { role: { select: { permissions: true, presetRole: true } } },
  });
  return assignments.some((a) => grants(gridOfRole(a.role, matrix), 'users', 'update'));
}

/**
 * Save the permission matrix of a role (F-1154). Removing `users:update` from the last role that gives it to an active holder
 * is blocked: nobody could manage the team afterwards. The Owner role and system roles are not edited. Returns the grids before
 * and after, for the audit row. The caller clears the permission cache.
 */
export async function setRolePermissions(actor: Requester, roleId: number, input: PermissionGrid) {
  const role = await findRoleWithGrid(roleId);
  assertEditable(actor, role, 'permissions');
  const after = cleanGrid(input);
  const matrix = await tenantMatrix();
  const before = gridOfRole(role, matrix);
  const losesUsersUpdate = grants(before, 'users', 'update') && !grants(after, 'users', 'update');
  // Only a role with an active holder takes the permission away from someone.
  if (losesUsersUpdate && await hasActiveHolder(roleId) && !(await otherRoleKeepsUsersUpdate(roleId, matrix))) {
    throw new AppError('This is the last role that can manage users. Give users:update to another role first', 409, 'LAST_USER_MANAGER');
  }
  await prisma.role.update({ where: { id: roleId }, data: { permissions: after } });
  return { before, after };
}

/** The base roles of the people holding a role now: the socket rooms to tell when its permissions change. */
export async function holderBaseRoles(roleId: number): Promise<UserRole[]> {
  const rows = await prisma.roleAssignment.findMany({ where: { roleId, toDate: null }, select: { holder: { select: { role: true } } } });
  return [...new Set(rows.map((r) => r.holder.role))];
}
