/**
 * M6-T03 (COD-56, F-1150 to F-1152, F-1156): roles API. CRUD, overview, the holder guard, the three ways to assign
 * (person, AI agent with a role-limited MCP key, company), unassign with history, two tenants, and the position role
 * every new staff user gets.
 */
import { getTenantMatrix } from '../../middleware/auth';
import { runInTenant } from '../../utils/tenantContext';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTwoTenants, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { clearAuthCache, validateKey, disconnectPrisma } from '../../mcp/auth';
import { ROLE_TOOL_TOTAL, registryToolsOfRole } from '../../config/roleToolRules';
import { DEFAULT_ROLES, roleToolList } from '../../config/defaultRoles';
import { startOfUtcDay } from '../../utils/startOfUtcDay';

jest.setTimeout(90_000);

process.env.SAAS_SIGNUP_ENABLED = 'true'; // register-tenant answers 404 without it
const SUFFIX = Date.now();

let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
const extraTenants: string[] = [];

const A = () => pair.a.id;
const roleOf = (tenantId: string, name: string) => prismaBase.role.findFirstOrThrow({ where: { tenantId, name } });
const api = {
  get: (token: string, url: string) => request(app).get(url).set(bearer(token)),
  post: (token: string, url: string, body: object = {}) => request(app).post(url).set(bearer(token)).send(body),
  put: (token: string, url: string, body: object = {}) => request(app).put(url).set(bearer(token)).send(body),
  del: (token: string, url: string) => request(app).delete(url).set(bearer(token)),
};
/** POST /api/roles/:id/assign as `token` (the Owner of tenant A by default). */
const assign = (roleId: number, body: object, token = ownerA) => api.post(token, `/api/roles/${roleId}/assign`, body);
/** The account has no usable password: any login fails with 401. */
const cannotLogin = async (email: string) => {
  for (const password of ['!', 'password123']) {
    expect((await request(app).post('/api/auth/login').send({ email, password })).status).toBe(401);
  }
};
let seq = 0;
const uniq = (label: string) => `${label}-${SUFFIX}-${seq++}`;
const newRole = async (token = ownerA, extra: object = {}) => {
  const res = await api.post(token, '/api/roles', { name: uniq('Custom'), ...extra });
  expect(res.status).toBe(201);
  return res.body.role as { id: number; name: string };
};
const mailOf = (label: string) => `${uniq(label)}@codadmin.test`;

beforeAll(async () => {
  pair = await createTwoTenants('m6roles');
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

beforeEach(() => clearAuthCache());

describe('who may call', () => {
  it('needs a login; a call rep is refused; an admin may read the cards but not the plain list', async () => {
    expect((await request(app).get('/api/roles')).status).toBe(401);
    expect((await api.get(pair.a.users.salesRep.token, '/api/roles')).status).toBe(403);
    expect((await api.get(pair.a.users.salesRep.token, '/api/roles/overview')).status).toBe(403);
    expect((await api.get(pair.a.users.admin.token, '/api/roles')).status).toBe(403);
    expect((await api.get(pair.a.users.admin.token, '/api/roles/overview')).status).toBe(200);
  });

  it('only the owner makes or deletes a role; an admin cannot', async () => {
    expect((await api.post(pair.a.users.admin.token, '/api/roles', { name: uniq('Nope') })).status).toBe(403);
    const role = await newRole();
    expect((await api.del(pair.a.users.admin.token, `/api/roles/${role.id}`)).status).toBe(403);
    expect(await prismaBase.role.count({ where: { id: role.id } })).toBe(1);
  });
});

describe('GET /api/roles', () => {
  it('lists the tenant roles with the old fields plus holder and tool counts; never another tenant', async () => {
    const res = await api.get(ownerA, '/api/roles');
    expect(res.status).toBe(200);
    const roles = res.body.roles as any[];
    expect(roles.map((r) => r.name)).toEqual(expect.arrayContaining(DEFAULT_ROLES.map((r) => r.name)));
    const owner = roles.find((r) => r.name === 'Owner');
    expect(owner).toMatchObject({ id: pair.a.ids.role, isSystem: false, toolCount: ROLE_TOOL_TOTAL, toolTotal: ROLE_TOOL_TOTAL, holderCount: 1 });
    expect(owner.area).toBeDefined();
    const idsB = (await prismaBase.role.findMany({ where: { tenantId: pair.b.id } })).map((r) => r.id);
    expect(roles.some((r) => idsB.includes(r.id))).toBe(false);
  });

  it('GET /:id returns one role; another tenant role is 404', async () => {
    const ok = await api.get(ownerA, `/api/roles/${pair.a.ids.role}`);
    expect(ok.status).toBe(200);
    expect(ok.body.role.name).toBe('Owner');
    expect((await api.get(ownerA, `/api/roles/${pair.b.ids.role}`)).status).toBe(404);
    expect((await api.get(ownerA, '/api/roles/abc')).status).toBe(400);
  });
});

describe('POST /api/roles (F-1156)', () => {
  it('makes a custom role with no tools, writes an audit row, and the same name works in another tenant', async () => {
    const name = uniq('Packer');
    const res = await api.post(ownerA, '/api/roles', { name, area: 'Stock', contract: { purpose: 'Packs boxes.' }, kpis: ['pack time'], targetMetric: 'orders packed' });
    expect(res.status).toBe(201);
    expect(res.body.role).toMatchObject({ name, area: 'Stock', tools: [], toolCount: 0, holderCount: 0, isSystem: false, presetRole: null, kpis: ['pack time'] });
    const row = await prismaBase.role.findUniqueOrThrow({ where: { id: res.body.role.id } });
    expect(row.tenantId).toBe(A());
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId: A(), action: 'role_create', resourceId: String(row.id) } });
    expect(audit.resource).toBe('role');
    expect((await api.post(ownerB, '/api/roles', { name })).status).toBe(201);
  });

  it('refuses a name that is taken in the tenant (also in other case), and bad input', async () => {
    const dup = await api.post(ownerA, '/api/roles', { name: 'call rep' });
    expect(dup.status).toBe(409);
    expect(dup.body.message ?? dup.body.error).toMatch(/already exists/);
    expect((await api.post(ownerA, '/api/roles', { name: '   ' })).status).toBe(400);
    expect((await api.post(ownerA, '/api/roles', {})).status).toBe(400);
    // tools are M6-T04; a body that sets them is refused, not ignored
    expect((await api.post(ownerA, '/api/roles', { name: uniq('X'), tools: ['orders_search'] })).status).toBe(400);
  });

  it('starts from the tools of an existing role of the same tenant only', async () => {
    const callRep = await roleOf(A(), 'Call rep');
    const res = await api.post(ownerA, '/api/roles', { name: uniq('Rep copy'), copyToolsFromRoleId: callRep.id });
    expect(res.status).toBe(201);
    expect(res.body.role.tools).toEqual(roleToolList(callRep.tools));
    expect(res.body.role.toolCount).toBe(7);
    const foreign = await api.post(ownerA, '/api/roles', { name: uniq('Foreign copy'), copyToolsFromRoleId: pair.b.ids.legacyRole });
    expect(foreign.status).toBe(400);
  });
});

