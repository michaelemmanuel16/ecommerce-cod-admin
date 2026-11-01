import { Prisma, UserKind, UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { isUniqueViolation } from '../utils/prismaErrors';
import { fullName } from '../utils/nameUtils';
import { Requester, isOwner } from '../utils/authUtils';
import { getTenantMatrix } from './permissionService';
import { resolveTenantId } from '../utils/tenantContext';
import { invalidateAccess } from './accessService';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { AppError } from '../middleware/errorHandler';
import { ROLE_TOOL_TOTAL, gridOfRole, sameGrid, gridFromSwitches, switchesOn } from '../config/roleToolRules';
import { defaultRolePermissions } from '../config/defaultRolePermissions';
import { DEFAULT_ROLES, isOwnerRole, isPositionRole, roleToolList } from '../config/defaultRoles';
import type { CreateRoleInput, UpdateRoleInput } from '../validators/roleSchema';

/** M6-T03 (F-1150, F-1151, F-1156): roles of the current tenant. Call inside the tenant context (the request has it). */

/** Only the Owner (super_admin) may change the Owner role (F-1150). */
export const assertMayTouchRole = (actor: Requester, role: { presetRole: UserRole | null }): void => {
  if (isOwnerRole(role) && !isOwner(actor)) throw new AppError('Only the Owner can change the Owner role', 403);
};

const TYPE_LABEL: Record<UserKind, string> = { person: 'Human', ai_agent: 'AI agent', company: 'Company', system: 'System' };

export type HolderStatus = 'active' | 'invited' | 'deactivated';

/** An inactive user with an invite date has not accepted yet (T06 sets the user active); any other inactive user is deactivated. */
export function holderStatus(u: { isActive: boolean; invitedAt: Date | null }): HolderStatus {
  if (u.isActive) return 'active';
  return u.invitedAt !== null ? 'invited' : 'deactivated';
}

/** The user fields a role card needs. One copy: every holder read and every holder-creating write selects exactly this. */
export const holderSelect = {
  id: true, firstName: true, lastName: true, email: true, kind: true, isActive: true, invitedAt: true,
} satisfies Prisma.UserSelect;

type HolderRow = Prisma.UserGetPayload<{ select: typeof holderSelect }>;

/** The holder as the screens need it. */
export const holderView = (u: HolderRow) => ({
  id: u.id,
  name: u.kind === 'person' ? fullName(u) : u.firstName,
  email: u.email,
  kind: u.kind,
  typeLabel: TYPE_LABEL[u.kind],
  status: holderStatus(u),
});

export const assignmentSelect = { id: true, roleId: true, holderId: true, fromDate: true, toDate: true } satisfies Prisma.RoleAssignmentSelect;

const roleSelect = {
  id: true, name: true, area: true, contract: true, kpis: true, targetMetric: true, presetRole: true, isSystem: true, tools: true, permissions: true,
} satisfies Prisma.RoleSelect;

type Matrix = Awaited<ReturnType<typeof getTenantMatrix>>;

/** The matrix of the current tenant (call inside the tenant context). */
const tenantMatrix = () => getTenantMatrix(resolveTenantId());

let defaultMatrix: ReturnType<typeof defaultRolePermissions> | undefined;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

/**
 * A role is "Custom" (M6-T04, F-1154) when its grid is neither the preset it was seeded with nor what its tool switches give on
 * their own, i.e. someone edited single cells.
 */
export function isCustomGrid(role: { name: string; presetRole: UserRole | null }, grid: Record<string, string[]>): boolean {
  if (sameGrid(grid, gridFromSwitches(switchesOn(grid)))) return false;
  const seeded = DEFAULT_ROLES.find((r) => r.name === role.name);
  const preset = seeded?.permissions ?? (role.presetRole && isPositionRole(role) ? (defaultMatrix ??= defaultRolePermissions())[role.presetRole] : undefined);
  return !preset || !sameGrid(grid, preset);
}

/**
 * `tools` are the switches that are on: read from the grid (the one store), so a role seeded before the 16 switches reads right.
 * The system role keeps its list of registry tool names. `toolCount` and `holderCount` keep the fields the Settings screen already
 * reads. The plain list leaves the tool names out.
 */
export const roleView = ({ tools, permissions, ...role }: RoleRow, holderCount: number, matrix: Matrix, withTools = true) => {
  const grid = gridOfRole({ permissions, presetRole: role.presetRole }, matrix);
  const list = role.isSystem ? roleToolList(tools) : switchesOn(grid);
  return {
    ...role, ...(withTools && { tools: list }), toolCount: list.length, toolTotal: ROLE_TOOL_TOTAL, holderCount,
    custom: !role.isSystem && isCustomGrid(role, grid),
  };
};

/** A role of the current tenant, or 404. */
export async function findRole(id: number): Promise<RoleRow> {
  const role = await prisma.role.findFirst({ where: { id }, select: roleSelect });
  if (!role) throw new AppError('Role not found', 404);
  return role;
}

export const liveHolders = (roleId: number) => prisma.roleAssignment.count({ where: { roleId, toDate: null } });

/** The plain list keeps the M2 shape (no tool names, only the count) plus the holder count. */
export async function listRoles() {
  const [roles, counts, matrix] = await Promise.all([
    prisma.role.findMany({ select: roleSelect, orderBy: { name: 'asc' } }),
    prisma.roleAssignment.groupBy({ by: ['roleId'], where: { toDate: null }, _count: { _all: true } }),
    tenantMatrix(),
  ]);
  const byRole = new Map(counts.map((r) => [r.roleId, r._count._all]));
  return roles.map((r) => roleView(r, byRole.get(r.id) ?? 0, matrix, false));
}

export async function getRole(id: number) {
  const [role, holders, matrix] = await Promise.all([findRole(id), liveHolders(id), tenantMatrix()]);
  return roleView(role, holders, matrix);
}

/**
 * The role cards (F-1151): every role the owner manages (the Legacy MCP role is a system role and has no card), with the
 * people holding it now, a tag per holder, the tool count, and the target for this month if one is set. A holder whose
 * assignment has ended is not on the card; see listAssignments for the history.
 */
export async function roleOverview() {
  const today = startOfUtcDay();
  const [roles, assignments, targets, matrix] = await Promise.all([
    prisma.role.findMany({ where: { isSystem: false }, select: roleSelect, orderBy: { id: 'asc' } }),
    // Invited people are inactive, so the soft-delete filter must not hide them.
    withSoftDeleted(() => prisma.roleAssignment.findMany({
      where: { toDate: null, role: { isSystem: false } },
      select: { id: true, roleId: true, fromDate: true, holder: { select: holderSelect } },
      orderBy: { id: 'asc' },
    })),
    prisma.target.findMany({
      where: { scope: 'role', role: { isSystem: false }, periodStart: { lte: today }, periodEnd: { gte: today } },
      orderBy: { periodStart: 'desc' },
    }),
    tenantMatrix(),
  ]);
  const holdersOf = new Map<number, Array<{ assignmentId: number; since: Date } & ReturnType<typeof holderView>>>();
  for (const a of assignments) {
    const list = holdersOf.get(a.roleId) ?? [];
    list.push({ assignmentId: a.id, since: a.fromDate, ...holderView(a.holder) });
    holdersOf.set(a.roleId, list);
  }
  const targetOf = new Map<number, { metric: string; unit: string; value: string; periodStart: Date; periodEnd: Date }>();
  for (const t of targets) {
    if (t.roleId !== null && !targetOf.has(t.roleId)) {
      targetOf.set(t.roleId, { metric: t.metric, unit: t.unit, value: t.value.toString(), periodStart: t.periodStart, periodEnd: t.periodEnd });
    }
  }
  return roles.map((role) => {
    const holders = holdersOf.get(role.id) ?? [];
    return { ...roleView(role, holders.length, matrix), holders, target: targetOf.get(role.id) ?? null };
  });
}

/** Every assignment of a role, the current ones first, then the ended ones (history). */
export async function listAssignments(roleId: number) {
  await findRole(roleId);
  const rows = await withSoftDeleted(() => prisma.roleAssignment.findMany({
    where: { roleId },
    select: { id: true, fromDate: true, toDate: true, holder: { select: holderSelect } },
  }));
  return rows
    .map((a) => ({ assignmentId: a.id, from: a.fromDate, to: a.toDate, current: a.toDate === null, ...holderView(a.holder) }))
    .sort((x, y) => Number(y.current) - Number(x.current) || y.from.getTime() - x.from.getTime() || y.assignmentId - x.assignmentId);
}

const nameTaken = async (name: string, exceptId?: number) =>
  (await prisma.role.count({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) } })) > 0;

