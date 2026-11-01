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
/** POST /api/roles/:id/assign with a body. */
const assign = (token: string, roleId: number, body: object) => api.post(token, `/api/roles/${roleId}/assign`, body);
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
  it('rejects a write switch without its read switch and names the read switch', async () => {
    const role = await newRole(ownerA);
    const res = await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['update_order_status'] });
    expect(res.status).toBe(400);
    expect(message(res)).toBe('Needs View orders');
    expect((await prismaBase.role.findUniqueOrThrow({ where: { id: role.id } })).permissions).toEqual({});
  });

  it('turning switches on writes their cells into the grid, in one save, with an audit row', async () => {
    const role = await newRole(ownerA);
    const ok = await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['view_orders', 'update_order_status', 'view_orders'] });
    expect(ok.status).toBe(200);
    expect(ok.body.role).toMatchObject({ tools: ['view_orders', 'update_order_status'], toolCount: 2, toolTotal: 16, custom: false });
    const row = await prismaBase.role.findUniqueOrThrow({ where: { id: role.id } });
    expect(row.tools).toBeNull(); // not stored: the switches are read from the grid
    expect(row.permissions).toMatchObject({ orders: expect.arrayContaining(['view', 'update', 'update_status']) });
    const grid = (await api.get(ownerA, `/api/roles/${role.id}/permissions`)).body.permissions;
    expect(grid.orders.sort()).toEqual(['update', 'update_status', 'view']);
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId: pair.a.id, action: 'role_tools_update', resourceId: String(role.id) }, orderBy: { id: 'desc' } });
    expect(audit.metadata).toMatchObject({ before: [], after: ['view_orders', 'update_order_status'] });
  });

  it('turning a switch off removes its cells but keeps a cell another switch that stays on needs', async () => {
    const role = await newRole(ownerA);
    await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['view_stock', 'edit_products', 'adjust_stock'] });
    const off = await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['view_stock', 'adjust_stock'] });
    expect(off.body.role.tools).toEqual(['view_stock', 'adjust_stock']);
    const grid = (await api.get(ownerA, `/api/roles/${role.id}/permissions`)).body.permissions;
    expect(grid.products.sort()).toEqual(['update_stock', 'view']);
  });

  it('refuses an unknown switch, an old registry tool name, and a body that is not a list', async () => {
    const role = await newRole(ownerA);
    const unknown = await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['view_orders', 'make_coffee'] });
    expect(unknown.status).toBe(400);
    expect(message(unknown)).toContain('make_coffee');
    expect((await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['orders_search'] })).status).toBe(400);
    expect((await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: 'view_orders' })).status).toBe(400);
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

  it('seeded roles read their switches from the grid: Owner has 16 of 16, Stock keeper has the stock switches', async () => {
    const cards = (await api.get(ownerA, '/api/roles/overview')).body.roles as any[];
    const owner = cards.find((c) => c.name === 'Owner');
    expect(owner).toMatchObject({ toolCount: 16, toolTotal: 16, custom: false });
    const stock = cards.find((c) => c.name === 'Stock keeper');
    expect(stock.tools).toEqual(expect.arrayContaining(['view_stock', 'edit_products', 'adjust_stock']));
    expect(stock.custom).toBe(false);
  });
});

