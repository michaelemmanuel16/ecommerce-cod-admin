import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { Requester, isOwner } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { PERMISSION_CATALOG, PermissionGrid } from '../config/defaultRolePermissions';
import { ROLE_NAME_BY_USER_ROLE, isOwnerRole } from '../config/defaultRoles';
import { applySwitches, gridOfRole, grants, hasOwnGrid, isRoleTool, missingReadTools, switchesOn } from '../config/roleToolRules';
import { getTenantMatrix, getUserPermissions } from './permissionService';
import { invalidateAccess } from './accessService';
import { assertMayTouchRole, findRole, isCustomGrid, liveHolders, roleView } from './roleService';

/**
 * M6-T04 (F-1153, F-1154): the tool switches and the permission matrix of one role. `Role.permissions` is the one store of what
 * the role grants; the switches that are on are read from that grid (`switchesOn`), never stored. Only a system role (Legacy
 * MCP) keeps a stored `Role.tools` list, of registry tool names. Call inside the tenant context.
 */

const tenantMatrix = () => getTenantMatrix(resolveTenantId());

/** A role of the tenant with its effective grid, or 404. Both reads run together. */
async function findRoleWithGrid(id: number) {
  const [role, matrix] = await Promise.all([findRole(id), tenantMatrix()]);
  return { ...role, grid: gridOfRole(role, matrix), matrix };
}

/** Both setters: only the Owner touches the Owner role, which is locked anyway; a system role is not edited. */
function assertEditable(actor: Requester, role: { presetRole: UserRole | null; isSystem: boolean }, what: string): void {
  assertMayTouchRole(actor, role);
  if (role.isSystem) throw new AppError('A system role cannot be changed', 400);
  if (isOwnerRole(role)) throw new AppError(`The Owner ${what} are locked`, 400, 'OWNER_LOCKED');
}

/**
 * Replace the tool switches of a role. Every key must be one of the 16 switches and a write switch needs its read switch
 * ("Needs View orders"). The grid changes with them, through the same write as the grid setter: a switch turned on grants its
 * cells, a switch turned off removes its cells unless another switch that stays on needs them. Returns the role view and the
 * switches that were on before (for the audit row).
 */
export async function setRoleTools(actor: Requester, roleId: number, tools: string[]) {
  const role = await findRoleWithGrid(roleId);
  assertEditable(actor, role, 'switches');
  const unique = [...new Set(tools)];
  const unknown = unique.filter((t) => !isRoleTool(t));
  if (unknown.length) throw new AppError(`Unknown tool: ${unknown.join(', ')}`, 400, 'UNKNOWN_TOOL');
  const missing = missingReadTools(unique);
  if (missing.length) throw new AppError(`Needs ${missing.join(' and ')}`, 400, 'TOOL_NEEDS_READ');
  const { before, after } = await saveGrid(roleId, role.grid, applySwitches(role.grid, unique));
  const holders = await liveHolders(roleId);
  return { role: roleView({ ...role, permissions: after }, holders, role.matrix), before: switchesOn(before) };
}

