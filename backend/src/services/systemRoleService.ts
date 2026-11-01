import { Prisma, UserRole } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import logger from '../utils/logger';
import { invalidateAccess } from './accessService';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { ROLE_NAME_BY_USER_ROLE, defaultRoleRows } from '../config/defaultRoles';

type Db = Pick<TransactionClient, 'role' | 'roleAssignment' | 'systemConfig' | 'user'>;

export interface SystemRoleResult {
  /** Role rows inserted. */
  created: number;
  /** Existing rows that got a preset or a permission grid. */
  filled: number;
}

/**
 * The migration side of the system roles (M6-T02, F-1155); the server-boot seed only inserts missing rows. Insert the roles
 * the tenant lacks (Admin, Manager), and give an existing role the `presetRole` or `permissions` it has none of. The grid of a
 * mapped role is the tenant's saved matrix over the defaults, so an edited matrix is copied, not reset. A field that is set is
 * left alone (the owner may have changed it since). Idempotent. `dryRun` only counts. Call inside runInTenant.
 */
export async function seedSystemRoles(tenantId: string, db: Db = prisma, dryRun = false): Promise<SystemRoleResult> {
  const config = await db.systemConfig.findFirst({ select: { rolePermissions: true } });
  const rows = defaultRoleRows(config?.rolePermissions);
  const existing = new Map((await db.role.findMany({ select: { id: true, name: true, presetRole: true, permissions: true } })).map((r) => [r.name, r]));

  const missing = rows.filter((r) => !existing.has(r.name));
  if (!dryRun && missing.length) await db.role.createMany({ data: missing.map((r) => ({ ...r, tenantId })), skipDuplicates: true });

  let filled = 0;
  for (const r of rows) {
    const row = existing.get(r.name);
    if (!row || !r.presetRole) continue;
    const data: Prisma.RoleUpdateInput = {};
    if (row.presetRole == null) data.presetRole = r.presetRole;
    if (row.permissions == null && r.permissions) data.permissions = r.permissions;
    if (!Object.keys(data).length) continue;
    filled++;
    if (!dryRun) await db.role.update({ where: { tenantId_name: { tenantId, name: r.name } }, data });
  }
  return { created: missing.length, filled };
}

export interface UserMigrationResult {
  /** New RoleAssignment rows by UserRole. */
  assigned: Partial<Record<UserRole, number>>;
  /** Users that already hold their mapped role. */
  alreadyHeld: number;
}

/**
 * Give every person and company user of the tenant a RoleAssignment to the role mapped from their UserRole (F-1155).
 * System and AI agent users are not staff and get none. Inactive users are included (the soft-delete filter is off).
 * Idempotent: a user who already holds the mapped role is skipped. Run `seedSystemRoles` first: outside a dry run a missing
 * mapped role is an error. Call inside runInTenant.
 */
export async function assignUsersToPositionRoles(tenantId: string, db: Db = prisma, dryRun = false): Promise<UserMigrationResult> {
  return withSoftDeleted(async () => {
    const [users, roles, held] = await Promise.all([
      db.user.findMany({ where: { kind: { in: ['person', 'company'] } }, select: { id: true, role: true, createdAt: true } }),
      db.role.findMany({ select: { id: true, name: true } }),
      db.roleAssignment.findMany({ select: { holderId: true, roleId: true } }),
    ]);
    const roleId = new Map(roles.map((r) => [r.name, r.id]));
    const heldKeys = new Set(held.map((h) => `${h.holderId}:${h.roleId}`));
    const result: UserMigrationResult = { assigned: {}, alreadyHeld: 0 };
    const rows: Prisma.RoleAssignmentCreateManyInput[] = [];
    for (const u of users) {
      const name = ROLE_NAME_BY_USER_ROLE[u.role];
      const id = roleId.get(name);
      if (id != null && heldKeys.has(`${u.id}:${id}`)) { result.alreadyHeld++; continue; }
      // A dry run may come before the roles exist; those users still count as not yet holding their role.
      if (id == null && !dryRun) throw new Error(`Role "${name}" is missing; seed the system roles first`);
      result.assigned[u.role] = (result.assigned[u.role] ?? 0) + 1;
      if (id != null) rows.push({ tenantId, roleId: id, holderId: u.id, fromDate: startOfUtcDay(u.createdAt) });
    }
    if (!dryRun && rows.length) {
      await db.roleAssignment.createMany({ data: rows });
      await invalidateAccess();
    }
    return result;
  });
}

/**
 * The id of the position role mapped from a UserRole (F-1155), or null when the tenant has not seeded its roles yet (a warning
 * is logged; `scripts/migrate-users-to-roles.ts`, idempotent, fills the gap). A new user is created with a nested assignment
 * to this role. Call inside the tenant context.
 */
export async function positionRoleId(db: Pick<TransactionClient, 'role'>, userRole: UserRole): Promise<number | null> {
  const name = ROLE_NAME_BY_USER_ROLE[userRole];
  const role = await db.role.findFirst({ where: { name }, select: { id: true } });
  if (!role) logger.warn(`Position role "${name}" is missing; new ${userRole} users get no role assignment yet`);
  return role?.id ?? null;
}

/**
 * Keep the position role of a person in step with their UserRole (F-1155, M6-T05). Ends the open assignments to any other
 * position role (the roles mapped from a UserRole) and holds the one mapped from `userRole`. Custom roles and Marketing are
 * left alone. A tenant that has not seeded its roles yet is a no-op with a warning. Call inside the tenant context.
 */
export async function assignPositionRole(db: Pick<TransactionClient, 'role' | 'roleAssignment'>, userId: number, userRole: UserRole): Promise<void> {
  const target = await positionRoleId(db, userRole);
  if (target === null) return;
  const today = startOfUtcDay();
  await db.roleAssignment.updateMany({
    where: { holderId: userId, toDate: null, roleId: { not: target }, role: { name: { in: Object.values(ROLE_NAME_BY_USER_ROLE) } } },
    data: { toDate: today },
  });
  if ((await db.roleAssignment.count({ where: { holderId: userId, roleId: target, toDate: null } })) === 0) {
    await db.roleAssignment.create({ data: { tenantId: resolveTenantId(), roleId: target, holderId: userId, fromDate: today } });
  }
}

/**
 * The last active Owner (super_admin person) cannot be deactivated, deleted, demoted or erased (M6-T05). No-op for anyone else.
 * Call inside the transaction that makes the change: it locks the tenant's active Owner rows first, so two Owners ending each
 * other at once run one after the other and the second sees one Owner left. Raw SQL on purpose: the lock needs `FOR UPDATE`,
 * and the tenant is named here so it also works on the un-extended client. `verb` completes "The last Owner cannot be ...".
 */
export async function assertNotLastOwner(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  target: { id: number; role: UserRole },
  verb: string,
): Promise<void> {
  if (target.role !== 'super_admin') return;
  const owners = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM users WHERE tenant_id = ${resolveTenantId()} AND role = 'super_admin' AND kind = 'person' AND is_active FOR UPDATE`;
  if (owners.every((o) => o.id === target.id)) throw new AppError(`The last Owner cannot be ${verb}`, 409, 'LAST_OWNER');
}