describe('the permission matrix', () => {
  it('GET shows the preset grid of a seeded role and the cells that may be set', async () => {
    const callRep = await roleOf(pair.a.id, 'Call rep');
    const res = await api.get(ownerA, `/api/roles/${callRep.id}/permissions`);
    expect(res.status).toBe(200);
    expect(res.body.permissions.orders).toEqual(expect.arrayContaining(['create', 'view', 'update']));
    expect(res.body.permissions.targets).toEqual(['view']);
    expect(res.body.catalog.orders).toContain('bulk_import');
  });

  it('PUT saves the grid, GET returns it, and the audit row has the grid before and after', async () => {
    const role = await newRole(ownerA);
    const grid = { orders: ['view', 'assign'], targets: ['view'] };
    const res = await setGrid(ownerA, role.id, grid);
    expect(res.status).toBe(200);
    expect((await api.get(ownerA, `/api/roles/${role.id}/permissions`)).body).toMatchObject({ permissions: grid, saved: true });
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId: pair.a.id, action: 'role_permissions_update', resourceId: String(role.id) } });
    expect(audit.metadata).toMatchObject({ before: {}, after: grid });
  });

  it('saving the grid recomputes the switches; a grid that no preset gives reads Custom', async () => {
    const role = await newRole(ownerA);
    const res = await setGrid(ownerA, role.id, { orders: ['view', 'update', 'update_status'], customers: ['view'], gl: ['view'] });
    expect(res.status).toBe(200);
    const card = (await api.get(ownerA, `/api/roles/${role.id}`)).body.role;
    expect(card.tools.sort()).toEqual(['update_order_status', 'view_customers', 'view_orders']);
    expect(card.custom).toBe(true); // gl:view belongs to no switch
    const clean = await setGrid(ownerA, role.id, { orders: ['view'] });
    expect(clean.status).toBe(200);
    expect((await api.get(ownerA, `/api/roles/${role.id}`)).body.role).toMatchObject({ tools: ['view_orders'], custom: false });
    const callRep = await roleOf(pair.a.id, 'Call rep');
    expect((await api.get(ownerA, `/api/roles/${callRep.id}`)).body.role.custom).toBe(false);
    const preset = (await api.get(ownerA, `/api/roles/${callRep.id}/permissions`)).body.permissions;
    expect((await setGrid(ownerA, callRep.id, { ...preset, gl: ['view'] })).status).toBe(200);
    expect((await api.get(ownerA, `/api/roles/${callRep.id}`)).body.role.custom).toBe(true);
    await setGrid(ownerA, callRep.id, preset);
    expect((await api.get(ownerA, `/api/roles/${callRep.id}`)).body.role.custom).toBe(false);
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

describe('MCP keys call only tools whose cell the role grants (F-1153)', () => {
  const toolsList = async (key: string) => {
    clearAuthCache();
    const res = await request(app).post('/mcp').set('Authorization', `Bearer ${key}`).set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    return (res.body.result.tools as Array<{ name: string }>).map((t) => t.name);
  };

  it('the key sees the tools of the role grid, and a switch change reaches it at once', async () => {
    const role = await newRole(ownerA);
    await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['view_orders'] });
    const created = await api.post(ownerA, '/api/mcp-keys', { label: uniq('grid key'), roleId: role.id });
    expect(created.status).toBe(201);
    try {
      expect(created.body.toolCount).toBe(3);
      const before = await toolsList(created.body.key);
      expect(before).toEqual(expect.arrayContaining(['orders_search']));
      expect(before).not.toContain('customers_lookup');
      expect(before).not.toContain('orders_update_status');
      expect((await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['view_orders', 'update_order_status', 'view_customers'] })).status).toBe(200);
      const after = await toolsList(created.body.key);
      expect(after).toEqual(expect.arrayContaining(['orders_search', 'customers_lookup', 'orders_update_status']));
      expect(after).not.toContain('financial_summary');
    } finally {
      await api.del(ownerA, `/api/mcp-keys/${created.body.id}`);
    }
  });
});

describe('the Settings matrix is a thin layer on the mapped role', () => {
  it('reads and writes the grid of the seeded role, with no second store', async () => {
    const callRep = await roleOf(pair.a.id, 'Call rep');
    const original = (await api.get(ownerA, '/api/admin/permissions')).body;
    expect(original.sales_rep.orders).toEqual(expect.arrayContaining(['create', 'view', 'update']));
    const saved = await api.put(ownerA, '/api/admin/permissions', { sales_rep: { orders: ['view'] } });
    expect(saved.status).toBe(200);
    expect(saved.body.sales_rep.orders).toEqual(['view']);
    expect(saved.body.sales_rep.customers).toEqual(original.sales_rep.customers); // not named: kept
    expect((await api.get(ownerA, `/api/roles/${callRep.id}/permissions`)).body.permissions.orders).toEqual(['view']);
    expect((await prismaBase.systemConfig.findFirst({ where: { tenantId: pair.a.id } }))?.rolePermissions ?? null).toBeNull();
    // a rep with the Call rep role feels it at once
    expect((await meOf(pair.a.users.salesRep.token)).orders).toEqual(['view']);
    await api.put(ownerA, '/api/admin/permissions', { sales_rep: { orders: original.sales_rep.orders } });
  });
});