const NAME_TAKEN = 'A role with this name already exists';

/** A role the app seeds (Owner, Call rep, ..., Marketing, Admin, Manager): the position role of a new user is found by this name. */
const isDefaultRoleName = (name: string) => DEFAULT_ROLES.some((r) => r.name === name);

/** Make a custom role (F-1156). It has the tools of `copyToolsFromRoleId`, or none. */
export async function createRole(tenantId: string, input: CreateRoleInput) {
  const [taken, source] = await Promise.all([
    nameTaken(input.name),
    input.copyToolsFromRoleId === undefined
      ? null
      : prisma.role.findFirst({ where: { id: input.copyToolsFromRoleId }, select: { permissions: true, presetRole: true, isSystem: true } }),
  ]);
  if (taken) throw new AppError(NAME_TAKEN, 409);
  if (input.copyToolsFromRoleId !== undefined && !source) throw new AppError('Role to copy from was not found', 400);
  // The new role gets the grid of the role it copies (a system role has none), else an empty one: it never falls back to a base-role matrix.
  const grid = source && !source.isSystem ? gridOfRole(source, await tenantMatrix()) : {};
  try {
    const role = await prisma.role.create({
      data: {
        tenantId, name: input.name, area: input.area ?? null, contract: input.contract ?? {}, kpis: input.kpis ?? [],
        targetMetric: input.targetMetric ?? null, presetRole: input.presetRole ?? null, permissions: grid, isSystem: false,
      },
      select: roleSelect,
    });
    return roleView(role, 0, await tenantMatrix());
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(NAME_TAKEN, 409);
    throw e;
  }
}

