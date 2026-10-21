/**
 * M2-T18 (COD-21): security and isolation gaps left after the per-task suites. Two tenants.
 *  - a tenantId planted in the input of every one of the 14 tools (registry path and POST /mcp) is dropped before
 *    the handler runs, and the call, its audit row and its writes stay in the key's tenant
 *  - GET /api/audit-log filters and extra query keys cannot widen the scope to another tenant
 *  - mcp-keys: a planted tenantId in the body is ignored; A cannot revoke or list B keys
 *  - system user: A's system user is nobody in B; a workflow action in A uses A's system user and cannot reach B
 *  - secrets: no raw key, key hash, bearer token or password reaches any audit row after use, create and revoke
 * Already covered elsewhere (not repeated): twoTenantMcp, mcpAudit (denied rows), mcpKeys, rateLimiter, toolRegistry.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { runInTenant, getTenantId } from '../../utils/tenantContext';
import { hashApiKey, clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { getTool, listTools, runTool } from '../../tools/registry';
import '../../tools';
import { getSystemUserId } from '../../services/systemUserService';
import { executeAction } from '../../queues/workflowQueue';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { toolActorContext, toolAuditCount, toolAuditRows } from './helpers/callTool';
import { makeMcpKey } from './helpers/mcpKey';

// 14 tools x two paths would trip the 30 calls a minute bucket. Plain function: resetMocks would wipe a jest.fn.
jest.mock('../../mcp/rateLimiter', () => require('./helpers/allowAllRateLimiter').allowAllRateLimiter());

jest.setTimeout(120_000);

let pair: TwoTenants;
let ownerA: string;

/** Every shape a caller might use to name a tenant, aimed at tenant B. */
const planted = (bId: string) => ({
  tenantId: bId,
  tenant_id: bId,
  TenantId: bId,
  tenant: { id: bId },
  where: { tenantId: bId },
  data: { tenantId: bId },
  filter: { tenant_id: bId },
});
const PLANTED_KEYS = ['tenantId', 'tenant_id', 'TenantId', 'tenant', 'where', 'data', 'filter'];

/** Valid input per tool, aimed at tenant A's own rows. */
const argsFor = (): Record<string, Record<string, unknown>> => ({
  orders_search: { limit: 5 },
  orders_summary: { period: 'month' },
  orders_update_status: { orderId: pair.a.ids.order, status: 'preparing' },
  customers_lookup: { name: 'Cust' },
  products_inventory: {},
  deliveries_active: {},
  agents_status: {},
  agents_performance: { period: 'month' },
  reps_status: {},
  reps_performance: { period: 'month' },
  analytics_daily: {},
  analytics_weekly: {},
  analytics_monthly: {},
  financial_summary: { period: 'month' },
});

const leakTokens = () => {
  const { b } = pair;
  return [b.marker, b.phone, b.slug, b.formSlug, b.users.admin.email, b.users.deliveryAgent.email, b.amount];
};

/** Wrap a tool handler to record the input it gets and the tenant it runs in. Returns the log and a restore function. */
function spyHandler(name: string) {
  const def = getTool(name)!;
  const orig = def.handler;
  const calls: Array<{ input: Record<string, unknown>; tenant: string | undefined }> = [];
  def.handler = (input, ctx, trace) => {
    calls.push({ input: input as Record<string, unknown>, tenant: getTenantId() });
    return orig(input, ctx, trace);
  };
  return { calls, restore: () => { def.handler = orig; } };
}

beforeAll(async () => {
  pair = await createTwoTenants('m2sec');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'owner-sec');
  // orders_update_status moves confirmed -> preparing: touches neither stock nor the ledger
  await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { status: 'confirmed' } });
}, 60_000);