describe('PUT /api/roles/:id', () => {
  it('edits the card fields of a custom role and audits it', async () => {
    const role = await newRole();
    const res = await api.put(ownerA, `/api/roles/${role.id}`, { name: uniq('Renamed'), area: 'Ads', kpis: ['cpa'] });
    expect(res.status).toBe(200);
    expect(res.body.role).toMatchObject({ area: 'Ads', kpis: ['cpa'] });
    expect(await prismaBase.auditLog.count({ where: { tenantId: A(), action: 'role_update', resourceId: String(role.id) } })).toBe(1);
  });

  it('refuses a taken name, an empty body, a position-role rename and a system role', async () => {
    const role = await newRole();
    expect((await api.put(ownerA, `/api/roles/${role.id}`, { name: 'Marketing' })).status).toBe(409);
    expect((await api.put(ownerA, `/api/roles/${role.id}`, {})).status).toBe(400);
    const callRep = await roleOf(A(), 'Call rep');
    expect((await api.put(ownerA, `/api/roles/${callRep.id}`, { name: 'Phone team' })).status).toBe(400);
    expect((await api.put(ownerA, `/api/roles/${callRep.id}`, { area: 'Sales team' })).status).toBe(200);
    expect((await api.put(ownerA, `/api/roles/${pair.a.ids.legacyRole}`, { area: 'x' })).status).toBe(400);
  });

  it('tenant B cannot edit tenant A roles; an admin cannot change the Owner role', async () => {
    const role = await newRole();
    expect((await api.put(ownerB, `/api/roles/${role.id}`, { area: 'hacked' })).status).toBe(404);
    expect((await prismaBase.role.findUniqueOrThrow({ where: { id: role.id } })).area).toBeNull();
    expect((await api.put(pair.a.users.admin.token, `/api/roles/${pair.a.ids.role}`, { area: 'mine' })).status).toBe(403);
    expect((await api.put(ownerA, `/api/roles/${pair.a.ids.role}`, { area: 'Whole business' })).status).toBe(200);
  });
});

