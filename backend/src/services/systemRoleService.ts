import { Prisma, UserRole } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import logger from '../utils/logger';
import { mergeRolePermissions, unionPermissions } from '../config/defaultRolePermissions';
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
    if (!dryRun && rows.length) await db.roleAssignment.createMany({ data: rows });
    return result;
  });
}

export { unionPermissions };

/**
 * The Settings matrix (SystemConfig.rolePermissions) is saved: copy each UserRole's grid to the position role mapped from it,
 * so the people who hold that role (whose access is the union of role grids since M6-T04) get the change. Call inside the
 * tenant context. Roles the owner made, and Marketing, are not touched.
 */
export async function syncMappedRoleGrids(stored: unknown, db: Pick<TransactionClient, 'role'> = prisma): Promise<void> {
  const grids = mergeRolePermissions(stored);
  await Promise.all((Object.keys(ROLE_NAME_BY_USER_ROLE) as UserRole[]).map((userRole) =>
    db.role.updateMany({ where: { name: ROLE_NAME_BY_USER_ROLE[userRole], presetRole: userRole }, data: { permissions: grids[userRole] } })));
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