afterAll(async () => {
  clearAuthCache();
  await pair.cleanup();
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

describe('a planted tenantId in tool input is ignored (all 14 tools)', () => {
  it('registry path: the handler never sees a tenant key, runs in the actor tenant, and the audit rows stay in A', async () => {
    const { a, b } = pair;
    const ctx = await toolActorContext(a.id, 'mcp');
    const bRowsBefore = await toolAuditCount(b.id);
    const bOrderBefore = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    const calls = argsFor();
    expect(Object.keys(calls).sort()).toEqual(listTools().map((t) => t.name).sort());

    for (const [tool, args] of Object.entries(calls)) {
      const spy = spyHandler(tool);
      try {
        const aBefore = (await toolAuditRows(a.id, tool)).length;
        const res = await runTool(tool as never, { ...args, ...planted(b.id) }, ctx);
        expect({ tool, status: res.status }).toEqual({ tool, status: 'ok' });
        expect(spy.calls).toHaveLength(1);
        expect({ tool, keys: Object.keys(spy.calls[0].input).filter((k) => PLANTED_KEYS.includes(k)) }).toEqual({ tool, keys: [] });
        expect({ tool, tenant: spy.calls[0].tenant }).toEqual({ tool, tenant: a.id });
        expect({ tool, leaked: leakTokens().filter((t) => JSON.stringify(res).includes(t)) }).toEqual({ tool, leaked: [] });
        expect((await toolAuditRows(a.id, tool)).length - aBefore).toBe(1);
      } finally {
        spy.restore();
      }
    }
    expect(await toolAuditCount(b.id)).toBe(bRowsBefore);
    const bOrderAfter = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    expect(bOrderAfter.status).toBe(bOrderBefore.status);
    expect(bOrderAfter.updatedAt).toEqual(bOrderBefore.updatedAt);
  });

  it('POST /mcp: the same planted input leaves the call, its row and its write in the key tenant', async () => {
    const { a, b } = pair;
    await prismaBase.order.update({ where: { id: a.ids.order }, data: { status: 'confirmed' } });
    const bRowsBefore = await toolAuditCount(b.id);
    let id = 0;
    for (const [tool, args] of Object.entries(argsFor())) {
      const spy = spyHandler(tool);
      try {
        const aBefore = (await toolAuditRows(a.id, tool)).length;
        const res = await request(app)
          .post('/mcp')
          .set('Authorization', `Bearer ${a.mcpKey}`)
          .set('Content-Type', 'application/json')
          .send({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: tool, arguments: { ...args, ...planted(b.id) } } });
        expect(res.status).toBe(200);
        const text = JSON.stringify(res.body);
        expect({ tool, isError: !!res.body.result?.isError, text: res.body.result?.isError ? text : '' }).toEqual({ tool, isError: false, text: '' });
        expect({ tool, tenant: spy.calls.map((c) => c.tenant) }).toEqual({ tool, tenant: [a.id] });
        expect(Object.keys(spy.calls[0].input).filter((k) => PLANTED_KEYS.includes(k))).toEqual([]);
        expect({ tool, leaked: leakTokens().filter((t) => text.includes(t)) }).toEqual({ tool, leaked: [] });
        expect((await toolAuditRows(a.id, tool)).length - aBefore).toBe(1);
      } finally {
        spy.restore();
      }
    }
    expect(await toolAuditCount(b.id)).toBe(bRowsBefore);
  });

  it("orders_update_status with B's order id and a planted B tenantId is not found and B's order is untouched", async () => {
    const { a, b } = pair;
    const before = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    const bRowsBefore = await toolAuditCount(b.id);
    const input = { orderId: b.ids.order, status: 'cancelled', ...planted(b.id) };

    const reg = await runTool('orders_update_status', input, await toolActorContext(a.id, 'mcp'));
    expect(reg).toMatchObject({ status: 'error', error: expect.stringMatching(/not found/i) });

    const http = await request(app).post('/mcp').set('Authorization', `Bearer ${a.mcpKey}`).set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orders_update_status', arguments: input } });
    expect(http.body.result.isError).toBe(true);
    expect(http.body.result.content[0].text).toMatch(/not found/i);

    const after = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    expect({ status: after.status, updatedAt: after.updatedAt }).toEqual({ status: before.status, updatedAt: before.updatedAt });
    expect(await prismaBase.orderHistory.count({ where: { orderId: b.ids.order, status: 'cancelled' } })).toBe(0);
    expect(await toolAuditCount(b.id)).toBe(bRowsBefore); // the error rows are A's
  });

  it('a denied call with a planted tenantId writes its denied row in the key tenant, none in B', async () => {
    const { a, b } = pair;
    const { key, userId, roleId } = await makeMcpKey(a.id, { slug: 'sec-callrep', userRole: 'admin', roleName: 'Call rep' });
    const aBefore = (await toolAuditRows(a.id, 'financial_summary')).length;
    const bRowsBefore = await toolAuditCount(b.id);
    const res = await request(app).post('/mcp').set('Authorization', `Bearer ${key}`).set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'financial_summary', arguments: { period: 'month', ...planted(b.id) } } });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/role does not include/i);
    const rows = await toolAuditRows(a.id, 'financial_summary');
    expect(rows.length - aBefore).toBe(1);
    expect(rows.at(-1)).toMatchObject({ tenantId: a.id, userId, roleId, channel: 'mcp' });
    expect(rows.at(-1)!.metadata).toMatchObject({ status: 'denied' });
    expect(await toolAuditCount(b.id)).toBe(bRowsBefore);
  });
});