/**
 * Edit the card fields of a role. Tools and the permission grid are M6-T04. A system role (Legacy MCP) is not edited here, and a
 * seeded role keeps its name. `presetRole` (the base role of its new holders) is the Owner's to set, and not on the Owner role.
 */
export async function updateRole(actor: Requester, id: number, input: UpdateRoleInput) {
  const role = await findRole(id);
  assertMayTouchRole(actor, role);
  if (role.isSystem) throw new AppError('A system role cannot be changed', 400);
  if (input.presetRole !== undefined) {
    if (!isOwner(actor)) throw new AppError('Only the Owner can set the base role of a role', 403);
    if (isOwnerRole(role)) throw new AppError('The Owner role keeps its base role', 400);
  }
  if (input.name !== undefined && input.name !== role.name) {
    if (isDefaultRoleName(role.name)) throw new AppError('A position role keeps its name', 400);
    if (await nameTaken(input.name, id)) throw new AppError(NAME_TAKEN, 409);
  }
  try {
    const [updated, holders, matrix] = await Promise.all([
      prisma.role.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.area !== undefined && { area: input.area }),
          ...(input.contract !== undefined && { contract: input.contract }),
          ...(input.kpis !== undefined && { kpis: input.kpis }),
          ...(input.targetMetric !== undefined && { targetMetric: input.targetMetric }),
          ...(input.presetRole !== undefined && { presetRole: input.presetRole }),
        },
        select: roleSelect,
      }),
      liveHolders(id),
      tenantMatrix(),
    ]);
    // The base role decides the grid of a role that has none of its own
    if (input.presetRole !== undefined) await invalidateAccess(id);
    return roleView(updated, holders, matrix);
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(NAME_TAKEN, 409);
    throw e;
  }
}

/**
 * Delete a role of the current tenant. The Owner role and system roles never go. A role with holders is blocked with
 * "Move N holders first" (N = people holding it now; ended assignments are history and do not count). A role that an MCP key
 * still points at is blocked too (the key row keeps it, even a revoked one).
 */
export async function deleteRole(roleId: number): Promise<void> {
  const role = await findRole(roleId);
  if (isOwnerRole(role)) throw new AppError('The Owner role cannot be deleted', 400);
  if (role.isSystem) throw new AppError('A system role cannot be deleted', 400);
  const [holders, keys] = await Promise.all([liveHolders(roleId), prisma.mcpApiKey.count({ where: { roleId } })]);
  if (holders > 0) throw new AppError(`Move ${holders} ${holders === 1 ? 'holder' : 'holders'} first`, 409, 'ROLE_HAS_HOLDERS');
  if (keys > 0) throw new AppError(`This role is used by ${keys} API ${keys === 1 ? 'key' : 'keys'}`, 409, 'ROLE_HAS_KEYS');
  await prisma.role.delete({ where: { id: role.id } });
}
