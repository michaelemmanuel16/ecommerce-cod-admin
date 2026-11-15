/**
 * COD-86 (M9 QA round 2): a position role seeded before a resource existed (Admin, Manager of an older tenant) has no key for it.
 * The missing key comes from the tenant's matrix (saved matrix over the defaults); a key the role stores wins, and a custom role
 * never borrows keys. The check (getUserPermissions) and the shell (gridOfRole) read the same result.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    systemConfig: { findFirst: jest.fn() },
    role: { findMany: jest.fn() },
    roleAssignment: { findMany: jest.fn() },
    user: { findFirst: jest.fn() },
  },
}));

import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { clearPermissionsCache, getTenantMatrix, getUserPermissions, hasPermission } from '../../services/permissionService';
import { gridOfRole } from '../../config/roleToolRules';
import { defaultRolePermissions } from '../../config/defaultRolePermissions';

const db = prisma as unknown as {
  systemConfig: { findFirst: jest.Mock<(...a: unknown[]) => Promise<unknown>> };
  role: { findMany: jest.Mock<(...a: unknown[]) => Promise<unknown>> };
  roleAssignment: { findMany: jest.Mock<(...a: unknown[]) => Promise<unknown>> };
};

const TENANT = 'tenant-m9-grid';
const asTenant = <T>(fn: () => Promise<T>) => runInTenant(TENANT, fn);
const admin = { id: 11, role: 'admin' as const };

/** What an Admin role row looks like on a tenant seeded before `messages` and `targets` existed. */
const { messages: _m, targets: _t, ...oldAdminGrid } = defaultRolePermissions().admin;

beforeEach(() => {
  clearPermissionsCache();
  jest.resetAllMocks();
  db.systemConfig.findFirst.mockResolvedValue(null);
});

describe('gridOfRole: a position role fills the keys it never stored', () => {
  const matrix = defaultRolePermissions();

  it('an old Admin row gets messages and targets from the matrix', () => {
    const grid = gridOfRole({ name: 'Admin', presetRole: 'admin', permissions: oldAdminGrid }, matrix);
    expect(grid.messages).toEqual(['view', 'create']);
    expect(grid.targets).toEqual(['view', 'update']);
  });

  it('a key the role stores wins, an empty list included', () => {
    const grid = gridOfRole({ name: 'Admin', presetRole: 'admin', permissions: { ...oldAdminGrid, messages: [] } }, matrix);
    expect(grid.messages).toEqual([]);
  });

  it('a custom role (Marketing, base role manager) never borrows keys', () => {
    const grid = gridOfRole({ name: 'Marketing', presetRole: 'manager', permissions: { orders: ['view'] } }, matrix);
    expect(grid).toEqual({ orders: ['view'] });
  });
});

describe('the permission check and the saved matrix', () => {
  it('Admin with an old grid may send messages: the check passes', async () => {
    db.role.findMany.mockResolvedValue([{ name: 'Admin', presetRole: 'admin', permissions: oldAdminGrid }]);
    db.roleAssignment.findMany.mockResolvedValue([{ role: { name: 'Admin', presetRole: 'admin', permissions: oldAdminGrid } }]);
    expect(await asTenant(() => hasPermission(admin, 'messages', 'create'))).toBe(true);
    expect((await asTenant(() => getUserPermissions(admin))).messages).toEqual(['view', 'create']);
  });

  it('the tenant matrix keeps the missing key too (a user with no held role reads it)', async () => {
    db.role.findMany.mockResolvedValue([{ name: 'Admin', presetRole: 'admin', permissions: oldAdminGrid }]);
    expect((await asTenant(() => getTenantMatrix(TENANT))).admin.messages).toEqual(['view', 'create']);
  });

  it('a tenant that saved the matrix gives its own cell, not the default', async () => {
    db.systemConfig.findFirst.mockResolvedValue({ rolePermissions: { admin: { messages: ['view'] } } });
    db.role.findMany.mockResolvedValue([{ name: 'Admin', presetRole: 'admin', permissions: oldAdminGrid }]);
    db.roleAssignment.findMany.mockResolvedValue([{ role: { name: 'Admin', presetRole: 'admin', permissions: oldAdminGrid } }]);
    expect((await asTenant(() => getUserPermissions(admin))).messages).toEqual(['view']);
  });
});