describe('GET /api/audit-log: filters cannot widen the scope', () => {
  const MARK = 'sec-widen';

  beforeAll(async () => {
    for (const t of [pair.a, pair.b]) {
      await prismaBase.auditLog.create({
        data: {
          tenantId: t.id, userId: t.users.admin.id, actorKind: 'ai_agent', channel: 'mcp', action: 'tool_call',
          resource: 'tool', resourceId: 'orders_search', metadata: { tool: 'orders_search', status: 'ok', marker: t.marker, note: MARK },
        },
      });
    }
  });

  const get = (qs: string, headers: Record<string, string> = {}) =>
    request(app).get(`/api/audit-log?${qs}`).set(bearer(pair.a.users.admin.token)).set(headers);

  it("tenant keys in the query or headers, and B's actor id, return no B row", async () => {
    const { a, b } = pair;
    const attempts: Array<[string, Record<string, string>]> = [
      [`tenantId=${b.id}&limit=200`, {}],
      [`tenant_id=${b.id}&limit=200`, {}],
      [`tenant=${b.slug}&limit=200`, {}],
      ['limit=200', { 'X-Tenant-Id': b.id }],
      ['limit=200', { 'X-Tenant': b.slug }],
      [`where[tenantId]=${b.id}&limit=200`, {}],
      [`actorId=${b.users.admin.id}&limit=200`, {}],
      [`actorId=${b.users.admin.id}&tool=orders_search&channel=mcp&limit=200`, {}],
      [`tool=orders_search&channel=mcp&limit=200`, {}],
    ];
    for (const [qs, headers] of attempts) {
      const res = await get(qs, headers);
      expect({ qs, status: res.status }).toEqual({ qs, status: 200 });
      expect({ qs, other: JSON.stringify(res.body).includes(b.marker) }).toEqual({ qs, other: false });
      expect({ qs, foreign: res.body.logs.filter((r: any) => r.tenantId !== a.id).length }).toEqual({ qs, foreign: 0 });
      expect({ qs, total: res.body.pagination.total }).toEqual({ qs, total: await prismaBase.auditLog.count({ where: { tenantId: a.id, ...filterOf(qs) } }) });
    }
    // sanity: the scan can fail, A does see its own row
    expect(JSON.stringify((await get('tool=orders_search&channel=mcp&limit=200')).body)).toContain(a.marker);
  });

  /** The part of a query that narrows a tenant-A listing (the rest must change nothing). */
  function filterOf(qs: string) {
    const p = new URLSearchParams(qs);
    return {
      ...(p.get('actorId') && { userId: Number(p.get('actorId')) }),
      ...(p.get('channel') && { channel: p.get('channel') as any }),
      ...(p.get('tool') && { resourceId: p.get('tool')! }),
    };
  }

  it('B sees only B rows with the same attempts aimed at A', async () => {
    const { a, b } = pair;
    const res = await request(app).get(`/api/audit-log?tenantId=${a.id}&actorId=${a.users.admin.id}&limit=200`).set(bearer(b.users.admin.token));
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(0);
    const all = await request(app).get('/api/audit-log?limit=200').set(bearer(b.users.admin.token)).set('X-Tenant-Id', a.id);
    expect(JSON.stringify(all.body)).not.toContain(a.marker);
  });
});

