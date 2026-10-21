/**
 * MCP keys API (GET/POST/DELETE /api/mcp-keys) and the migration of old keys (scripts/migrate-legacy-mcp-keys.ts).
 * A key always has a user and a role: the API requires a role, validateKey refuses a key without one, and a role
 * that a key uses cannot be deleted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import { execFileSync } from 'child_process';
import path from 'path';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { hashApiKey, validateKey, clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { runTool } from '../../tools/registry';
import '../../tools';
import { createTwoTenants, createTenant, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { makeMcpKey } from './helpers/mcpKey';

jest.setTimeout(60_000);

const LEGACY = 'Legacy MCP (14 tools)';
let pair: TwoTenants;
let ownerA: string; // super_admin tokens
let ownerB: string;
let bareTenantId: string;

const roleId = async (tenantId: string, name: string) => (await prismaBase.role.findFirstOrThrow({ where: { tenantId, name } })).id;

/** POST /api/mcp-keys as tenant A's owner with a role of tenant A by name. */
const createKey = (label: string, roleName: string, extra: Record<string, unknown> = {}) =>
  roleId(pair.a.id, roleName).then((id) =>
    request(app).post('/api/mcp-keys').set(bearer(ownerA)).send({ label, roleId: id, ...extra }));

/** Neither the raw key nor its hash appears anywhere in `value`. */
const expectNoSecrets = (value: unknown, rawKey: string) => {
  const text = JSON.stringify(value);
  expect(text).not.toContain(rawKey);
  expect(text).not.toContain(hashApiKey(rawKey));
  expect(text).not.toContain('keyHash');
};

const runScript = (env: Record<string, string> = {}, ...args: string[]) =>
  execFileSync(path.join(__dirname, '../../../node_modules/.bin/ts-node'), ['scripts/migrate-legacy-mcp-keys.ts', ...args], {
    cwd: path.join(__dirname, '../../..'), env: { ...process.env, NODE_ENV: 'test', ...env }, encoding: 'utf8', stdio: 'pipe',
  });

beforeAll(async () => {
  pair = await createTwoTenants('mcpkeys');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug);
  ownerB = await superAdminToken(pair.b.id, pair.b.slug);
  bareTenantId = (await createTenant('mcpkeys bare')).id;
}, 60_000);

afterAll(async () => {
  clearAuthCache();
  await deleteTenantRows([bareTenantId]);
  await pair.cleanup();
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

beforeEach(() => clearAuthCache());

describe('POST /api/mcp-keys', () => {
  it('requires a role: none -> 400, other-tenant role -> 400, unknown role -> 400', async () => {
    const none = await request(app).post('/api/mcp-keys').set(bearer(ownerA)).send({ label: 'no role' });
    expect(none.status).toBe(400);
    const other = await request(app).post('/api/mcp-keys').set(bearer(ownerA)).send({ label: 'b role', roleId: pair.b.ids.legacyRole });
    expect(other.status).toBe(400);
    const missing = await request(app).post('/api/mcp-keys').set(bearer(ownerA)).send({ label: 'ghost', roleId: 999999999 });
    expect(missing.status).toBe(400);
    expect(await prismaBase.mcpApiKey.count({ where: { tenantId: pair.a.id, label: { in: ['no role', 'b role', 'ghost'] } } })).toBe(0);
  });

  it('userId must be an ai_agent user of the tenant', async () => {
    const role = await roleId(pair.a.id, 'Call rep');
    for (const userId of [pair.a.users.admin.id, pair.b.ids.mcpUser, 999999999]) {
      const res = await request(app).post('/api/mcp-keys').set(bearer(ownerA)).send({ label: 'bad user', roleId: role, userId });
      expect(res.status).toBe(400);
    }
  });

  it('creates an ai_agent user named after the key, shows the raw key once and writes an audit row without it', async () => {
    const role = await roleId(pair.a.id, 'Call rep');
    const res = await createKey('Claude Desktop', 'Call rep');
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^mcp_[0-9a-f]{64}$/);
    expect(res.body).toMatchObject({ label: 'Claude Desktop', roleId: role, roleName: 'Call rep', toolCount: 4 });

    const row = await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: res.body.id }, include: { user: true } });
    expect(row.keyHash).toBe(hashApiKey(res.body.key));
    expect(row.roleId).toBe(role);
    expect(row.user).toMatchObject({ kind: 'ai_agent', tenantId: pair.a.id, firstName: 'Claude Desktop' });

    const audit = await prismaBase.auditLog.findMany({ where: { tenantId: pair.a.id, resource: 'mcp_key', resourceId: res.body.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'mcp_key_create', channel: 'app', actorKind: 'person' });
    expect(audit[0].metadata).toMatchObject({ label: 'Claude Desktop', roleId: role, userId: row.userId });
    expectNoSecrets(audit[0], res.body.key);

    // the new key resolves and works within its role
    clearAuthCache();
    const principal = await validateKey(res.body.key);
    expect(principal).toMatchObject({ tenantId: pair.a.id, userId: row.userId, roleId: role, actorKind: 'ai_agent' });
  });

  it('uses the given ai_agent user', async () => {
    const res = await createKey('Second key', 'Owner', { userId: pair.a.ids.mcpUser });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(pair.a.ids.mcpUser);
    expect(res.body.label).toBe('Second key');
  });
});

