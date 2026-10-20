import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import bcrypt from 'bcrypt';
import prisma from '../../utils/prisma';
import { withSoftDeleted } from '../../utils/prismaExtensions';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from '../integration/helpers/twoTenants';

describe('softDeleteExtension', () => {
  const asTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
  const itT = (name: string, fn: () => Promise<void>) => it(name, () => asTenant(fn));

  let activeId: number;
  let inactiveId: number;
  let tenantId: string;

  beforeAll(async () => {
    const tenant = await createTenant('Test soft');
    tenantId = tenant.id;
    const pwd = await bcrypt.hash('test', 10);
    const stamp = Date.now();
    const active = await asTenant(() => prisma.user.create({
      data: {
        email: `active-${stamp}@codadmin.test`, password: pwd,
        firstName: 'A', lastName: 'A', role: 'sales_rep' as any,
        isActive: true, tenantId,
      } as any,
    }));
    const inactive = await asTenant(() => prisma.user.create({
      data: {
        email: `inactive-${stamp}@codadmin.test`, password: pwd,
        firstName: 'I', lastName: 'I', role: 'sales_rep' as any,
        isActive: false, tenantId,
      } as any,
    }));
    activeId = active.id;
    inactiveId = inactive.id;
  });

  afterAll(async () => {
    await asTenant(() => prisma.user.deleteMany({ where: { id: { in: [activeId, inactiveId] } } } as any));
    await deleteTenantRows([tenantId]);
  });

  itT('hides inactive users from findUnique by default', async () => {
    const u = await prisma.user.findUnique({ where: { id: inactiveId } });
    expect(u).toBeNull();
  });

  itT('returns inactive users from findUnique inside withSoftDeleted', async () => {
    const u = await withSoftDeleted(() => prisma.user.findUnique({ where: { id: inactiveId } }));
    expect(u).not.toBeNull();
    expect(u!.id).toBe(inactiveId);
    expect(u!.isActive).toBe(false);
  });

  itT('still returns active users from findUnique inside withSoftDeleted', async () => {
    const u = await withSoftDeleted(() => prisma.user.findUnique({ where: { id: activeId } }));
    expect(u).not.toBeNull();
    expect(u!.id).toBe(activeId);
  });

  itT('reverts to filtering after the withSoftDeleted scope ends', async () => {
    await withSoftDeleted(() => prisma.user.findUnique({ where: { id: inactiveId } }));
    const u = await prisma.user.findUnique({ where: { id: inactiveId } });
    expect(u).toBeNull();
  });

  itT('keeps findMany + count consistent inside withSoftDeleted', async () => {
    const [list, total] = await withSoftDeleted(() => Promise.all([
      prisma.user.findMany({ where: { id: { in: [activeId, inactiveId] } } as any }),
      prisma.user.count({ where: { id: { in: [activeId, inactiveId] } } as any }),
    ]));
    expect(list.length).toBe(2);
    expect(total).toBe(2);
  });

  itT('still hides inactive users from findMany without withSoftDeleted', async () => {
    const list = await prisma.user.findMany({ where: { id: { in: [activeId, inactiveId] } } as any });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(activeId);
  });
});