/** The grid of a role and the cells that may be set (for the "Advanced permissions" panel). */
export async function getRolePermissions(roleId: number) {
  const role = await findRoleWithGrid(roleId);
  return { permissions: role.grid, catalog: PERMISSION_CATALOG, custom: !role.isSystem && isCustomGrid(role, role.grid), saved: hasOwnGrid(role) };
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

const hasActiveHolder = async (roleId: number) =>
  (await prisma.roleAssignment.count({ where: { roleId, toDate: null, holder: { isActive: true } } })) > 0;

/** Does another role that an active holder holds grant `users:update`? An inactive user (invited, deactivated) cannot use it. */
async function otherRoleKeepsUsersUpdate(roleId: number): Promise<boolean> {
  const [roles, matrix] = await Promise.all([
    prisma.role.findMany({
      where: { id: { not: roleId }, assignments: { some: { toDate: null, holder: { isActive: true } } } },
      select: { permissions: true, presetRole: true },
    }),
    tenantMatrix(),
  ]);
  return roles.some((r) => grants(gridOfRole(r, matrix), 'users', 'update'));
}

/**
 * Save the permission matrix of a role (F-1154). Removing `users:update` from the last role that gives it to an active holder
 * is blocked: nobody could manage the team afterwards. The Owner role and system roles are not edited. Returns the grids before
 * and after, for the audit row.
 */
export async function setRolePermissions(actor: Requester, roleId: number, input: PermissionGrid) {
  const role = await findRoleWithGrid(roleId);
  assertEditable(actor, role, 'permissions');
  return saveGrid(roleId, role.grid, input);
}

/** The one write of a grid (the grid setter, the switch setter, the Settings matrix): clean it, apply the last-manager guard, save, drop cached access. */
export async function saveGrid(roleId: number, before: PermissionGrid, input: PermissionGrid) {
  const after = cleanGrid(input);
  const losesUsersUpdate = grants(before, 'users', 'update') && !grants(after, 'users', 'update');
  // Only a role with an active holder takes the permission away from someone.
  if (losesUsersUpdate && await hasActiveHolder(roleId) && !(await otherRoleKeepsUsersUpdate(roleId))) {
    throw new AppError('This is the last role that can manage users. Give users:update to another role first', 409, 'LAST_USER_MANAGER');
  }
  await prisma.role.update({ where: { id: roleId }, data: { permissions: after } });
  await invalidateAccess(roleId);
  return { before, after };
}

/**
 * The Settings matrix save (one grid per UserRole). It is a thin layer on the position role mapped from each UserRole: a
 * resource named replaces that resource's list in the grid, resources left out keep theirs. Every role is resolved before the
 * first write, so a bad entry saves nothing; the writes run one after the other (the last-manager guard reads the other roles).
 * The Owner always passes every check and its grid is locked, so a `super_admin` entry is skipped.
 */
export async function saveMatrix(actor: Requester, byUserRole: Record<string, PermissionGrid>) {
  const entries = Object.entries(byUserRole).map(([userRole, grid]) => {
    const name = ROLE_NAME_BY_USER_ROLE[userRole as UserRole];
    if (!name) throw new AppError(`Unknown role: ${userRole}`, 400);
    return { userRole: userRole as UserRole, name, grid };
  }).filter((e) => e.userRole !== 'super_admin');
  const [roles, matrix] = await Promise.all([
    prisma.role.findMany({ where: { presetRole: { in: entries.map((e) => e.userRole) }, name: { in: entries.map((e) => e.name) } }, select: { id: true, name: true, presetRole: true, isSystem: true } }),
    tenantMatrix(),
  ]);
  const planned = entries.map((e) => {
    const role = roles.find((r) => r.name === e.name && r.presetRole === e.userRole);
    if (!role) throw new AppError(`The ${e.name} role is missing; seed the tenant roles first`, 409);
    assertEditable(actor, role, 'permissions');
    return { id: role.id, current: matrix[e.userRole], grid: e.grid };
  });
  for (const { id, current, grid } of planned) await saveGrid(id, current, { ...current, ...grid });
}

/**
 * Privilege rule for handing out a role: a person who is not the Owner may only give a role whose grid they hold in full
 * (every cell of it is in their own union), and never to themselves. Otherwise the union of roles would let an admin lift
 * themselves, or someone else, above their own access. The Owner may assign any role.
 */
export async function assertGridWithin(actor: Requester, role: { permissions: unknown; presetRole: UserRole | null }, holderId?: number): Promise<void> {
  if (isOwner(actor)) return;
  if (holderId === actor.id) throw new AppError('You cannot give a role to yourself', 403, 'SELF_ASSIGN');
  const [own, matrix] = await Promise.all([getUserPermissions(actor), tenantMatrix()]);
  for (const [resource, actions] of Object.entries(gridOfRole(role, matrix))) {
    const missing = actions.filter((a) => !grants(own, resource, a));
    if (missing.length) throw new AppError(`You cannot give a role that has permissions you do not have (${resource}:${missing[0]})`, 403, 'GRID_ABOVE_ACTOR');
  }
}
