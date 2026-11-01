/**
 * M6-T02 (COD-56): system roles per tenant and the user migration (scripts/migrate-users-to-roles.ts).
 * For each of the seven UserRole values the permissions of the new role equal what the user had before (middleware view),
 * with an edited matrix and with the defaults; second run changes nothing; Owner cannot be deleted; dry run writes nothing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import { UserRole } from '@prisma/client';
import { prismaBase } from '../../utils/prisma';
import { clearPermissionsCache, getEffectivePermissions } from '../../middleware/auth';
import { runInTenant } from '../../utils/tenantContext';
import { unionPermissions } from '../../config/defaultRolePermissions';
import { deleteRole } from '../../services/roleService';
import { DEFAULT_ROLES, ROLE_NAME_BY_USER_ROLE } from '../../config/defaultRoles';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { migrateTenant } from '../../../scripts/migrate-users-to-roles';

jest.setTimeout(120_000);

const db = prismaBase;
const USER_ROLES = Object.keys(ROLE_NAME_BY_USER_ROLE) as UserRole[];
// What the owner saved earlier: a replaced list per resource, for four roles. Everything not listed keeps its default.
const EDITED = {
  sales_rep: { orders: ['view'], calls: ['create', 'view', 'update'] },
  accountant: { gl: ['view'], expenses: [] },
  admin: { settings: ['view', 'update'], workflows: [] },
  manager: { users: ['view'] },
};

let edited: string;
let plain: string;
let usersOf: Record<string, Record<string, number>> = {};
const tenants = () => [edited, plain];

/** A tenant as it was before M6-T02: the M2 roles (no Admin, Manager, preset or grid), the users, and maybe an edited matrix. */
async function legacyTenant(label: string, withMatrix: boolean) {
  const id = (await createTenant(label)).id;
  const m2Roles = DEFAULT_ROLES.filter((r) => !['Admin', 'Manager'].includes(r.name));
  await db.role.createMany({ data: m2Roles.map((r) => ({ name: r.name, area: r.area, contract: r.contract, tools: r.tools, isSystem: r.isSystem, kpis: [], tenantId: id })) });
  if (withMatrix) await db.systemConfig.create({ data: { tenantId: id, rolePermissions: EDITED as any } });
  const ids = await Promise.all([
    ...USER_ROLES.map(async (role) => [role, (await mkUser(id, role, role)).id] as const),
    // an inactive user is still staff
    mkUser(id, 'inactive', 'sales_rep', { isActive: false }).then((u) => ['inactive', u.id] as const),
  ]);
  usersOf[id] = Object.fromEntries(ids);
  return id;
}

const counts = async (tenantId: string) => ({
  roles: await db.role.count({ where: { tenantId } }),
  assignments: await db.roleAssignment.count({ where: { tenantId } }),
});
const assignmentsOf = (tenantId: string) => db.roleAssignment.findMany({ where: { tenantId }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  [edited, plain] = await Promise.all([legacyTenant('RoleMigEdited', true), legacyTenant('RoleMigPlain', false)]);
});

beforeEach(() => clearPermissionsCache());

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: 'orphan-m6t02' } } });
  await deleteTenantRows(tenants());
  await db.$disconnect();
});

describe('M6-T02 dry run', () => {
  it('reports the counts and writes nothing', async () => {
    const before = await counts(edited);
    const report = await migrateTenant(edited, { dryRun: true });
    expect(report.roles).toEqual({ created: 2, filled: 6 });
    expect(report.users.assigned).toMatchObject({ super_admin: 1, admin: 1, manager: 1, sales_rep: 2, delivery_agent: 1, accountant: 1, inventory_manager: 1 });
    expect(report.users.alreadyHeld).toBe(0);
    expect(await counts(edited)).toEqual(before);
    expect(await db.role.count({ where: { tenantId: edited, presetRole: { not: null } } })).toBe(0);
  });
});