describe('login returns the union, like /api/auth/me', () => {
  it('a person with two roles gets both sets at sign-in', async () => {
    const bcrypt = await import('bcrypt');
    const email = `${uniq('login')}@codadmin.test`;
    const user = await prismaBase.user.create({
      data: { email, password: await bcrypt.hash('Passw0rd!test', 4), firstName: 'Log', lastName: 'In', role: 'manager', tenantId: pair.a.id },
    });
    const one = await newRole(ownerA);
    const two = await newRole(ownerA);
    await setGrid(ownerA, one.id, { orders: ['view'] });
    await setGrid(ownerA, two.id, { gl: ['view'] });
    await assignExisting(ownerA, one.id, user.id);
    await assignExisting(ownerA, two.id, user.id);
    const res = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!test' });
    expect(res.status).toBe(200);
    expect(res.body.permissions).toMatchObject({ orders: ['view'], gl: ['view'] });
    expect(res.body.permissions).toEqual(await meOf(res.body.tokens.accessToken));
  });
});

describe('giving a role stays within your own access', () => {
  it('an admin cannot give a role with cells they lack (to anyone), the Owner can', async () => {
    const adminToken = pair.a.users.admin.token;
    const above = await newRole(ownerA);
    await setGrid(ownerA, above.id, { orders: ['view'], financial: ['update'] }); // the Admin role has no financial:update
    const target = await mkUser(pair.a.id, 'above-target', 'sales_rep');
    const denied = await assignExisting(adminToken, above.id, target.id);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('GRID_ABOVE_ACTOR');
    expect((await assign(adminToken, above.id, { type: 'person', name: 'New Above', email: `${uniq('above')}@codadmin.test` })).status).toBe(403);
    expect(await prismaBase.roleAssignment.count({ where: { roleId: above.id } })).toBe(0);
    expect((await assignExisting(ownerA, above.id, target.id)).status).toBe(201);
  });

  it('an admin may give a role within their access to a rep, but not to themselves', async () => {
    const adminToken = pair.a.users.admin.token;
    const callRep = await roleOf(pair.a.id, 'Call rep');
    const rep = await mkUser(pair.a.id, 'within-target', 'sales_rep');
    expect((await assignExisting(adminToken, callRep.id, rep.id)).status).toBe(201);
    const self = await assignExisting(adminToken, callRep.id, pair.a.users.admin.id);
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_ASSIGN');
    // the Owner may give a role to themselves
    const ownerUser = await prismaBase.user.findFirstOrThrow({ where: { tenantId: pair.a.id, email: { startsWith: 'owner-' } } });
    expect((await assignExisting(ownerA, callRep.id, ownerUser.id)).status).toBe(201);
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

describe('switch writes share the grid guard and clear access at once', () => {
  it('turning off Manage team on the last role that can manage users is 409 and changes nothing', async () => {
    const tenant = await createTenant('m6switchguard');
    extraTenants.push(tenant.id);
    await tenantDefaults.seedTenantDefaults(tenant.id); // no super_admin yet: the Owner role has no holder
    const owner = await mkUser(tenant.id, 'owner', 'super_admin');
    const role = await newRole(owner.token);
    expect((await api.put(owner.token, `/api/roles/${role.id}/tools`, { tools: ['manage_team'] })).status).toBe(200);
    const holder = await mkUser(tenant.id, 'only-manager', 'admin');
    expect((await assignExisting(owner.token, role.id, holder.id)).status).toBe(201);

    const blocked = await api.put(owner.token, `/api/roles/${role.id}/tools`, { tools: [] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('LAST_USER_MANAGER');
    const row = await prismaBase.role.findUniqueOrThrow({ where: { id: role.id } });
    expect((row.permissions as any).users.sort()).toEqual(['create', 'update']);
  });

  it('a holder loses access the moment the switch goes off (no wait for the cache)', async () => {
    const role = await newRole(ownerA);
    expect((await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: ['manage_team'] })).status).toBe(200);
    const person = await mkUser(pair.a.id, 'switch-off', 'manager');
    expect((await assignExisting(ownerA, role.id, person.id)).status).toBe(201);
    const edit = () => api.put(person.token, `/api/roles/${role.id}`, { area: uniq('Area') });
    expect((await edit()).status).toBe(200); // users:update through the switch
    expect((await api.put(ownerA, `/api/roles/${role.id}/tools`, { tools: [] })).status).toBe(200);
    expect((await edit()).status).toBe(403);
  });
});

describe('one grid fallback for the checks and the middleware', () => {
  it('a role with no grid follows the tenant matrix, so an admin cannot hand out more than they hold', async () => {
    const tenant = await createTenant('m6matrix');
    extraTenants.push(tenant.id);
    await prismaBase.systemConfig.create({ data: { tenantId: tenant.id, rolePermissions: { manager: { financial: ['view', 'update'] } } } });
    await tenantDefaults.seedTenantDefaults(tenant.id);
    const owner = await mkUser(tenant.id, 'owner', 'super_admin');
    const admin = await mkUser(tenant.id, 'admin', 'admin');
    const rep = await mkUser(tenant.id, 'rep', 'sales_rep');
    // a manager-preset role that has no saved grid: its holders get the tenant matrix for manager (financial:update), not the code default
    const role = await newRole(owner.token, { presetRole: 'manager' });
    await prismaBase.$executeRaw`UPDATE roles SET permissions = NULL WHERE id = ${role.id}`;
    clearPermissionsCache();
    const holder = await mkUser(tenant.id, 'holder', 'manager');
    expect((await assignExisting(owner.token, role.id, holder.id)).status).toBe(201);
    expect((await meOf(holder.token)).financial).toEqual(expect.arrayContaining(['view', 'update']));
    // the Admin role has no financial:update
    const denied = await assignExisting(admin.token, role.id, rep.id);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('GRID_ABOVE_ACTOR');
    expect((await api.get(owner.token, `/api/roles/${role.id}/permissions`)).body.permissions.financial).toEqual(['view', 'update']);
  });
});

describe('one access invalidation (A1)', () => {
  it('assigning a role to a signed-in user shows the new cell at once; unassigning removes it at once', async () => {
    const role = await newRole(ownerA);
    await setGrid(ownerA, role.id, { users: ['view'] });
    const person = await mkUser(pair.a.id, 'invalidate', 'manager');
    // warm the person's cache: no users:view yet
    expect((await api.get(person.token, '/api/roles/overview')).status).toBe(403);
    const given = await assignExisting(ownerA, role.id, person.id);
    expect(given.status).toBe(201);
    expect((await api.get(person.token, '/api/roles/overview')).status).toBe(200);
    expect((await api.del(ownerA, `/api/roles/${role.id}/assignments/${given.body.assignment.id}`)).status).toBe(200);
    expect((await api.get(person.token, '/api/roles/overview')).status).toBe(403);
  });

  it('a change in one tenant leaves the cached access of another tenant alone', async () => {
    const before = await meOf(pair.b.users.salesRep.token); // warms tenant B
    const role = await newRole(ownerA);
    await setGrid(ownerA, role.id, { orders: ['view'] }); // invalidates tenant A only
    const cached = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.b.id, name: 'Call rep' } });
    // change B's grid straight in the database: B still answers from its cache, so A's invalidation did not touch it
    await prismaBase.role.update({ where: { id: cached.id }, data: { permissions: { orders: ['delete'] } } });
    expect(await meOf(pair.b.users.salesRep.token)).toEqual(before);
    clearPermissionsCache();
    await prismaBase.role.update({ where: { id: cached.id }, data: { permissions: before } });
    clearPermissionsCache();
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