describe('MCP keys: tenant isolation of the API', () => {
  it('a planted tenantId in the create body is ignored: the key and its audit row are A', async () => {
    const { a, b } = pair;
    const role = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: a.id, name: 'Delivery' } })).id;
    const res = await request(app).post('/api/mcp-keys').set(bearer(ownerA)).send({ label: 'planted', roleId: role, tenantId: b.id, tenant_id: b.id });
    expect(res.status).toBe(201);
    const row = await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.tenantId).toBe(a.id);
    const audit = await prismaBase.auditLog.findMany({ where: { resource: 'mcp_key', resourceId: res.body.id } });
    expect(audit.map((r) => r.tenantId)).toEqual([a.id]);
  });

  it("A's owner cannot list, revoke or role-assign against B's key", async () => {
    const { a, b } = pair;
    const bKey = await makeMcpKey(b.id, { slug: 'sec-bkey', roleName: 'Owner' });
    const list = await request(app).get('/api/mcp-keys').set(bearer(ownerA));
    expect(JSON.stringify(list.body)).not.toContain(bKey.keyId);
    expect((await request(app).delete(`/api/mcp-keys/${bKey.keyId}`).set(bearer(ownerA))).status).toBe(404);
    expect((await prismaBase.mcpApiKey.findUniqueOrThrow({ where: { id: bKey.keyId } })).revokedAt).toBeNull();
    // B's role and B's ai_agent user cannot be given to an A key
    const aRole = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: a.id, name: 'Delivery' } })).id;
    const bad = await request(app).post('/api/mcp-keys').set(bearer(ownerA)).send({ label: 'x-user', roleId: aRole, userId: bKey.userId });
    expect(bad.status).toBe(400);
    // and B's key still works for B only
    clearAuthCache();
    const call = await request(app).post('/mcp').set('Authorization', `Bearer ${bKey.key}`).set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'customers_lookup', arguments: { name: 'Cust' } } });
    expect(call.body.result.isError).not.toBe(true);
    expect(JSON.stringify(call.body)).toContain(b.marker);
    expect(JSON.stringify(call.body)).not.toContain(a.marker);
  });
});