describe('M6-T02 migration', () => {
  it('creates Admin and Manager, fills the other roles, and assigns every user once', async () => {
    for (const id of tenants()) {
      const report = await migrateTenant(id, { dryRun: false });
      expect(report.roles.created).toBe(2);
      const roles = await db.role.findMany({ where: { tenantId: id } });
      const preset = (name: string) => roles.find((r) => r.name === name)?.presetRole;
      expect(Object.fromEntries(USER_ROLES.map((u) => [ROLE_NAME_BY_USER_ROLE[u], preset(ROLE_NAME_BY_USER_ROLE[u])]))).toEqual(
        Object.fromEntries(USER_ROLES.map((u) => [ROLE_NAME_BY_USER_ROLE[u], u])),
      );
      expect(preset('Marketing')).toBe('manager');
      const marketing = roles.find((r) => r.name === 'Marketing')!;
      expect(await db.roleAssignment.count({ where: { roleId: marketing.id } })).toBe(0);
      expect(await db.roleAssignment.count({ where: { tenantId: id } })).toBe(USER_ROLES.length + 1);
    }
  });

  it('second run changes nothing', async () => {
    for (const id of tenants()) {
      const rolesBefore = await db.role.findMany({ where: { tenantId: id }, orderBy: { id: 'asc' } });
      const assignmentsBefore = await assignmentsOf(id);
      const report = await migrateTenant(id, { dryRun: false });
      expect(report.roles).toEqual({ created: 0, filled: 0 });
      expect(report.users.assigned).toEqual({});
      expect(report.users.alreadyHeld).toBe(USER_ROLES.length + 1);
      expect(await db.role.findMany({ where: { tenantId: id }, orderBy: { id: 'asc' } })).toEqual(rolesBefore);
      expect(await assignmentsOf(id)).toEqual(assignmentsBefore);
    }
  });

  // The "before" side is the live middleware view (stored matrix over the defaults); the "after" side is the union of the
  // grids of the roles the user holds now. A user must not gain or lose a permission.
  for (const userRole of USER_ROLES) {
    it(`${userRole}: permissions after equal permissions before (edited matrix and defaults)`, async () => {
      for (const id of tenants()) {
        const userId = usersOf[id][userRole];
        const before = await runInTenant(id, () => getEffectivePermissions(userRole));
        const held = await db.roleAssignment.findMany({ where: { holderId: userId, toDate: null }, include: { role: true } });
        expect(held.map((h) => h.role.name)).toEqual([ROLE_NAME_BY_USER_ROLE[userRole]]);
        const after = unionPermissions(held.map((h) => h.role.permissions as Record<string, string[]>));
        const norm = (g: Record<string, string[]>) => Object.fromEntries(Object.entries(g).map(([r, a]) => [r, [...a].sort()]).sort(([a], [b]) => (a as string).localeCompare(b as string)));
        expect(norm(after)).toEqual(norm(before));
      }
    });
  }

  it('copies the edited matrix instead of resetting it', async () => {
    const rep = await db.role.findFirstOrThrow({ where: { tenantId: edited, name: 'Call rep' } });
    expect((rep.permissions as any).orders).toEqual(['view']);
    expect((rep.permissions as any).calls).toEqual(['create', 'view', 'update']);
    const other = await db.role.findFirstOrThrow({ where: { tenantId: plain, name: 'Call rep' } });
    expect((other.permissions as any).orders).toEqual(['create', 'view', 'update']);
  });

  it('keeps the inactive user and leaves a user with no tenant alone', async () => {
    expect(await db.roleAssignment.count({ where: { holderId: usersOf[edited].inactive } })).toBe(1);
    const orphan = await db.user.create({ data: { email: `orphan-m6t02-${Date.now()}@codadmin.test`, password: 'x', firstName: 'O', lastName: 'T', role: 'admin' } });
    await migrateTenant(edited, { dryRun: false });
    expect(await db.roleAssignment.count({ where: { holderId: orphan.id } })).toBe(0);
  });
});

describe('M6-T02 Owner guard', () => {
  it('the Owner role cannot be deleted; another role can', async () => {
    const owner = await db.role.findFirstOrThrow({ where: { tenantId: edited, name: 'Owner' } });
    await expect(runInTenant(edited, () => deleteRole(owner.id))).rejects.toThrow('The Owner role cannot be deleted');
    expect(await db.role.count({ where: { id: owner.id } })).toBe(1);
    const marketing = await db.role.findFirstOrThrow({ where: { tenantId: edited, name: 'Marketing' } });
    await runInTenant(edited, () => deleteRole(marketing.id));
    expect(await db.role.count({ where: { id: marketing.id } })).toBe(0);
  });

  it('deleteRole does not reach another tenant', async () => {
    const other = await db.role.findFirstOrThrow({ where: { tenantId: plain, name: 'Marketing' } });
    await expect(runInTenant(edited, () => deleteRole(other.id))).rejects.toThrow('Role not found');
  });
});