describe('GET and DELETE /api/mcp-keys', () => {
  it('lists masked keys with role name, tool count and lastUsedAt; never the raw key or the hash', async () => {
    const created = await createKey('Listed key', 'Delivery');
    const res = await request(app).get('/api/mcp-keys').set(bearer(ownerA));
    expect(res.status).toBe(200);
    const mine = res.body.keys.find((k: any) => k.id === created.body.id);
    expect(mine).toMatchObject({ label: 'Listed key', roleName: 'Delivery', toolCount: 3, keyPrefix: created.body.key.slice(0, 12), lastUsedAt: null });
    expectNoSecrets(res.body, created.body.key);
  });

  it('revoke sets revokedAt, keeps the row, writes an audit row and stops the key', async () => {
    const created = await createKey('To revoke', 'Delivery');
    const del = await request(app).delete(`/api/mcp-keys/${created.body.id}`).set(bearer(ownerA));
    expect(del.status).toBe(200);

    const row = await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.revokedAt).not.toBeNull();
    clearAuthCache();
    await expect(validateKey(created.body.key)).rejects.toThrow(/revoked/);

    const audit = await prismaBase.auditLog.findMany({ where: { tenantId: pair.a.id, resource: 'mcp_key', resourceId: created.body.id }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['mcp_key_create', 'mcp_key_revoke']);
    expectNoSecrets(audit[1], created.body.key);

    const list = await request(app).get('/api/mcp-keys').set(bearer(ownerA));
    expect(list.body.keys.map((k: any) => k.id)).not.toContain(created.body.id);
    expect((await request(app).delete(`/api/mcp-keys/${created.body.id}`).set(bearer(ownerA))).status).toBe(404);
  });

  it('a revoked key stops working on /mcp at once, even after a call warmed the auth cache', async () => {
    clearAuthCache();
    const created = await createKey('Warm then revoke', 'Delivery');
    const call = () => request(app).post('/mcp').set('Authorization', `Bearer ${created.body.key}`).set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect((await call()).status).toBe(200);
    expect((await request(app).delete(`/api/mcp-keys/${created.body.id}`).set(bearer(ownerA))).status).toBe(200);
    expect((await call()).status).toBe(401);
  });

  it('two tenants: B neither lists nor revokes A keys', async () => {
    const created = await createKey('A only', 'Delivery');
    const listB = await request(app).get('/api/mcp-keys').set(bearer(ownerB));
    expect(listB.status).toBe(200);
    expect(JSON.stringify(listB.body)).not.toContain(created.body.id);
    expect((await request(app).delete(`/api/mcp-keys/${created.body.id}`).set(bearer(ownerB))).status).toBe(404);
    expect((await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: created.body.id } })).revokedAt).toBeNull();
  });

  it('is for the super admin only', async () => {
    expect((await request(app).get('/api/mcp-keys').set(bearer(pair.a.users.admin.token))).status).toBe(403);
    expect((await request(app).get('/api/roles').set(bearer(pair.a.users.admin.token))).status).toBe(403);
  });
});

describe('GET /api/roles', () => {
  it('lists the tenant roles with their tool counts, not another tenant roles', async () => {
    const res = await request(app).get('/api/roles').set(bearer(ownerA));
    expect(res.status).toBe(200);
    const ids = res.body.roles.map((r: any) => r.id);
    expect(ids).toContain(pair.a.ids.legacyRole);
    expect(ids).not.toContain(pair.b.ids.legacyRole);
    const legacy = res.body.roles.find((r: any) => r.name === LEGACY);
    expect(legacy.toolCount).toBe(14);
    expect(legacy).not.toHaveProperty('tools');
  });
});