describe('system user isolation', () => {
  it("A's system user is nobody in B: a tool call as that actor in B is denied and changes nothing", async () => {
    const { a, b } = pair;
    const sysA = await getSystemUserId(a.id);
    expect(await runInTenant(b.id, () => getSystemUserId(a.id))).toBe(sysA); // an explicit tenant argument wins over the context
    expect(sysA).not.toBe(await getSystemUserId(b.id));
    const before = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });

    const res = await runTool('orders_update_status', { orderId: b.ids.order, status: 'cancelled' },
      { tenantId: b.id, actorId: sysA, actorKind: 'system', roleId: null, channel: 'mcp' });
    expect(res.status).toBe('denied');
    const after = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    expect(after.status).toBe(before.status);
    const rows = await toolAuditRows(b.id, 'orders_update_status');
    expect(rows.at(-1)).toMatchObject({ tenantId: b.id, userId: sysA });
    expect(rows.at(-1)!.metadata).toMatchObject({ status: 'denied' });
  });

  it("a workflow action in A moves A's order as A's system user, and cannot move B's order", async () => {
    const { a, b } = pair;
    const order = await prismaBase.order.create({
      data: { customerId: a.ids.customer, status: 'confirmed', subtotal: 10, totalAmount: 10, tenantId: a.id } as any,
    });
    const sysA = await getSystemUserId(a.id);
    const sysB = await getSystemUserId(b.id);
    const bBefore = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });

    await runInTenant(a.id, () => executeAction({ type: 'update_order', config: { status: 'preparing' } }, { orderId: order.id }));
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('preparing');
    const history = await prismaBase.orderHistory.findMany({ where: { orderId: order.id, status: 'preparing' } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ actorKind: 'system', changedBy: sysA });
    expect(history[0].changedBy).not.toBe(sysB);

    await expect(runInTenant(a.id, () =>
      executeAction({ type: 'update_order', config: { status: 'cancelled' } }, { orderId: b.ids.order }))).rejects.toThrow();
    const bAfter = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    expect({ status: bAfter.status, updatedAt: bAfter.updatedAt }).toEqual({ status: bBefore.status, updatedAt: bBefore.updatedAt });
    expect(await prismaBase.orderHistory.count({ where: { orderId: b.ids.order, changedBy: sysA } })).toBe(0);
  });
});

describe('secrets never reach an audit row', () => {
  it('after a key is created, used with secrets in the input, errors, and is revoked, no row of the tenant holds a secret', async () => {
    const { a } = pair;
    const role = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: a.id, name: 'Owner' } })).id;
    const created = await request(app).post('/api/mcp-keys').set(bearer(ownerA)).send({ label: 'Secret scan', roleId: role });
    expect(created.status).toBe(201);
    const rawKey: string = created.body.key;
    const hash = hashApiKey(rawKey);
    const password = 'Sup3rS3cretPassw0rd!';
    const jwt = generateAccessToken({ id: 1, email: 'x@codadmin.test', role: 'admin', tenantId: a.id });

    const call = (name: string, args: Record<string, unknown>) =>
      request(app).post('/mcp').set('Authorization', `Bearer ${rawKey}`).set('Content-Type', 'application/json')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    await call('orders_search', { search: rawKey });                                  // the key as a value
    await call('orders_search', { search: hash });                                    // its hash as a value
    await call('orders_search', { search: `Bearer ${rawKey}`, authorization: `Bearer ${rawKey}`, password, token: jwt, apiKey: rawKey });
    await call('orders_summary', { period: 'decade', password, headers: { Authorization: `Bearer ${rawKey}` } }); // invalid
    await call('orders_update_status', { orderId: 999999999, status: 'preparing', notes: `token ${jwt}` });         // error
    await call('no_such_tool', { password, key: rawKey });                                                       // unknown tool

    expect((await request(app).delete(`/api/mcp-keys/${created.body.id}`).set(bearer(ownerA))).status).toBe(200);

    const rows = await prismaBase.auditLog.findMany({ where: { tenantId: a.id } });
    expect(rows.some((r) => (r.metadata as any)?.tool === 'orders_search')).toBe(true);
    const stored = JSON.stringify(rows);
    for (const secret of [rawKey, hash, `Bearer ${rawKey}`, password, jwt, created.body.keyPrefix + rawKey.slice(12, 20)]) {
      expect({ leaked: stored.includes(secret) ? secret.slice(0, 12) : null }).toEqual({ leaked: null });
    }
    expect(stored).not.toContain('keyHash');

    // and the list API that serves those rows
    const list = await request(app).get('/api/audit-log?limit=200').set(bearer(pair.a.users.admin.token));
    const text = JSON.stringify(list.body);
    for (const secret of [rawKey, hash, password, jwt]) expect(text).not.toContain(secret);
  });
});
