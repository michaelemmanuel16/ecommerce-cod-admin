/**
 * M2-T03: the per-tenant system user. One per tenant, kind = system, no usable password,
 * cannot log in (401), hidden from the staff list. The backfill (seedTenantDefaults) is idempotent.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { clearSystemUserIdCache, ensureSystemUser, getSystemUserId, isReservedSystemEmail, SYSTEM_EMAIL_DOMAIN, SYSTEM_USER_PASSWORD } from '../../services/systemUserService';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { adminService } from '../../services/adminService';

let pair: TwoTenants;

beforeAll(async () => {
  pair = await createTwoTenants('sysuser');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('per-tenant system user', () => {
  it('each tenant has its own system user, and ids differ', async () => {
    const a = await getSystemUserId(pair.a.id);
    const b = await getSystemUserId(pair.b.id);
    expect(a).not.toBe(b);
    const rows = await prismaBase.user.findMany({ where: { id: { in: [a, b] } } });
    expect(rows.map((r) => [r.kind, r.tenantId]).sort()).toEqual([['system', pair.a.id], ['system', pair.b.id]].sort());
  });

  it('login as the system user returns 401', async () => {
    const user = await prismaBase.user.findFirstOrThrow({ where: { tenantId: pair.a.id, kind: 'system' } });
    for (const password of [SYSTEM_USER_PASSWORD, 'x', 'Passw0rd!test']) {
      const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
      expect(res.status).toBe(401);
    }
  });

  it('is hidden from the staff list', async () => {
    const { users } = await runInTenant(pair.a.id, () =>
      adminService.getAllUsers({ id: pair.a.users.admin.id, role: 'admin', tenantId: pair.a.id } as any, 1, 100)
    );
    expect(users.length).toBeGreaterThan(0);
    expect(users.some((u) => u.email.startsWith('system+'))).toBe(false);
  });

  it('seeding again (backfill) recreates a missing one and never adds a second', async () => {
    await prismaBase.user.deleteMany({ where: { tenantId: pair.b.id, kind: 'system' } });
    clearSystemUserIdCache();
    const first = await seedTenantDefaults(pair.b.id);
    expect(first.systemUser).toBe(1);
    const second = await seedTenantDefaults(pair.b.id);
    expect(second.systemUser).toBe(0);
    expect(await prismaBase.user.count({ where: { tenantId: pair.b.id, kind: 'system' } })).toBe(1);
  });

  it('getSystemUserId makes one for a tenant that has none', async () => {
    await prismaBase.user.deleteMany({ where: { tenantId: pair.b.id, kind: 'system' } });
    clearSystemUserIdCache();
    const id = await getSystemUserId(pair.b.id);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id } })).tenantId).toBe(pair.b.id);
  });
});

describe('reserved system email', () => {
  const reserved = (tenantId: string) => `system+${tenantId}@${SYSTEM_EMAIL_DOMAIN}`;
  const normal = (tenantId: string, email: string) => ({
    email, password: 'x', firstName: 'N', lastName: 'U', role: 'admin' as const, tenantId,
  });

  it('isReservedSystemEmail matches the domain, case-insensitively, and ignores other input', () => {
    expect(isReservedSystemEmail(`  System+X@${SYSTEM_EMAIL_DOMAIN.toUpperCase()} `)).toBe(true);
    expect(isReservedSystemEmail('a@example.com')).toBe(false);
    expect(isReservedSystemEmail(undefined)).toBe(false);
  });

  it('refuses to create a normal user with a reserved email', async () => {
    await expect(runInTenant(pair.a.id, () =>
      prisma.user.create({ data: normal(pair.a.id, reserved(pair.a.id).toUpperCase()) })
    )).rejects.toMatchObject({ statusCode: 400 });
    await expect(runInTenant(pair.a.id, () =>
      prisma.user.createMany({ data: [normal(pair.a.id, reserved(pair.a.id))] })
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses to update a normal user email to a reserved email', async () => {
    const userId = pair.a.users.salesRep.id;
    const before = await prismaBase.user.findUniqueOrThrow({ where: { id: userId } });
    await expect(runInTenant(pair.a.id, () =>
      prisma.user.update({ where: { id: userId }, data: { email: reserved(pair.a.id) } })
    )).rejects.toMatchObject({ statusCode: 400 });
    await expect(runInTenant(pair.a.id, () =>
      prisma.user.updateMany({ where: { id: userId }, data: { email: { set: reserved(pair.a.id) } } })
    )).rejects.toMatchObject({ statusCode: 400 });
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(before.email);
  });

  it('ensureSystemUser still creates the system user after it was deleted', async () => {
    await prismaBase.user.deleteMany({ where: { tenantId: pair.a.id, kind: 'system' } });
    clearSystemUserIdCache();
    const result = await ensureSystemUser(pair.a.id);
    expect(result.created).toBe(true);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: result.id } })).email).toBe(reserved(pair.a.id));
  });

  it('ensureSystemUser names the holder when a normal user already has the email', async () => {
    await prismaBase.user.deleteMany({ where: { tenantId: pair.b.id, kind: 'system' } });
    clearSystemUserIdCache();
    // written through the un-extended client to simulate a row that predates the guard
    const squatter = await prismaBase.user.create({ data: normal(pair.b.id, reserved(pair.b.id)) });
    try {
      await expect(ensureSystemUser(pair.b.id)).rejects.toThrow(
        `system user email for tenant ${pair.b.id} is held by user id ${squatter.id} (kind ${squatter.kind})`
      );
    } finally {
      await prismaBase.user.delete({ where: { id: squatter.id } });
      clearSystemUserIdCache();
    }
  });
});

describe('seeded roles', () => {
  it('a new tenant has the 7 roles, one of them the system role with all 14 tools', async () => {
    const roles = await prismaBase.role.findMany({ where: { tenantId: pair.a.id } });
    expect(roles).toHaveLength(7);
    const legacy = roles.find((r) => r.name === 'Legacy MCP (14 tools)')!;
    expect(legacy.isSystem).toBe(true);
    expect(legacy.tools).toHaveLength(14);
  });

  it('the same role name is allowed in two tenants and unique inside one', async () => {
    const names = async (tenantId: string) => (await prismaBase.role.findMany({ where: { tenantId } })).map((r) => r.name).sort();
    expect(await names(pair.a.id)).toEqual(await names(pair.b.id));
    await expect(prismaBase.role.create({ data: { tenantId: pair.a.id, name: 'Owner' } })).rejects.toThrow();
  });
});