describe('DELETE /api/roles/:id', () => {
  it('deletes a custom role with no holders and audits it', async () => {
    const role = await newRole();
    expect((await api.del(ownerA, `/api/roles/${role.id}`)).status).toBe(200);
    expect(await prismaBase.role.count({ where: { id: role.id } })).toBe(0);
    expect(await prismaBase.auditLog.count({ where: { tenantId: A(), action: 'role_delete', resourceId: String(role.id) } })).toBe(1);
  });

  it('a role with holders answers 409 "Move N holders first"; ended assignments do not count', async () => {
    const role = await newRole();
    const person = await assign(role.id, { type: 'person', name: 'Ama Boateng', email: mailOf('ama') });
    const company = await assign(role.id, { type: 'company', name: 'Fast Riders' });
    const blocked = await api.del(ownerA, `/api/roles/${role.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message ?? blocked.body.error).toBe('Move 2 holders first');
    expect(await prismaBase.role.count({ where: { id: role.id } })).toBe(1);
    await api.del(ownerA, `/api/roles/${role.id}/assignments/${person.body.assignment.id}`);
    const one = await api.del(ownerA, `/api/roles/${role.id}`);
    expect(one.status).toBe(409);
    expect(one.body.message ?? one.body.error).toBe('Move 1 holder first');
    await api.del(ownerA, `/api/roles/${role.id}/assignments/${company.body.assignment.id}`);
    expect((await api.del(ownerA, `/api/roles/${role.id}`)).status).toBe(200);
  });

  it('the Owner role and system roles can never be deleted', async () => {
    const owner = await api.del(ownerA, `/api/roles/${pair.a.ids.role}`);
    expect(owner.status).toBe(400);
    expect(owner.body.message ?? owner.body.error).toBe('The Owner role cannot be deleted');
    expect((await api.del(ownerA, `/api/roles/${pair.a.ids.legacyRole}`)).status).toBe(400);
    expect(await prismaBase.role.count({ where: { id: { in: [pair.a.ids.role, pair.a.ids.legacyRole] } } })).toBe(2);
  });

  it('tenant B cannot delete a tenant A role', async () => {
    const role = await newRole();
    expect((await api.del(ownerB, `/api/roles/${role.id}`)).status).toBe(404);
    expect(await prismaBase.role.count({ where: { id: role.id } })).toBe(1);
  });
});

describe('assign a person (F-1152)', () => {
  it('makes an invited user: kind person, no usable password, inactive, cannot sign in; assignment starts today', async () => {
    const role = await roleOf(A(), 'Finance clerk');
    const email = mailOf('Kofi');
    const res = await assign(role.id, { type: 'person', name: 'Kofi Mensah', email: email.toUpperCase(), phoneNumber: '0244000000' });
    expect(res.status).toBe(201);
    expect(res.body.holder).toMatchObject({ name: 'Kofi Mensah', kind: 'person', typeLabel: 'Human', status: 'invited', email: email.toLowerCase() });
    expect(res.body).not.toHaveProperty('apiKey');
    expect(JSON.stringify(res.body)).not.toContain('password');

    const user = await prismaBase.user.findUniqueOrThrow({ where: { id: res.body.holder.id } });
    expect(user).toMatchObject({ tenantId: A(), kind: 'person', isActive: false, role: 'accountant', phoneNumber: '0244000000', firstName: 'Kofi', lastName: 'Mensah' });
    expect(user.invitedAt).not.toBeNull();
    expect(user.password).toBe('!');
    const assignment = await prismaBase.roleAssignment.findUniqueOrThrow({ where: { id: res.body.assignment.id } });
    expect(assignment).toMatchObject({ tenantId: A(), roleId: role.id, holderId: user.id, toDate: null });
    expect(assignment.fromDate.getTime()).toBe(startOfUtcDay().getTime());
    expect(await prismaBase.auditLog.count({ where: { tenantId: A(), action: 'role_assign', resourceId: String(role.id) } })).toBeGreaterThan(0);

    await cannotLogin(email);
  });

  it('rejects a duplicate email in the tenant (any case) and an email used in another tenant', async () => {
    const role = await roleOf(A(), 'Stock keeper');
    const email = mailOf('dup');
    expect((await assign(role.id, { type: 'person', name: 'First One', email })).status).toBe(201);
    const again = await assign(role.id, { type: 'person', name: 'Second One', email: email.toUpperCase() });
    expect(again.status).toBe(409);
    expect(again.body.message ?? again.body.error).toBe('A user with this email already exists');
    const cross = await api.post(ownerB, `/api/roles/${pair.b.ids.legacyRole}/assign`, { type: 'person', name: 'Cross', email: pair.a.users.admin.email });
    expect(cross.status).toBe(409);
    expect(await prismaBase.user.count({ where: { email: { in: [email, email.toUpperCase()], mode: 'insensitive' } } })).toBe(1);
  });

  it('an admin cannot invite someone into a role at or above their own, or into Owner', async () => {
    const adminRole = await roleOf(A(), 'Admin');
    const callRep = await roleOf(A(), 'Call rep');
    const token = pair.a.users.admin.token;
    expect((await api.post(token, `/api/roles/${adminRole.id}/assign`, { type: 'person', name: 'Peer Admin', email: mailOf('peer') })).status).toBe(403);
    expect((await api.post(token, `/api/roles/${pair.a.ids.role}/assign`, { type: 'person', name: 'Boss', email: mailOf('boss') })).status).toBe(403);
    expect((await api.post(token, `/api/roles/${callRep.id}/assign`, { type: 'person', name: 'New Rep', email: mailOf('newrep') })).status).toBe(201);
  });

  it('refuses bad input and a role of another tenant', async () => {
    const role = await roleOf(A(), 'Call rep');
    expect((await assign(role.id, { type: 'person', name: 'No Email' })).status).toBe(400);
    expect((await assign(role.id, { type: 'person', name: 'Bad', email: 'not-an-email' })).status).toBe(400);
    expect((await assign(role.id, { type: 'robot', name: 'x' })).status).toBe(400);
    expect((await assign(pair.b.ids.role, { type: 'company', name: 'Leak Co' })).status).toBe(404);
  });
});

describe('assign an AI agent (F-1152)', () => {
  it('makes an ai_agent user, an assignment and a key whose tools are exactly the role tools; the key is shown once', async () => {
    const role = await roleOf(A(), 'Call rep');
    const matrix = await runInTenant(A(), getTenantMatrix);
    const res = await assign(role.id, { type: 'ai_agent', name: 'Claude Desktop' });
    expect(res.status).toBe(201);
    const { key } = res.body.apiKey;
    expect(key).toMatch(/^mcp_[0-9a-f]{64}$/);
    expect(res.body.apiKey).toMatchObject({ toolCount: registryToolsOfRole(role, matrix).length, roleId: role.id });
    expect(res.body.holder).toMatchObject({ kind: 'ai_agent', typeLabel: 'AI agent', name: 'Claude Desktop' });

    clearAuthCache();
    const principal = await validateKey(key);
    expect(principal.roleId).toBe(role.id);
    expect(principal.userId).toBe(res.body.holder.id);
    expect([...principal.access.roleTools].sort()).toEqual([...registryToolsOfRole(role, matrix)].sort());

    const assignment = await prismaBase.roleAssignment.findFirstOrThrow({ where: { holderId: res.body.holder.id } });
    expect(assignment).toMatchObject({ roleId: role.id, toDate: null, tenantId: A() });

    // the raw key and its hash are in no later read or audit row
    const text = JSON.stringify([
      (await api.get(ownerA, '/api/roles/overview')).body,
      (await api.get(ownerA, `/api/roles/${role.id}/assignments`)).body,
      await prismaBase.auditLog.findMany({ where: { tenantId: A(), resource: 'role' } }),
    ]);
    expect(text).not.toContain(key);
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId: A(), action: 'role_assign', resourceId: String(role.id), userId: { not: null } }, orderBy: { id: 'desc' } });
    expect(audit.metadata).toMatchObject({ type: 'ai_agent', keyPrefix: key.substring(0, 12) });
  });

  it('cannot hold the Owner role; only the Owner connects an agent; nothing is created', async () => {
    const before = { users: await prismaBase.user.count({ where: { tenantId: A() } }), keys: await prismaBase.mcpApiKey.count({ where: { tenantId: A() } }) };
    const res = await assign(pair.a.ids.role, { type: 'ai_agent', name: 'Sneaky' });
    expect(res.status).toBe(400);
    expect(res.body.message ?? res.body.error).toBe('An AI agent cannot hold the Owner role');
    // an admin is refused before the role is looked at, on any role
    const callRep = await roleOf(A(), 'Call rep');
    for (const roleId of [pair.a.ids.role, callRep.id]) {
      expect((await assign(roleId, { type: 'ai_agent', name: 'Admin bot' }, pair.a.users.admin.token)).status).toBe(403);
    }
    expect((await assign(pair.a.ids.role, { type: 'existing', holderId: pair.a.ids.mcpUser })).status).toBe(400);
    expect({ users: await prismaBase.user.count({ where: { tenantId: A() } }), keys: await prismaBase.mcpApiKey.count({ where: { tenantId: A() } }) }).toEqual(before);
  });

  it('can reuse an ai_agent user of the tenant, but not another tenant user or a person; twice on one role is 409', async () => {
    const role = await roleOf(A(), 'Delivery');
    const ok = await assign(role.id, { type: 'ai_agent', name: 'Second key', userId: pair.a.ids.mcpUser });
    expect(ok.status).toBe(201);
    expect(ok.body.holder.id).toBe(pair.a.ids.mcpUser);
    expect((await assign(role.id, { type: 'ai_agent', name: 'Again', userId: pair.a.ids.mcpUser })).status).toBe(409);
    expect((await assign(role.id, { type: 'ai_agent', name: 'Foreign', userId: pair.b.ids.mcpUser })).status).toBe(400);
    expect((await assign(role.id, { type: 'ai_agent', name: 'Person', userId: pair.a.users.admin.id })).status).toBe(400);
    // the failed attempts left no extra key or assignment behind
    expect(await prismaBase.mcpApiKey.count({ where: { tenantId: A(), userId: pair.a.ids.mcpUser, roleId: role.id } })).toBe(1);
    expect(await prismaBase.roleAssignment.count({ where: { holderId: pair.a.ids.mcpUser, roleId: role.id } })).toBe(1);
  });
});

describe('assign a company and an existing user (F-1152)', () => {
  it('a company is kind company with no login; an email is optional; a clash is 409', async () => {
    const role = await roleOf(A(), 'Delivery');
    const email = mailOf('logi');
    const res = await assign(role.id, { type: 'company', name: 'Logiswift', email });
    expect(res.status).toBe(201);
    expect(res.body.holder).toMatchObject({ kind: 'company', typeLabel: 'Company', name: 'Logiswift', status: 'active' });
    const user = await prismaBase.user.findUniqueOrThrow({ where: { id: res.body.holder.id } });
    expect(user).toMatchObject({ kind: 'company', tenantId: A(), password: '!', role: 'delivery_agent' });
    await cannotLogin(email);

    const bare = await assign(role.id, { type: 'company', name: 'Kasapa Express' });
    expect(bare.status).toBe(201);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: bare.body.holder.id } })).email).toMatch(/^company\+[0-9a-f]+@company\.codadmin\.internal$/);
    expect((await assign(role.id, { type: 'company', name: 'Logiswift 2', email })).status).toBe(409);
  });

  it('gives an existing user the role without a new account; twice is 409; other tenants, the system user and agents are refused', async () => {
    const role = await roleOf(A(), 'Marketing');
    const usersBefore = await prismaBase.user.count({ where: { tenantId: A() } });
    const res = await assign(role.id, { type: 'existing', holderId: pair.a.users.salesRep.id });
    expect(res.status).toBe(201);
    expect(await prismaBase.user.count({ where: { tenantId: A() } })).toBe(usersBefore);
    expect((await assign(role.id, { type: 'existing', holderId: pair.a.users.salesRep.id })).status).toBe(409);
    expect((await assign(role.id, { type: 'existing', holderId: pair.b.users.salesRep.id })).status).toBe(404);
    const system = await prismaBase.user.findFirstOrThrow({ where: { tenantId: A(), kind: 'system' } });
    expect((await assign(role.id, { type: 'existing', holderId: system.id })).status).toBe(400);
    expect((await assign(role.id, { type: 'existing', holderId: pair.a.ids.mcpUser })).status).toBe(400);
  });
});

describe('overview (F-1151)', () => {
  it('shows holders with type tags, counts, the tool count and this month target; vacant roles have none', async () => {
    const role = await newRole(ownerA, { area: 'Test' });
    const today = startOfUtcDay();
    await prismaBase.target.create({
      data: {
        tenantId: A(), scope: 'role', metric: 'orders', unit: 'count', roleId: role.id, value: '723',
        periodStart: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
        periodEnd: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)),
      },
    });
    await assign(role.id, { type: 'person', name: 'Esi Owusu', email: mailOf('esi') });
    await assign(role.id, { type: 'company', name: 'Kasapa' });
    await assign(role.id, { type: 'existing', holderId: pair.a.users.deliveryAgent.id });

    const res = await api.get(ownerA, '/api/roles/overview');
    expect(res.status).toBe(200);
    const cards = res.body.roles as any[];
    const card = cards.find((c) => c.id === role.id);
    expect(card.holderCount).toBe(3);
    expect(card.holders.map((h: any) => h.typeLabel).sort()).toEqual(['Company', 'Human', 'Human']);
    expect(card.holders.find((h: any) => h.name === 'Esi Owusu').status).toBe('invited');
    expect(card).toMatchObject({ toolCount: 0, toolTotal: ROLE_TOOL_TOTAL });
    expect(card.target).toMatchObject({ metric: 'orders', value: '723' });
    for (const h of card.holders) expect(h).not.toHaveProperty('password');

    const stock = cards.find((c) => c.name === 'Marketing');
    expect(stock.target).toBeNull();
    expect(cards.some((c) => c.id === pair.a.ids.legacyRole)).toBe(false);
    const owner = cards.find((c) => c.id === pair.a.ids.role);
    expect(owner.holderCount).toBe(1);
    expect(owner.toolCount).toBe(ROLE_TOOL_TOTAL);
  });

  it('never shows tenant B holders to tenant A, and the reverse', async () => {
    const a = JSON.stringify((await api.get(ownerA, '/api/roles/overview')).body);
    const b = JSON.stringify((await api.get(ownerB, '/api/roles/overview')).body);
    expect(a).not.toContain(pair.b.marker);
    expect(b).not.toContain(pair.a.marker);
    expect(a).toContain(pair.a.marker);
    expect(b).toContain(pair.b.marker);
  });
});

describe('unassign keeps history', () => {
  it('ends the assignment today: gone from the card, kept in the history list, row still in the database', async () => {
    const role = await newRole();
    const res = await assign(role.id, { type: 'person', name: 'Yaw Asare', email: mailOf('yaw') });
    const assignmentId = res.body.assignment.id;
    const done = await api.del(ownerA, `/api/roles/${role.id}/assignments/${assignmentId}`);
    expect(done.status).toBe(200);
    expect(new Date(done.body.assignment.toDate).getTime()).toBe(startOfUtcDay().getTime());

    const row = await prismaBase.roleAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(row.toDate).not.toBeNull();
    const card = (await api.get(ownerA, '/api/roles/overview')).body.roles.find((c: any) => c.id === role.id);
    expect(card.holderCount).toBe(0);
    expect(card.holders).toEqual([]);
    const history = (await api.get(ownerA, `/api/roles/${role.id}/assignments`)).body.assignments;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ assignmentId, name: 'Yaw Asare', current: false });
    expect(await prismaBase.auditLog.count({ where: { tenantId: A(), action: 'role_unassign', resourceId: String(role.id) } })).toBe(1);

    expect((await api.del(ownerA, `/api/roles/${role.id}/assignments/${assignmentId}`)).status).toBe(409);
    // the same person can hold the role again, as a new row
    const back = await assign(role.id, { type: 'existing', holderId: res.body.holder.id });
    expect(back.status).toBe(201);
    expect((await api.get(ownerA, `/api/roles/${role.id}/assignments`)).body.assignments.map((h: any) => h.current)).toEqual([true, false]);
  });

  it('tenant B cannot end a tenant A assignment; an admin cannot end an Owner assignment', async () => {
    const owner = await prismaBase.roleAssignment.findFirstOrThrow({ where: { roleId: pair.a.ids.role, toDate: null } });
    expect((await api.del(ownerB, `/api/roles/${pair.a.ids.role}/assignments/${owner.id}`)).status).toBe(404);
    expect((await api.del(ownerB, `/api/roles/${pair.b.ids.role}/assignments/${owner.id}`)).status).toBe(404);
    expect((await api.del(pair.a.users.admin.token, `/api/roles/${pair.a.ids.role}/assignments/${owner.id}`)).status).toBe(403);
    expect((await prismaBase.roleAssignment.findUniqueOrThrow({ where: { id: owner.id } })).toDate).toBeNull();
  });

  it('ending an AI agent revokes its keys for the role, and a role with a key row cannot be deleted', async () => {
    const role = await newRole(ownerA, { copyToolsFromRoleId: (await roleOf(A(), 'Stock keeper')).id });
    const res = await assign(role.id, { type: 'ai_agent', name: 'Stock bot' });
    expect(res.status).toBe(201);
    clearAuthCache();
    await expect(validateKey(res.body.apiKey.key)).resolves.toMatchObject({ roleId: role.id });
    const done = await api.del(ownerA, `/api/roles/${role.id}/assignments/${res.body.assignment.id}`);
    expect(done.body.revokedKeys).toBe(1);
    await expect(validateKey(res.body.apiKey.key)).rejects.toThrow(/revoked/);
    const blocked = await api.del(ownerA, `/api/roles/${role.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message ?? blocked.body.error).toBe('This role is used by 1 API key');
  });
});

describe('every new staff user gets their position role (T02 carry-forward)', () => {
  const heldNames = async (userId: number) => {
    expect(userId).toEqual(expect.any(Number));
    const held = await prismaBase.roleAssignment.findMany({ where: { holderId: userId, toDate: null }, include: { role: true } });
    return held.map((h) => h.role.name);
  };

  it('POST /api/admin/users', async () => {
    const cases: Array<[string, string]> = [['sales_rep', 'Call rep'], ['accountant', 'Finance clerk'], ['inventory_manager', 'Stock keeper'], ['manager', 'Manager'], ['delivery_agent', 'Delivery']];
    for (const [role, name] of cases) {
      const res = await api.post(ownerA, '/api/admin/users', { email: mailOf(role), password: 'Passw0rd!test', firstName: 'New', lastName: role, role });
      expect(res.status).toBe(201);
      expect(await heldNames(res.body.id)).toEqual([name]);
    }
    // an admin creates a rep through the same path
    const viaAdmin = await api.post(pair.a.users.admin.token, '/api/admin/users', { email: mailOf('byadmin'), password: 'Passw0rd!test', firstName: 'By', lastName: 'Admin', role: 'sales_rep' });
    expect(await heldNames(viaAdmin.body.id)).toEqual(['Call rep']);
    const admin = await api.post(ownerA, '/api/admin/users', { email: mailOf('adm'), password: 'Passw0rd!test', firstName: 'New', lastName: 'Admin', role: 'admin' });
    expect(await heldNames(admin.body.id)).toEqual(['Admin']);
  });

  it('a user that fails to save leaves no assignment; an unseeded tenant still creates the user', async () => {
    const dup = await api.post(ownerA, '/api/admin/users', { email: pair.a.users.admin.email, password: 'Passw0rd!test', firstName: 'D', lastName: 'Up', role: 'sales_rep' });
    expect(dup.status).toBe(409);
    const bare = await prismaBase.tenant.create({ data: { name: `Bare ${SUFFIX}`, slug: `m6roles-bare-${SUFFIX}` } });
    extraTenants.push(bare.id);
    const bareOwner = await superAdminToken(bare.id, `bare-${SUFFIX}`);
    const res = await api.post(bareOwner, '/api/admin/users', { email: mailOf('bare'), password: 'Passw0rd!test', firstName: 'No', lastName: 'Roles', role: 'sales_rep' });
    expect(res.status).toBe(201);
    expect(await heldNames(res.body.id)).toEqual([]);
  });

  it('a delivery partner (person and company) holds Delivery', async () => {
    for (const kind of ['person', 'company']) {
      const res = await api.post(ownerA, '/api/delivery-partners', { kind, firstName: `Partner ${kind}`, lastName: 'Co', email: mailOf(`p-${kind}`), password: 'Passw0rd!test' });
      expect(res.status).toBe(201);
      const id = res.body.id ?? res.body.partner?.id ?? res.body.userId;
      expect(await heldNames(id)).toEqual(['Delivery']);
    }
  });

  it('register-tenant makes the first user hold Owner', async () => {
    const res = await request(app).post('/api/auth/register-tenant').send({
      companyName: `M6 Roles Reg ${SUFFIX}`, adminEmail: `m6roles-reg-${SUFFIX}@codadmin.test`, adminPassword: 'Passw0rd!test', adminName: 'Reg Owner',
    });
    expect(res.status).toBe(201);
    extraTenants.push(res.body.tenant.id);
    expect(await heldNames(res.body.user.id)).toEqual(['Owner']);
  });

  it('system, AI agent and role-assign users do not get a second position role', async () => {
    const system = await prismaBase.user.findFirstOrThrow({ where: { tenantId: A(), kind: 'system' } });
    expect(await heldNames(system.id)).toEqual([]);
    const role = await roleOf(A(), 'Finance clerk');
    const key = await api.post(ownerA, '/api/mcp-keys', { label: 'Plain key', roleId: role.id });
    expect(key.status).toBe(201);
    expect(await heldNames(key.body.userId)).toEqual([]);
    await api.del(ownerA, `/api/mcp-keys/${key.body.id}`);
    const invited = await assign(role.id, { type: 'person', name: 'Just One', email: mailOf('one') });
    expect(await heldNames(invited.body.holder.id)).toEqual(['Finance clerk']);
  });
});

describe('the last Owner holder stays', () => {
  it('unassigning the last current holder of Owner is 409; with a second holder one can go', async () => {
    const [first] = await prismaBase.roleAssignment.findMany({ where: { roleId: pair.b.ids.role, toDate: null } });
    const blocked = await api.del(ownerB, `/api/roles/${pair.b.ids.role}/assignments/${first.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message ?? blocked.body.error).toBe('The Owner role needs at least one holder');
    expect((await prismaBase.roleAssignment.findUniqueOrThrow({ where: { id: first.id } })).toDate).toBeNull();

    const second = await assign(pair.b.ids.role, { type: 'existing', holderId: pair.b.users.salesRep.id }, ownerB);
    expect(second.status).toBe(201);
    expect((await api.del(ownerB, `/api/roles/${pair.b.ids.role}/assignments/${first.id}`)).status).toBe(200);
    const last = await api.del(ownerB, `/api/roles/${pair.b.ids.role}/assignments/${second.body.assignment.id}`);
    expect(last.status).toBe(409);
  });
});

describe('presetRole: the base role of the people a role gets', () => {
  it('POST sets it (Owner only, never super_admin) and a new holder gets that UserRole', async () => {
    const role = await newRole(ownerA, { presetRole: 'sales_rep' });
    expect((await api.get(ownerA, `/api/roles/overview`)).body.roles.find((r: any) => r.id === role.id).presetRole).toBe('sales_rep');
    const person = await assign(role.id, { type: 'person', name: 'Preset Person', email: mailOf('preset') });
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: person.body.holder.id } })).role).toBe('sales_rep');
    // the default stays manager
    const plain = await newRole();
    const other = await assign(plain.id, { type: 'company', name: 'Plain Co' });
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: other.body.holder.id } })).role).toBe('manager');
    expect((await api.post(ownerA, '/api/roles', { name: uniq('Boss'), presetRole: 'super_admin' })).status).toBe(400);
    expect((await api.post(pair.a.users.admin.token, '/api/roles', { name: uniq('Adm'), presetRole: 'manager' })).status).toBe(403);
  });

  it('PUT: only the Owner changes it; not on the Owner role; a custom role with a preset can still be renamed', async () => {
    const role = await newRole();
    expect((await api.put(pair.a.users.admin.token, `/api/roles/${role.id}`, { presetRole: 'accountant' })).status).toBe(403);
    expect((await api.put(pair.a.users.admin.token, `/api/roles/${role.id}`, { area: 'Ok' })).status).toBe(200);
    const done = await api.put(ownerA, `/api/roles/${role.id}`, { presetRole: 'accountant', name: uniq('Renamed preset') });
    expect(done.status).toBe(200);
    expect(done.body.role.presetRole).toBe('accountant');
    expect((await api.put(ownerA, `/api/roles/${role.id}`, { presetRole: 'super_admin' })).status).toBe(400);
    expect((await api.put(ownerA, `/api/roles/${pair.a.ids.role}`, { presetRole: 'admin' })).status).toBe(400);
  });
});

describe('rank checks on assign and unassign (security review)', () => {
  const adminToken = () => pair.a.users.admin.token;

  it('an existing user: the actor must outrank the role base and the holder; deactivated users are refused', async () => {
    const callRep = await roleOf(A(), 'Call rep');
    const adminRole = await roleOf(A(), 'Admin');
    // admin may give Call rep to a delivery agent, not to another admin, and may not hand out the Admin role
    expect((await assign(callRep.id, { type: 'existing', holderId: pair.a.users.deliveryAgent.id }, adminToken())).status).toBe(201);
    const peer = await assign(callRep.id, { type: 'existing', holderId: pair.a.users.admin.id }, adminToken());
    expect(peer.status).toBe(403);
    expect((await assign(adminRole.id, { type: 'existing', holderId: pair.a.users.salesRep.id }, adminToken())).status).toBe(403);
    expect(await prismaBase.roleAssignment.count({ where: { holderId: pair.a.users.admin.id, roleId: callRep.id } })).toBe(0);

    const gone = await prismaBase.user.create({ data: { email: mailOf('gone'), password: 'x', firstName: 'Gone', lastName: 'User', role: 'sales_rep', tenantId: A(), isActive: false } });
    const refused = await assign(callRep.id, { type: 'existing', holderId: gone.id });
    expect(refused.status).toBe(400);
    expect(await prismaBase.roleAssignment.count({ where: { holderId: gone.id } })).toBe(0);
    // an invited person (inactive, invite date set) may still be given another role
    const invited = await assign(callRep.id, { type: 'person', name: 'Still Invited', email: mailOf('inv') });
    expect((await assign((await roleOf(A(), 'Finance clerk')).id, { type: 'existing', holderId: invited.body.holder.id })).status).toBe(201);
  });

  it('unassign: an admin cannot end the assignment of someone at or above their own rank', async () => {
    const marketing = await roleOf(A(), 'Marketing');
    const given = await assign(marketing.id, { type: 'existing', holderId: pair.a.users.admin.id });
    expect(given.status).toBe(201);
    const refused = await api.del(adminToken(), `/api/roles/${marketing.id}/assignments/${given.body.assignment.id}`);
    expect(refused.status).toBe(403);
    expect((await prismaBase.roleAssignment.findUniqueOrThrow({ where: { id: given.body.assignment.id } })).toDate).toBeNull();
    expect((await api.del(ownerA, `/api/roles/${marketing.id}/assignments/${given.body.assignment.id}`)).status).toBe(200);
    // below the admin it works
    const rep = await assign(marketing.id, { type: 'existing', holderId: pair.a.users.deliveryAgent.id });
    expect((await api.del(adminToken(), `/api/roles/${marketing.id}/assignments/${rep.body.assignment.id}`)).status).toBe(200);
  });
});

describe('the Owner role at signup', () => {
  it('seedTenantDefaults(tenantId, ownerUserId) gives the Owner role once, and throws when it cannot', async () => {
    const { seedTenantDefaults } = await import('../../services/tenantDefaultsService');
    const tenant = await prismaBase.tenant.create({ data: { name: `Seed owner ${SUFFIX}`, slug: `m6roles-seed-${SUFFIX}` } });
    extraTenants.push(tenant.id);
    const owner = await prismaBase.user.create({ data: { email: mailOf('seedowner'), password: 'x', firstName: 'S', lastName: 'O', role: 'super_admin', tenantId: tenant.id } });
    await seedTenantDefaults(tenant.id, owner.id);
    await seedTenantDefaults(tenant.id, owner.id);
    const held = await prismaBase.roleAssignment.findMany({ where: { holderId: owner.id }, include: { role: true } });
    expect(held.map((h) => h.role.name)).toEqual(['Owner']);
    await expect(seedTenantDefaults(tenant.id, 999_999_999)).rejects.toThrow();
  });
});
