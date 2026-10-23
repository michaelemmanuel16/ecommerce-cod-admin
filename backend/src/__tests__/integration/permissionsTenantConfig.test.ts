/**
 * COD-30 F4: the permission lookup reads only the caller's own SystemConfig row.
 * Tenant A saved a restrictive sales_rep matrix, tenant B has no row.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { clearPermissionsCache, hasPermission } from '../../middleware/auth';
import { runInTenant, withoutTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

jest.setTimeout(60_000);

let tenantA: string;
let tenantB: string;
const rep = { role: 'sales_rep' };

beforeAll(async () => {
  tenantA = (await createTenant('Perm A')).id;
  tenantB = (await createTenant('Perm B')).id;
  // Tenant A: a sales_rep who may do nothing with orders.
  await prismaBase.systemConfig.create({ data: { tenantId: tenantA, rolePermissions: { sales_rep: { orders: [] } } as any } });
});

beforeEach(() => clearPermissionsCache());

afterAll(async () => {
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prismaBase.$disconnect();
});

describe('permission lookup is per tenant', () => {
  it("tenant A's saved matrix applies to tenant A", async () => {
    expect(await runInTenant(tenantA, () => hasPermission(rep, 'orders', 'view'))).toBe(false);
  });

  it('tenant B has no row, so its rep gets the default permissions', async () => {
    expect(await runInTenant(tenantB, () => hasPermission(rep, 'orders', 'view'))).toBe(true);
  });

  it("a lookup with no tenant does not read tenant A's row", async () => {
    const platformRow = await prismaBase.systemConfig.findFirst({ where: { tenantId: null } });
    const allowed = await withoutTenant('F4 test', () => hasPermission(rep, 'orders', 'view'));
    // With a platform row the result depends on that row, so the check needs a DB without one.
    if (!platformRow) expect(allowed).toBe(true);
  });

  it('asks for the tenantId-null row when there is no tenant, and the tenant row inside a tenant', async () => {
    const spy = jest.spyOn(prisma.systemConfig, 'findFirst');
    await withoutTenant('F4 test', () => hasPermission(rep, 'orders', 'view'));
    expect(spy).toHaveBeenLastCalledWith({ where: { tenantId: null } });
    clearPermissionsCache();
    await runInTenant(tenantB, () => hasPermission(rep, 'orders', 'view'));
    expect(spy).toHaveBeenLastCalledWith({ where: { tenantId: tenantB } });
  });
});
