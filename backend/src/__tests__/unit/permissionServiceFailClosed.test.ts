/**
 * COD-56: the permission reads fail closed with a 5xx, never with a 403 that looks like a permission answer, and a read
 * that started before an invalidation never fills the cache with old data after it.
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
import { clearPermissionsCache, forgetUser, getUserPermissions, isUserActive } from '../../services/permissionService';
import { requireResourcePermission } from '../../middleware/auth';

const db = prisma as unknown as {
  systemConfig: { findFirst: jest.Mock<(...a: unknown[]) => Promise<unknown>> };
  role: { findMany: jest.Mock<(...a: unknown[]) => Promise<unknown>> };
  roleAssignment: { findMany: jest.Mock<(...a: unknown[]) => Promise<unknown>> };
  user: { findFirst: jest.Mock<(...a: unknown[]) => Promise<unknown>> };
};

const TENANT = 'tenant-cod56';
const held = (permissions: Record<string, string[]>) => [{ role: { permissions, presetRole: null } }];
const asUser = <T>(fn: () => Promise<T>) => runInTenant(TENANT, fn);
const manager = { id: 7, role: 'manager' as const };

beforeEach(() => {
  clearPermissionsCache();
  jest.resetAllMocks();
  db.systemConfig.findFirst.mockResolvedValue(null);
  db.role.findMany.mockResolvedValue([]);
});

describe('a failed permission read', () => {
  it('is an error, not the default grid: a failed matrix read does not turn into a permission answer', async () => {
    db.systemConfig.findFirst.mockRejectedValueOnce(new Error('pool timeout'));
    db.roleAssignment.findMany.mockResolvedValue([]);
    await expect(asUser(() => getUserPermissions(manager))).rejects.toThrow('pool timeout');
  });

  it('is not cached: the next read after the database recovers gives the real grid', async () => {
    db.systemConfig.findFirst.mockRejectedValueOnce(new Error('pool timeout'));
    db.roleAssignment.findMany.mockResolvedValue(held({ users: ['view'] }));
    await expect(asUser(() => getUserPermissions(manager))).rejects.toThrow();
    expect(await asUser(() => getUserPermissions(manager))).toEqual({ users: ['view'] });
  });

  it('the middleware answers 500 (and denies), not 403', async () => {
    db.roleAssignment.findMany.mockRejectedValue(new Error('statement timeout'));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    await asUser(() => requireResourcePermission('users', 'view')({ user: { ...manager, tenantId: TENANT } } as never, res as never, next));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('a read that started before an invalidation', () => {
  it('does not keep its old result in the cache', async () => {
    let finishOld!: (rows: unknown) => void;
    db.roleAssignment.findMany.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
    const inFlight = asUser(() => getUserPermissions(manager)); // reads the old assignments
    await new Promise((r) => setImmediate(r));
    clearPermissionsCache(TENANT); // the assignment changed and the cache was dropped
    finishOld(held({ orders: ['view'] })); // the old read lands after the clear
    expect(await inFlight).toEqual({ orders: ['view'] }); // that request itself may see the old answer

    db.roleAssignment.findMany.mockResolvedValue(held({ orders: ['view'], users: ['view'] }));
    expect(await asUser(() => getUserPermissions(manager))).toEqual({ orders: ['view'], users: ['view'] });
  });
});

describe('the active-user check (authenticate)', () => {
  const activeRow = { roleAssignments: held({ orders: ['view'] }) };

  it('reads once, then answers from the cache; forgetUser makes the next call read again and refuse', async () => {
    db.user.findFirst.mockResolvedValueOnce(activeRow);
    expect(await asUser(() => isUserActive(TENANT, 7))).toBe(true);
    expect(await asUser(() => isUserActive(TENANT, 7))).toBe(true);
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    forgetUser(7, TENANT);
    db.user.findFirst.mockResolvedValueOnce(null);
    expect(await asUser(() => isUserActive(TENANT, 7))).toBe(false);
    expect(db.user.findFirst).toHaveBeenCalledTimes(2);
  });

  it('an inactive user is not cached: every call reads', async () => {
    db.user.findFirst.mockResolvedValue(null);
    expect(await asUser(() => isUserActive(TENANT, 8))).toBe(false);
    expect(await asUser(() => isUserActive(TENANT, 8))).toBe(false);
    expect(db.user.findFirst).toHaveBeenCalledTimes(2);
  });

  it('a grid read for a user does not make them count as active', async () => {
    db.roleAssignment.findMany.mockResolvedValue(held({ orders: ['view'] }));
    await asUser(() => getUserPermissions({ id: 9, role: 'manager' }));
    db.user.findFirst.mockResolvedValueOnce(null);
    expect(await asUser(() => isUserActive(TENANT, 9))).toBe(false);
  });

  it('concurrent misses share one read', async () => {
    db.user.findFirst.mockResolvedValue(activeRow);
    const [a, b] = await asUser(() => Promise.all([isUserActive(TENANT, 10), isUserActive(TENANT, 10)]));
    expect([a, b]).toEqual([true, true]);
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
  });
});
