import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { Requester, isOwner } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';
import { getTenantMatrix, getUserPermissions } from '../middleware/auth';
import { clearAuthCache } from '../mcp/auth';
import { PERMISSION_CATALOG, PermissionGrid } from '../config/defaultRolePermissions';
import { isOwnerRole } from '../config/defaultRoles';
import { applySwitches, gridOfRole, hasOwnGrid, isRoleTool, missingReadTools, switchesOn } from '../config/roleToolRules';
import { assertMayTouchRole, findRole, getRole } from './roleService';

/**
 * M6-T04 (F-1153, F-1154): the tool switches and the permission matrix of one role. `Role.permissions` is the one store of what
 * the role grants; `Role.tools` is the list of switches that grid turns on, written with it so the two never differ.
 * Call inside the tenant context.
 */

/** A role of the tenant with its own grid, or 404. */
async function findRoleWithGrid(id: number) {
  const role = await findRole(id);
  return { ...role, grid: gridOfRole(role, await getTenantMatrix()) };
}

/** Both setters: only the Owner touches the Owner role, which is locked anyway; a system role is not edited. */
function assertEditable(actor: Requester, role: { presetRole: UserRole | null; isSystem: boolean }, what: string): void {
  assertMayTouchRole(actor, role);
  if (role.isSystem) throw new AppError('A system role cannot be changed', 400);
  if (isOwnerRole(role)) throw new AppError(`The Owner ${what} are locked`, 400, 'OWNER_LOCKED');
}

/**
 * Replace the tool switches of a role. Every key must be one of the 16 switches and a write switch needs its read switch
 * ("Needs View orders"). The grid changes with them in one write: a switch turned on grants its cells, a switch turned off
 * removes its cells unless another switch that stays on needs them. MCP keys of the role see the change at once.
 */
export async function setRoleTools(actor: Requester, roleId: number, tools: string[]) {
  const role = await findRoleWithGrid(roleId);
  assertEditable(actor, role, 'switches');
  const unique = [...new Set(tools)];
  const unknown = unique.filter((t) => !isRoleTool(t));
  if (unknown.length) throw new AppError(`Unknown tool: ${unknown.join(', ')}`, 400, 'UNKNOWN_TOOL');
  const missing = missingReadTools(unique);
  if (missing.length) throw new AppError(`Needs ${missing.join(' and ')}`, 400, 'TOOL_NEEDS_READ');
  // Same write and same last-manager guard as the grid setter
  await saveGrid(roleId, role.grid, applySwitches(role.grid, unique));
  return getRole(roleId);
}

/** The grid of a role and the cells that may be set (for the "Advanced permissions" panel). */
export async function getRolePermissions(roleId: number) {
  const [role, matrix] = await Promise.all([findRole(roleId), getTenantMatrix()]);
  return { permissions: gridOfRole(role, matrix), catalog: PERMISSION_CATALOG, custom: (await getRole(roleId)).custom, saved: hasOwnGrid(role) };
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
async function otherRoleKeepsUsersUpdate(roleId: number): Promise<boolean> {
  const assignments = await prisma.roleAssignment.findMany({
    where: { toDate: null, roleId: { not: roleId }, holder: { isActive: true } },
    select: { role: { select: { permissions: true, presetRole: true } } },
  });
  const matrix = await getTenantMatrix();
  return assignments.some((a) => grants(gridOfRole(a.role, matrix), 'users', 'update'));
}

/**
 * Save the permission matrix of a role (F-1154) and set the switches to the ones the grid turns on. Removing `users:update` from
 * the last role that gives it to an active holder is blocked: nobody could manage the team afterwards. The Owner role and system
 * roles are not edited. Returns the grids before and after, for the audit row. The caller clears the permission cache.
 */
export async function setRolePermissions(actor: Requester, roleId: number, input: PermissionGrid) {
  const role = await findRoleWithGrid(roleId);
  assertEditable(actor, role, 'permissions');
  return saveGrid(roleId, role.grid, input);
}

/** The write behind setRolePermissions and the Settings matrix: clean the grid, apply the last-holder guard, save grid and switches. */
export async function saveGrid(roleId: number, before: PermissionGrid, input: PermissionGrid) {
  const after = cleanGrid(input);
  const losesUsersUpdate = grants(before, 'users', 'update') && !grants(after, 'users', 'update');
  // Only a role with an active holder takes the permission away from someone.
  if (losesUsersUpdate && await hasActiveHolder(roleId) && !(await otherRoleKeepsUsersUpdate(roleId))) {
    throw new AppError('This is the last role that can manage users. Give users:update to another role first', 409, 'LAST_USER_MANAGER');
  }
  await prisma.role.update({ where: { id: roleId }, data: { permissions: after, tools: switchesOn(after) } });
  clearAuthCache();
  return { before, after };
}

/**
 * Privilege rule for handing out a role: a person who is not the Owner may only give a role whose grid they hold in full
 * (every cell of it is in their own union), and never to themselves. Otherwise the union of roles would let an admin lift
 * themselves, or someone else, above their own access. The Owner may assign any role.
 */
export async function assertGridWithin(actor: Requester, role: { permissions: unknown; presetRole: UserRole | null }, holderId?: number): Promise<void> {
  if (isOwner(actor)) return;
  if (holderId === actor.id) throw new AppError('You cannot give a role to yourself', 403, 'SELF_ASSIGN');
  const [own, matrix] = await Promise.all([getUserPermissions(actor), getTenantMatrix()]);
  for (const [resource, actions] of Object.entries(gridOfRole(role, matrix))) {
    const missing = actions.filter((a) => !grants(own, resource, a));
    if (missing.length) throw new AppError(`You cannot give a role that has permissions you do not have (${resource}:${missing[0]})`, 403, 'GRID_ABOVE_ACTOR');
  }
}

/** The base roles of the people holding a role now: the socket rooms to tell when its permissions change. */
export async function holderBaseRoles(roleId: number): Promise<UserRole[]> {
  const rows = await prisma.roleAssignment.findMany({ where: { roleId, toDate: null }, select: { holder: { select: { role: true } } } });
  return [...new Set(rows.map((r) => r.holder.role))];
}