describe('a key always has a role', () => {
  it('a role that a key uses cannot be deleted', async () => {
    const role = await prismaBase.role.create({ data: { tenantId: pair.a.id, name: 'In use', tools: ['orders_search'] } });
    const { keyId } = await makeMcpKey(pair.a.id, { slug: 'inuse', roleName: 'In use' });
    await expect(prismaBase.role.delete({ where: { id: role.id } })).rejects.toThrow();
    expect(await prismaBase.role.count({ where: { id: role.id } })).toBe(1);
    expect((await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: keyId } })).roleId).toBe(role.id);
  });
});

describe('migrate-legacy-mcp-keys', () => {
  let oldKey: string;
  let oldKeyId: string;
  let orderId: number;

  beforeAll(async () => {
    // Tenant B holds the old key; its seeded order is moved to a status the tool can change.
    orderId = pair.b.ids.order;
    await prismaBase.order.update({ where: { id: orderId }, data: { status: 'confirmed' } });
    ({ key: oldKey, keyId: oldKeyId } = await makeMcpKey(pair.b.id, { slug: 'oldkey', userId: null }));
  });

  const keyRow = () => prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: oldKeyId } });
  const agentCount = () => prismaBase.user.count({ where: { tenantId: pair.b.id, kind: 'ai_agent' } });

  it('an old key (no user, no role) is refused', async () => {
    await expect(validateKey(oldKey)).rejects.toThrow(/not linked to a user/);
  });

  it('a dry run prints the plan and writes nothing', async () => {
    const agentsBefore = await agentCount();
    const out = runScript();
    expect(out).toContain('dry run');
    expect(out).toContain(oldKey.slice(0, 8));
    expect(out).toContain('oldkey (legacy)');
    expect(await keyRow()).toMatchObject({ userId: null, roleId: null });
    expect(await agentCount()).toBe(agentsBefore);
  });

  it('--apply gives the key a legacy user and the Legacy role; the key then calls orders_update_status', async () => {
    runScript({}, '--apply');
    const row = await keyRow();
    expect(row.roleId).toBe(pair.b.ids.legacyRole);
    const user = await prismaBase.user.findUniqueOrThrow({ where: { id: row.userId! } });
    expect(user).toMatchObject({ kind: 'ai_agent', tenantId: pair.b.id, firstName: 'oldkey (legacy)' });

    clearAuthCache();
    const p = await validateKey(oldKey);
    const res = await runTool('orders_update_status', { orderId, status: 'preparing' }, {
      tenantId: p.tenantId, actorId: p.userId, actorKind: p.actorKind, roleId: p.roleId, channel: 'mcp', access: p.access,
    });
    expect(res.status).toBe('ok');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('preparing');
  });

  it('a second run changes nothing', async () => {
    const before = await keyRow();
    const agents = await agentCount();
    const out = runScript({}, '--apply');
    expect(out).toContain('No keys need migrating');
    expect(await keyRow()).toEqual(before);
    expect(await agentCount()).toBe(agents);
  });

  it('creates the Legacy role when a tenant has none, and keeps a role the key already has', async () => {
    const own = await prismaBase.role.create({ data: { tenantId: bareTenantId, name: 'Own role', tools: ['orders_search'] } });
    const noRole = await makeMcpKey(bareTenantId, { slug: 'norole', userId: null });
    const withRole = await makeMcpKey(bareTenantId, { slug: 'withrole', userId: null, roleId: own.id });
    runScript({}, '--apply');
    const legacy = await prismaBase.role.findFirstOrThrow({ where: { tenantId: bareTenantId, name: LEGACY } });
    expect(legacy.tools).toHaveLength(14);
    expect((await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: noRole.keyId } })).roleId).toBe(legacy.id);
    const kept = await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: withRole.keyId } });
    expect(kept.roleId).toBe(own.id);
    expect(kept.userId).not.toBeNull();
  });

  it('skips revoked keys', async () => {
    const revoked = await makeMcpKey(bareTenantId, { slug: 'revoked', userId: null, revokedAt: new Date() });
    runScript({}, '--apply');
    expect(await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: revoked.keyId } })).toMatchObject({ userId: null, roleId: null });
  });

  it('refuses to run with NODE_ENV=production unless --allow-production is passed', async () => {
    const fresh = await makeMcpKey(bareTenantId, { slug: 'prodguard', userId: null });
    expect(() => runScript({ NODE_ENV: 'production' }, '--apply')).toThrow();
    expect(await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: fresh.keyId } })).toMatchObject({ userId: null, roleId: null });
  });
});
