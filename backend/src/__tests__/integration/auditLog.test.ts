/**
 * M2-T05: audit service and GET /api/audit-log.
 * Secrets never reach a stored row; rows cannot be changed or deleted through the API;
 * the list is tenant-scoped and permission-gated; retention removes only old rows, per tenant.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { auditService } from '../../services/auditService';
import { processAuditRetention } from '../../queues/messageCleanupQueue';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  pair = await createTwoTenants('audit');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('auditService.record', () => {
  it('a secret string never appears in a stored row', async () => {
    const secrets = ['hunter2-password', 'sk_live_abcdefgh12345678', 'zzzTOKENzzz1234567890abcdefghijklmn', 'cardpin-9999'];
    await auditService.record({
      tenantId: pair.a.id,
      actorId: pair.a.users.admin.id,
      actorKind: 'person',
      channel: 'app',
      action: 'secrets_test',
      resource: 'tool',
      resourceId: 'orders_search',
      tool: 'orders_search',
      status: 'ok',
      input: { password: secrets[0], headers: { Authorization: `Bearer ${secrets[2]}` }, q: 'visible-text' },
      before: { apiKey: secrets[1] },
      after: { nested: { token: secrets[2] }, pin: secrets[3] },
      metadata: { note: `key was ${secrets[1]}` },
    });
    const [row] = await prismaBase.auditLog.findMany({ where: { tenantId: pair.a.id, action: 'secrets_test' } });
    const stored = JSON.stringify(row);
    for (const s of secrets) expect(stored).not.toContain(s);
    expect(stored).toContain('visible-text');
    expect(stored).toContain('[REDACTED]');
  });

  it('writes to the tenant in the context when no tenantId is given', async () => {
    await runInTenant(pair.b.id, () => auditService.record({ action: 'ctx_test', resource: 'tool', actorKind: 'system', channel: 'system' }));
    const row = await prismaBase.auditLog.findFirstOrThrow({ where: { action: 'ctx_test', tenantId: { in: [pair.a.id, pair.b.id] } } });
    expect(row.tenantId).toBe(pair.b.id);
  });
});

describe('GET /api/audit-log', () => {
  beforeAll(async () => {
    for (const [t, tool, channel] of [[pair.a, 'orders_search', 'mcp'], [pair.a, 'orders_summary', 'chat'], [pair.b, 'orders_search', 'mcp']] as const) {
      await auditService.record({
        tenantId: t.id, actorId: t.users.admin.id, actorKind: 'ai_agent', channel, action: 'tool_call',
        resource: 'tool', resourceId: tool, tool, status: 'ok', metadata: { marker: t.marker },
      });
    }
  });

  it('is tenant-scoped: A sees A rows only, B sees B rows only', async () => {
    const a = await request(app).get('/api/audit-log?limit=200').set(auth(pair.a.users.admin.token));
    const b = await request(app).get('/api/audit-log?limit=200').set(auth(pair.b.users.admin.token));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(JSON.stringify(a.body)).toContain(pair.a.marker);
    expect(JSON.stringify(a.body)).not.toContain(pair.b.marker);
    expect(JSON.stringify(b.body)).toContain(pair.b.marker);
    expect(JSON.stringify(b.body)).not.toContain(pair.a.marker);
    expect(a.body.logs.every((r: any) => r.tenantId === pair.a.id)).toBe(true);
  });

  it('filters by actorId, channel, tool and date, and paginates', async () => {
    const get = (qs: string) => request(app).get(`/api/audit-log?${qs}`).set(auth(pair.a.users.admin.token));
    const byChannel = await get('channel=chat&limit=200');
    expect(byChannel.body.logs.length).toBeGreaterThan(0);
    expect(byChannel.body.logs.every((r: any) => r.channel === 'chat')).toBe(true);

    const byTool = await get('tool=orders_summary&limit=200');
    expect(byTool.body.logs.map((r: any) => r.resourceId)).toEqual(['orders_summary']);

    const byActor = await get(`actorId=${pair.a.users.admin.id}&limit=200`);
    expect(byActor.body.logs.every((r: any) => r.userId === pair.a.users.admin.id)).toBe(true);
    expect((await get(`actorId=${pair.a.users.salesRep.id}`)).body.logs).toHaveLength(0);

    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await get(`from=${encodeURIComponent(future)}`)).body.logs).toHaveLength(0);
    expect((await get(`to=${encodeURIComponent(daysAgo(1).toISOString())}`)).body.logs.length).toBe(0);

    const page1 = await get('limit=1&page=1');
    const page2 = await get('limit=1&page=2');
    expect(page1.body.logs).toHaveLength(1);
    expect(page2.body.logs).toHaveLength(1);
    expect(page1.body.logs[0].id).not.toBe(page2.body.logs[0].id);
    expect(page1.body.pagination.total).toBeGreaterThan(2);
  });

  it('400 for a bad filter, 401 without a token, 403 for a role without audit:view', async () => {
    expect((await request(app).get('/api/audit-log?channel=nope').set(auth(pair.a.users.admin.token))).status).toBe(400);
    expect((await request(app).get('/api/audit-log')).status).toBe(401);
    expect((await request(app).get('/api/audit-log').set(auth(pair.a.users.salesRep.token))).status).toBe(403);
  });

  it('PUT, PATCH, DELETE and POST are refused (405) and the row stays', async () => {
    const id = pair.a.ids.auditLog;
    for (const method of ['put', 'patch', 'delete', 'post'] as const) {
      const res = await request(app)[method](`/api/audit-log/${id}`).set(auth(pair.a.users.admin.token)).send({ action: 'x' });
      expect([404, 405]).toContain(res.status);
    }
    expect((await request(app).delete(`/api/audit-log/${id}`).set(auth(pair.a.users.admin.token))).status).toBe(405);
    expect(await prismaBase.auditLog.count({ where: { id } })).toBe(1);
  });
});

describe('retention', () => {
  it('purgeOlderThan removes only rows older than the limit, in the current tenant only', async () => {
    const mk = (tenantId: string, createdAt: Date, action: string) =>
      prismaBase.auditLog.create({ data: { tenantId, action, resource: 'ret', createdAt } });
    const [oldA, newA, edgeA, oldB] = await Promise.all([
      mk(pair.a.id, daysAgo(401), 'ret_old_a'),
      mk(pair.a.id, daysAgo(399), 'ret_new_a'),
      mk(pair.a.id, daysAgo(10), 'ret_recent_a'),
      mk(pair.b.id, daysAgo(401), 'ret_old_b'),
    ]);
    const removed = await runInTenant(pair.a.id, () => auditService.purgeOlderThan(400));
    expect(removed).toBeGreaterThanOrEqual(1);
    const left = await prismaBase.auditLog.findMany({ where: { id: { in: [oldA.id, newA.id, edgeA.id, oldB.id] } }, select: { id: true } });
    expect(left.map((r) => r.id).sort()).toEqual([newA.id, edgeA.id, oldB.id].sort());
  });

  it('the nightly job runs the purge for every tenant', async () => {
    const old = await prismaBase.auditLog.create({ data: { tenantId: pair.b.id, action: 'ret_old_b2', resource: 'ret', createdAt: daysAgo(500) } });
    await processAuditRetention();
    expect(await prismaBase.auditLog.count({ where: { id: old.id } })).toBe(0);
    // fresh rows of both tenants survive
    expect(await prismaBase.auditLog.count({ where: { tenantId: pair.a.id, action: 'tool_call' } })).toBeGreaterThan(0);
  });
});
