import { Prisma, UserRole } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import {
  MARKETING_PERMISSIONS, MARKETING_PRESET, MARKETING_ROLE_NAME, POSITION_ROLES, PermissionGrid, ROLE_NAME_BY_USER_ROLE,
  currentGridByUserRole,
} from '../config/systemRoles';

type Db = Pick<TransactionClient, 'role' | 'roleAssignment' | 'systemConfig' | 'user'>;

export interface SystemRoleResult {
  /** Admin and Manager rows created. */
  created: number;
  /** Existing rows that got their preset or permission grid. */
  filled: number;
}

/**
 * Give the tenant its system roles (M6-T02, F-1155): create Admin and Manager, then set `presetRole` and `permissions` on the
 * seven mapped roles and Marketing. The grid of a UserRole role is the tenant's saved matrix over the defaults, so an
 * edited matrix is copied, not reset. A role that already has a grid is left alone (the owner may have changed it since).
 * Idempotent. `dryRun` only counts. Call inside runInTenant.
 */
export async function seedSystemRoles(tenantId: string, db: Db = prisma, dryRun = false): Promise<SystemRoleResult> {
  const config = await db.systemConfig.findFirst({ select: { rolePermissions: true } });
  const grids = currentGridByUserRole(config?.rolePermissions);
  const existing = await db.role.findMany({ select: { id: true, name: true, presetRole: true, permissions: true } });
  const byName = new Map(existing.map((r) => [r.name, r]));

  const missing = POSITION_ROLES.filter((r) => !byName.has(r.name));
  if (!dryRun && missing.length) {
    await db.role.createMany({ data: missing.map((r) => ({ ...r, tenantId, kpis: [] })), skipDuplicates: true });
  }

  const wanted: Array<{ name: string; presetRole: UserRole; permissions: PermissionGrid }> = [
    ...(Object.keys(ROLE_NAME_BY_USER_ROLE) as UserRole[]).map((u) => ({ name: ROLE_NAME_BY_USER_ROLE[u], presetRole: u, permissions: grids[u] })),
    { name: MARKETING_ROLE_NAME, presetRole: MARKETING_PRESET, permissions: MARKETING_PERMISSIONS },
  ];
  let filled = 0;
  for (const w of wanted) {
    const row = byName.get(w.name);
    // A role created just above has no row in `byName`, and a dry run has not created it yet: both count as filled.
    if (row && row.presetRole != null && row.permissions != null) continue;
    filled++;
    if (dryRun) continue;
    const data = { presetRole: row?.presetRole ?? w.presetRole, permissions: row?.permissions ?? (w.permissions as Prisma.InputJsonValue) };
    await db.role.update({ where: { tenantId_name: { tenantId, name: w.name } }, data });
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
 * Idempotent: a user who already holds the mapped role is skipped. Run `seedSystemRoles` first. Call inside runInTenant.
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
      const id = roleId.get(ROLE_NAME_BY_USER_ROLE[u.role]);
      if (id != null && heldKeys.has(`${u.id}:${id}`)) { result.alreadyHeld++; continue; }
      result.assigned[u.role] = (result.assigned[u.role] ?? 0) + 1;
      // In a dry run the roles may not exist yet; the count is what matters.
      if (id != null) rows.push({ tenantId, roleId: id, holderId: u.id, fromDate: new Date(Date.UTC(u.createdAt.getUTCFullYear(), u.createdAt.getUTCMonth(), u.createdAt.getUTCDate())) });
    }
    if (!dryRun && rows.length) await db.roleAssignment.createMany({ data: rows });
    return result;
  });
}

/** Union of the permission grids of the roles a person holds (F-1155). M6-T04 puts this behind the middleware. */
export function unionPermissions(grids: Array<PermissionGrid | null | undefined>): PermissionGrid {
  const union: Record<string, Set<string>> = {};
  for (const grid of grids) {
    for (const [resource, actions] of Object.entries(grid ?? {})) {
      union[resource] ??= new Set();
      for (const a of actions) union[resource].add(a);
    }
  }
  return Object.fromEntries(Object.entries(union).map(([r, s]) => [r, [...s]]));
}
