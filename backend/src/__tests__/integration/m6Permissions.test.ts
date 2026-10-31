/**
 * M6-T04 (COD-56, F-1153 to F-1155): allowed tools, the permission matrix, the union of held roles, the last-holder guard,
 * and the two signup/seed carry-forwards from the T03 review.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTenant, createTwoTenants, deleteTenantRows, mkUser, TwoTenants } from './helpers/twoTenants';
import { clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { clearPermissionsCache } from '../../middleware/auth';
import * as tenantDefaults from '../../services/tenantDefaultsService';
import { startOfUtcDay } from '../../utils/startOfUtcDay';

jest.setTimeout(90_000);

process.env.SAAS_SIGNUP_ENABLED = 'true'; // register-tenant answers 404 without it
const SUFFIX = Date.now();

let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
const extraTenants: string[] = [];

const api = {
  get: (token: string, url: string) => request(app).get(url).set(bearer(token)),
  post: (token: string, url: string, body: object = {}) => request(app).post(url).set(bearer(token)).send(body),
  put: (token: string, url: string, body: object = {}) => request(app).put(url).set(bearer(token)).send(body),
  del: (token: string, url: string) => request(app).delete(url).set(bearer(token)),
};
let seq = 0;
const uniq = (label: string) => `${label}-${SUFFIX}-${seq++}`;
const message = (res: request.Response) => res.body.message ?? res.body.error;
const roleOf = (tenantId: string, name: string) => prismaBase.role.findFirstOrThrow({ where: { tenantId, name } });
const newRole = async (token: string, extra: object = {}) => {
  const res = await api.post(token, '/api/roles', { name: uniq('Custom'), ...extra });
  expect(res.status).toBe(201);
  return res.body.role as { id: number; name: string };
};
const setGrid = (token: string, roleId: number, permissions: object) => api.put(token, `/api/roles/${roleId}/permissions`, { permissions });
const assignExisting = (token: string, roleId: number, holderId: number) => api.post(token, `/api/roles/${roleId}/assign`, { type: 'existing', holderId });
const meOf = async (token: string) => (await api.get(token, '/api/auth/me')).body.permissions as Record<string, string[]>;

beforeAll(async () => {
  pair = await createTwoTenants('m6perm');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug);
  ownerB = await superAdminToken(pair.b.id, pair.b.slug);
}, 90_000);

afterAll(async () => {
  delete process.env.SAAS_SIGNUP_ENABLED;
  clearAuthCache();
  await deleteTenantRows(extraTenants);
  await pair.cleanup();
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

beforeEach(() => { clearAuthCache(); clearPermissionsCache(); });

describe('PUT /api/roles/:id/tools', () => {
  it('rejects a write tool without its read tool and names the read tool', async () => {
    const role = await newRole(ownerA);
    const res = await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['orders_update_status'] });
    expect(res.status).toBe(400);
    expect(message(res)).toBe('Needs View orders');
    expect((await prismaBase.role.findUniqueOrThrow({ where: { id: role.id } })).tools).toEqual([]);
  });

  it('saves a valid set, replaces the old one, and writes an audit row with before and after', async () => {
    const role = await newRole(ownerA);
    const ok = await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['orders_search', 'orders_update_status', 'orders_search'] });
    expect(ok.status).toBe(200);
    expect(ok.body.role.tools).toEqual(['orders_search', 'orders_update_status']);
    expect(ok.body.role.toolCount).toBe(2);
    expect((await api.get(ownerA, `/api/roles/${role.id}`)).body.role.tools).toEqual(['orders_search', 'orders_update_status']);
    const next = await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['customers_lookup'] });
    expect(next.body.role.tools).toEqual(['customers_lookup']);
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId: pair.a.id, action: 'role_tools_update', resourceId: String(role.id) }, orderBy: { id: 'desc' } });
    expect(audit.metadata).toMatchObject({ before: ['orders_search', 'orders_update_status'], after: ['customers_lookup'] });
  });

  it('refuses an unknown tool and a body that is not a tool list', async () => {
    const role = await newRole(ownerA);
    const unknown = await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['orders_search', 'make_coffee'] });
    expect(unknown.status).toBe(400);
    expect(message(unknown)).toContain('make_coffee');
    expect((await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: 'orders_search' })).status).toBe(400);
  });

  it('locks the Owner switches and system roles; only the Owner may call; another tenant sees 404', async () => {
    const owner = await roleOf(pair.a.id, 'Owner');
    const locked = await api.put(ownerA, `/api/roles/${owner.id}/tools`, { tools: [] });
    expect(locked.status).toBe(400);
    expect(locked.body.code).toBe('OWNER_LOCKED');
    const legacy = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, isSystem: true } });
    expect((await api.put(ownerA, `/api/roles/${legacy.id}/tools`, { tools: [] })).status).toBe(400);
    const role = await newRole(ownerA);
    expect((await api.put(pair.a.users.admin.token, `/api/roles/${role.id}/tools`, { tools: [] })).status).toBe(403);
    expect((await api.put(ownerB, `/api/roles/${role.id}/tools`, { tools: [] })).status).toBe(404);
  });
});

describe('the permission matrix', () => {
  it('GET shows the preset grid of a seeded role and the cells that may be set', async () => {
    const callRep = await roleOf(pair.a.id, 'Call rep');
    const res = await api.get(ownerA, `/api/roles/${callRep.id}/permissions`);
    expect(res.status).toBe(200);
    expect(res.body.permissions.orders).toEqual(expect.arrayContaining(['create', 'view', 'update']));
    expect(res.body.catalog.orders).toContain('bulk_import');
  });

  it('PUT saves the grid, GET returns it, and the audit row has the grid before and after', async () => {
    const role = await newRole(ownerA);
    const grid = { orders: ['view', 'assign'], targets: ['view'] };
    const res = await setGrid(ownerA, role.id, grid);
    expect(res.status).toBe(200);
    expect((await api.get(ownerA, `/api/roles/${role.id}/permissions`)).body).toMatchObject({ permissions: grid, custom: true });
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId: pair.a.id, action: 'role_permissions_update', resourceId: String(role.id) } });
    expect(audit.metadata).toMatchObject({ before: {}, after: grid });
  });

  it('refuses an unknown resource or action, the Owner role, and a caller who is not the Owner', async () => {
    const role = await newRole(ownerA);
    expect((await setGrid(ownerA, role.id, { moon: ['view'] })).status).toBe(400);
    const badAction = await setGrid(ownerA, role.id, { orders: ['fly'] });
    expect(badAction.status).toBe(400);
    expect(message(badAction)).toContain('fly');
    const owner = await roleOf(pair.a.id, 'Owner');
    expect((await setGrid(ownerA, owner.id, { orders: ['view'] })).body.code).toBe('OWNER_LOCKED');
    expect((await setGrid(pair.a.users.admin.token, role.id, { orders: ['view'] })).status).toBe(403);
    expect((await api.get(pair.a.users.salesRep.token, `/api/roles/${role.id}/permissions`)).status).toBe(403);
  });
});

describe('effective permission is the union of the roles a person holds', () => {
  it('two roles give both sets; ending one role removes only its extras (me and a guarded route)', async () => {
    const viewOrders = await newRole(ownerA);
    const viewTeam = await newRole(ownerA);
    expect((await setGrid(ownerA, viewOrders.id, { orders: ['view'] })).status).toBe(200);
    expect((await setGrid(ownerA, viewTeam.id, { users: ['view'], gl: ['view'] })).status).toBe(200);
    const person = await mkUser(pair.a.id, 'two-roles', 'manager');

    expect((await assignExisting(ownerA, viewOrders.id, person.id)).status).toBe(201);
    const second = await assignExisting(ownerA, viewTeam.id, person.id);
    expect(second.status).toBe(201);

    const both = await meOf(person.token);
    expect(both).toMatchObject({ orders: ['view'], users: ['view'], gl: ['view'] });
    // users:view is a cell of the second role only: the route that needs it opens
    expect((await api.get(person.token, '/api/roles/overview')).status).toBe(200);

    const end = await api.del(ownerA, `/api/roles/${viewTeam.id}/assignments/${second.body.assignment.id}`);
    expect(end.status).toBe(200);
    const one = await meOf(person.token);
    expect(one.orders).toEqual(['view']);
    expect(one.users ?? []).toEqual([]);
    expect(one.gl ?? []).toEqual([]);
    expect((await api.get(person.token, '/api/roles/overview')).status).toBe(403);
  });

  it('a change to the role grid reaches its holder at once', async () => {
    const role = await newRole(ownerA);
    const person = await mkUser(pair.a.id, 'grid-change', 'manager');
    await setGrid(ownerA, role.id, { orders: ['view'] });
    await assignExisting(ownerA, role.id, person.id);
    expect((await meOf(person.token)).orders).toEqual(['view']);
    await setGrid(ownerA, role.id, { orders: ['view', 'update'] });
    expect((await meOf(person.token)).orders.sort()).toEqual(['update', 'view']);
  });

  it('a person with no position role keeps the permissions of their base role', async () => {
    const rep = await meOf(pair.a.users.salesRep.token);
    expect(rep.orders).toEqual(expect.arrayContaining(['create', 'view', 'update']));
    expect(rep.users).toEqual([]);
    // the Legacy MCP role has no grid: an agent that only holds it falls back to its base role too
    const legacy = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, isSystem: true } });
    const agent = await mkUser(pair.a.id, 'legacy-holder', 'sales_rep', { kind: 'ai_agent' });
    await prismaBase.roleAssignment.create({ data: { tenantId: pair.a.id, roleId: legacy.id, holderId: agent.id, fromDate: startOfUtcDay() } });
    expect((await meOf(agent.token)).orders).toEqual(expect.arrayContaining(['create', 'view', 'update']));
  });

  it('a seeded role without its own grid follows the base role matrix', async () => {
    const role = await roleOf(pair.a.id, 'Stock keeper');
    await prismaBase.$executeRaw`UPDATE roles SET permissions = NULL WHERE id = ${role.id}`;
    const person = await mkUser(pair.a.id, 'no-grid', 'inventory_manager');
    await prismaBase.roleAssignment.create({ data: { tenantId: pair.a.id, roleId: role.id, holderId: person.id, fromDate: startOfUtcDay() } });
    expect((await meOf(person.token)).products).toEqual(expect.arrayContaining(['create', 'view', 'update_stock']));
  });
});

describe('the last holder of users:update', () => {
  it('blocks removing users:update from the last role that gives it to an active holder', async () => {
    const tenant = await createTenant('m6guard');
    extraTenants.push(tenant.id);
    await tenantDefaults.seedTenantDefaults(tenant.id);
    const owner = await mkUser(tenant.id, 'owner', 'super_admin');
    const ownerRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'Owner' } });
    // The Owner role has no holder until a later seed run gives it to the oldest super_admin (once only).
    expect(await prismaBase.roleAssignment.count({ where: { roleId: ownerRole.id } })).toBe(0);
    await tenantDefaults.seedTenantDefaults(tenant.id);
    await tenantDefaults.seedTenantDefaults(tenant.id);
    const held = await prismaBase.roleAssignment.findMany({ where: { roleId: ownerRole.id } });
    expect(held.map((h) => h.holderId)).toEqual([owner.id]);
    // Put the test in the state where the Owner role has nobody, so a custom role is the only manager of users.
    await prismaBase.roleAssignment.updateMany({ where: { roleId: ownerRole.id }, data: { toDate: startOfUtcDay() } });

    const manage = await newRole(owner.token);
    const backup = await newRole(owner.token);
    expect((await setGrid(owner.token, manage.id, { users: ['view', 'update'] })).status).toBe(200);
    const holder = await mkUser(tenant.id, 'manager-one', 'admin');
    expect((await assignExisting(owner.token, manage.id, holder.id)).status).toBe(201);

    const blocked = await setGrid(owner.token, manage.id, { users: ['view'] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('LAST_USER_MANAGER');
    expect((await api.get(owner.token, `/api/roles/${manage.id}/permissions`)).body.permissions.users).toEqual(['view', 'update']);

    // A second role with users:update but no active holder does not count; with an inactive holder it does not either.
    await setGrid(owner.token, backup.id, { users: ['update'] });
    expect((await setGrid(owner.token, manage.id, { users: ['view'] })).status).toBe(409);
    const idle = await mkUser(tenant.id, 'idle', 'admin');
    await assignExisting(owner.token, backup.id, idle.id);
    await prismaBase.user.update({ where: { id: idle.id }, data: { isActive: false } });
    expect((await setGrid(owner.token, manage.id, { users: ['view'] })).status).toBe(409);

    // An active holder of another role that grants it: allowed.
    await prismaBase.user.update({ where: { id: idle.id }, data: { isActive: true } });
    expect((await setGrid(owner.token, manage.id, { users: ['view'] })).status).toBe(200);
  });
});

describe('authenticate refuses a user who is no longer active', () => {
  it('a valid token gets 401 at once after the user is deactivated or soft-deleted; reactivating restores it', async () => {
    const person = await mkUser(pair.a.id, 'goes-away', 'admin');
    expect((await api.get(person.token, '/api/auth/me')).status).toBe(200);
    await prismaBase.user.update({ where: { id: person.id }, data: { isActive: false } });
    const res = await api.get(person.token, '/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
    await prismaBase.user.update({ where: { id: person.id }, data: { isActive: true } });
    expect((await api.get(person.token, '/api/auth/me')).status).toBe(200);
  });
});

describe('seed and signup carry-forwards (T03 review)', () => {
  it('a failed seed at signup does not fail signup; the next seed run gives the owner the Owner role', async () => {
    const spy = jest.spyOn(tenantDefaults, 'seedTenantDefaults').mockRejectedValueOnce(new Error('seed down'));
    let res: request.Response;
    try {
      res = await request(app).post('/api/auth/register-tenant').send({
        companyName: `M6 Perm Reg ${SUFFIX}`, adminEmail: `m6perm-reg-${SUFFIX}@codadmin.test`, adminPassword: 'Passw0rd!test', adminName: 'Reg Owner',
      });
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(201);
    const tenantId = res.body.tenant.id as string;
    extraTenants.push(tenantId);
    const userId = res.body.user.id as number;
    expect(await prismaBase.roleAssignment.count({ where: { holderId: userId } })).toBe(0);

    await tenantDefaults.seedTenantDefaults(tenantId); // what the start-up seed does
    const held = await prismaBase.roleAssignment.findMany({ where: { holderId: userId, toDate: null }, include: { role: true } });
    expect(held.map((h) => h.role.name)).toEqual(['Owner']);
    // The signup retry with the same email is still refused only because the user exists, not because of a stranded half-state
    expect((await prismaBase.tenant.count({ where: { id: tenantId } }))).toBe(1);
  });

  it('signup with a working seed still gives the owner the Owner role', async () => {
    const res = await request(app).post('/api/auth/register-tenant').send({
      companyName: `M6 Perm Reg2 ${SUFFIX}`, adminEmail: `m6perm-reg2-${SUFFIX}@codadmin.test`, adminPassword: 'Passw0rd!test', adminName: 'Reg Two',
    });
    expect(res.status).toBe(201);
    extraTenants.push(res.body.tenant.id);
    const held = await prismaBase.roleAssignment.findMany({ where: { holderId: res.body.user.id, toDate: null }, include: { role: true } });
    expect(held.map((h) => h.role.name)).toEqual(['Owner']);
  });
});
