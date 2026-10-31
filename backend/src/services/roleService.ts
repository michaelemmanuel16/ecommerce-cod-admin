import { Prisma, UserKind, UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { AppError } from '../middleware/errorHandler';
import { ALL_TOOL_NAMES } from '../config/toolPermissions';
import { isOwnerRole, roleToolList } from '../config/defaultRoles';
import { SYSTEM_USER_PASSWORD } from './systemUserService';
import type { CreateRoleInput, UpdateRoleInput } from '../validators/roleSchema';

/** M6-T03 (F-1150, F-1151, F-1156): roles of the current tenant. Call inside the tenant context (the request has it). */

/** Who is asking. Only the Owner (super_admin) may change the Owner role (F-1150). */
export interface RoleActor {
  id: number;
  role: UserRole;
}

export const assertMayTouchRole = (actor: RoleActor, role: { presetRole: UserRole | null }): void => {
  if (isOwnerRole(role) && actor.role !== 'super_admin') throw new AppError('Only the Owner can change the Owner role', 403);
};

const TYPE_LABEL: Record<UserKind, string> = { person: 'Human', ai_agent: 'AI agent', company: 'Company', system: 'System' };

export type HolderStatus = 'active' | 'invited' | 'deactivated';

/**
 * An invited person has no password yet (the sentinel) and is not active until they accept (T06). Anyone else who is not
 * active is deactivated.
 */
export function holderStatus(u: { isActive: boolean; invitedAt: Date | null; password: string }): HolderStatus {
  if (u.isActive) return 'active';
  return u.invitedAt !== null && u.password === SYSTEM_USER_PASSWORD ? 'invited' : 'deactivated';
}

const fullName = (u: { firstName: string; lastName: string; kind: UserKind }) =>
  u.kind === 'person' ? `${u.firstName} ${u.lastName}`.trim() : u.firstName;

const holderSelect = {
  id: true, firstName: true, lastName: true, email: true, kind: true, isActive: true, invitedAt: true, password: true,
} satisfies Prisma.UserSelect;

type HolderRow = Prisma.UserGetPayload<{ select: typeof holderSelect }>;

/** The holder as the screens need it. The password never leaves this function. */
export const holderView = (u: HolderRow) => ({
  id: u.id,
  name: fullName(u),
  email: u.email,
  kind: u.kind,
  typeLabel: TYPE_LABEL[u.kind],
  status: holderStatus(u),
});

const roleSelect = {
  id: true, name: true, area: true, contract: true, kpis: true, targetMetric: true, presetRole: true, isSystem: true, tools: true,
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

/** `toolCount` and `holderCount` keep the fields the Settings screen already reads. */
const roleView = ({ tools, ...role }: RoleRow, holderCount: number) => ({
  ...role,
  tools: roleToolList(tools),
  toolCount: roleToolList(tools).length,
  toolTotal: ALL_TOOL_NAMES.length,
  holderCount,
});

/** Live holders per role id: assignments with no end date. */
async function holderCounts(): Promise<Map<number, number>> {
  const rows = await prisma.roleAssignment.groupBy({ by: ['roleId'], where: { toDate: null }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.roleId, r._count._all]));
}

const findRole = async (id: number) => {
  const role = await prisma.role.findFirst({ where: { id }, select: roleSelect });
  if (!role) throw new AppError('Role not found', 404);
  return role;
};

/** The plain list keeps the M2 shape (no tool names, only the count) plus the holder count. */
export async function listRoles() {
  const [roles, counts] = await Promise.all([
    prisma.role.findMany({ select: roleSelect, orderBy: { name: 'asc' } }),
    holderCounts(),
  ]);
  return roles.map((r) => {
    const { tools, ...rest } = roleView(r, counts.get(r.id) ?? 0);
    return rest;
  });
}

export async function getRole(id: number) {
  const [role, counts] = await Promise.all([findRole(id), holderCounts()]);
  return roleView(role, counts.get(id) ?? 0);
}

/** The target of a role for the month that holds `today`, if one is set. */
async function currentRoleTargets(roleIds: number[], today: Date) {
  const rows = await prisma.target.findMany({
    where: { roleId: { in: roleIds }, scope: 'role', periodStart: { lte: today }, periodEnd: { gte: today } },
    orderBy: { periodStart: 'desc' },
  });
  const byRole = new Map<number, { metric: string; unit: string; value: string; periodStart: Date; periodEnd: Date }>();
  for (const t of rows) {
    if (t.roleId !== null && !byRole.has(t.roleId)) {
      byRole.set(t.roleId, { metric: t.metric, unit: t.unit, value: t.value.toString(), periodStart: t.periodStart, periodEnd: t.periodEnd });
    }
  }
  return byRole;
}

/**
 * The role cards (F-1151): every role the owner manages (the Legacy MCP role is a system role and has no card), with the
 * people holding it now, a tag per holder, the tool count, and the target for this month if one is set. A holder whose
 * assignment has ended is not on the card; see listAssignments for the history.
 */
export async function roleOverview() {
  const roles = await prisma.role.findMany({ where: { isSystem: false }, select: roleSelect, orderBy: { id: 'asc' } });
  const ids = roles.map((r) => r.id);
  const [assignments, targets] = await Promise.all([
    // Invited people are inactive, so the soft-delete filter must not hide them.
    withSoftDeleted(() => prisma.roleAssignment.findMany({
      where: { roleId: { in: ids }, toDate: null },
      select: { id: true, roleId: true, fromDate: true, holder: { select: holderSelect } },
      orderBy: { id: 'asc' },
    })),
    currentRoleTargets(ids, startOfUtcDay()),
  ]);
  return roles.map((role) => {
    const holders = assignments
      .filter((a) => a.roleId === role.id)
      .map((a) => ({ assignmentId: a.id, since: a.fromDate, ...holderView(a.holder) }));
    return { ...roleView(role, holders.length), holders, target: targets.get(role.id) ?? null };
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

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Make a custom role (F-1156). It has the tools of `copyToolsFromRoleId`, or none. */
export async function createRole(tenantId: string, input: CreateRoleInput) {
  if (await nameTaken(input.name)) throw new AppError(NAME_TAKEN, 409);
  let tools: string[] = [];
  if (input.copyToolsFromRoleId !== undefined) {
    const source = await prisma.role.findFirst({ where: { id: input.copyToolsFromRoleId }, select: { tools: true } });
    if (!source) throw new AppError('Role to copy from was not found', 400);
    tools = roleToolList(source.tools);
  }
  try {
    const role = await prisma.role.create({
      data: {
        tenantId, name: input.name, area: input.area ?? null, contract: input.contract ?? {}, kpis: input.kpis ?? [],
        targetMetric: input.targetMetric ?? null, tools, isSystem: false,
      },
      select: roleSelect,
    });
    return roleView(role, 0);
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(NAME_TAKEN, 409);
    throw e;
  }
}

/**
 * Edit the card fields of a role. Tools and the permission grid are M6-T04. A system role (Legacy MCP) is not edited here, and a
 * role built from a UserRole keeps its name: the position role of a new user is found by that name.
 */
export async function updateRole(actor: RoleActor, id: number, input: UpdateRoleInput) {
  const role = await findRole(id);
  assertMayTouchRole(actor, role);
  if (role.isSystem) throw new AppError('A system role cannot be changed', 400);
  if (input.name !== undefined && input.name !== role.name) {
    if (role.presetRole) throw new AppError('A position role keeps its name', 400);
    if (await nameTaken(input.name, id)) throw new AppError(NAME_TAKEN, 409);
  }
  try {
    const updated = await prisma.role.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.area !== undefined && { area: input.area }),
        ...(input.contract !== undefined && { contract: input.contract }),
        ...(input.kpis !== undefined && { kpis: input.kpis }),
        ...(input.targetMetric !== undefined && { targetMetric: input.targetMetric }),
      },
      select: roleSelect,
    });
    return roleView(updated, (await holderCounts()).get(id) ?? 0);
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
  const role = await prisma.role.findFirst({ where: { id: roleId }, select: { id: true, presetRole: true, isSystem: true } });
  if (!role) throw new AppError('Role not found', 404);
  if (isOwnerRole(role)) throw new AppError('The Owner role cannot be deleted', 400);
  if (role.isSystem) throw new AppError('A system role cannot be deleted', 400);
  const holders = await prisma.roleAssignment.count({ where: { roleId, toDate: null } });
  if (holders > 0) throw new AppError(`Move ${holders} holders first`, 409, 'ROLE_HAS_HOLDERS');
  const keys = await prisma.mcpApiKey.count({ where: { roleId } });
  if (keys > 0) throw new AppError(`This role is used by ${keys} API keys`, 409, 'ROLE_HAS_KEYS');
  await prisma.role.delete({ where: { id: role.id } });
}
