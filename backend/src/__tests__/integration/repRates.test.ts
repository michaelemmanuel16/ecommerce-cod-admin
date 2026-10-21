/**
 * M1-T18 (F-252, F-767, F-1054): rep rates, the payout regression, GET /api/users/reps/performance,
 * GET /api/reports/team and the MCP reps_performance tool. Hand-built orders in March 2025 on a two-tenant pair.
 *
 * Orders (all created 5 March 2025):
 *   rep A assigned + confirmed by A: 3 delivered, 1 failed, 1 returned, 1 out for delivery, 1 cancelled (price_too_high), 1 pending
 *   rep B: 1 delivered (assigned + confirmed by B), 1 pending, 1 delivered assigned to B but confirmed by A
 * A: confirmationRate 6/8 = 75, deliveredFromConfirmedRate 4/6 = 66.7. B: 2/3 = 66.7, 1/1 = 100.
 * All: confirmation 8/11 = 72.7, delivered from confirmed 5/7 = 71.4.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createMcpServer } from '../../mcp/createServer';
import { clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { runInTenant } from '../../utils/tenantContext';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeCustomer, makeOrder, makeUser } from './helpers/kpiOrders';
import { repRates } from '../../services/kpi/reps';
import { rates } from '../../services/kpi/rates';
import { getRepPerformanceDetails } from '../../services/repPerformanceService';
import { startOfDay, endOfDay } from '../../services/kpi/dates';

jest.mock('../../mcp/rateLimiter', () => ({
  checkMcp: async () => ({ allowed: true, limit: 30, remaining: 29, retryAfterSeconds: 0 }),
  keyFingerprint: (key: string) => key,
}));

let pair: TwoTenants;
let repA: number;
let repB: number;
let tenantId: string;
const day = new Date('2025-03-05T12:00:00Z');
const from = startOfDay('2025-03-01', 'Africa/Accra');
const to = endOfDay('2025-03-31', 'Africa/Accra');
const RANGE = 'from=2025-03-01&to=2025-03-31';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  pair = await createTwoTenants('reprates');
  tenantId = pair.a.id;
  repA = pair.a.users.salesRep.id;
  repB = (await makeUser(tenantId, 'rep-b', 'sales_rep')).id;
  const customerId = (await makeCustomer(tenantId)).id;
  const o = (i: Parameters<typeof makeOrder>[0] extends infer T ? Omit<T & object, 'tenantId' | 'customerId' | 'createdAt'> : never) =>
    makeOrder({ tenantId, customerId, createdAt: day, ...(i as object) } as any);
  const a = { customerRepId: repA, confirmedById: repA };
  for (let i = 0; i < 3; i++) await o({ ...a, status: 'delivered', deliveryDate: day });
  await o({ ...a, status: 'failed_delivery' });
  await o({ ...a, status: 'returned', returnedAt: day });
  await o({ ...a, status: 'out_for_delivery' });
  await prismaBase.order.update({
    where: { id: (await o({ customerRepId: repA, status: 'cancelled' })).id },
    data: { declineReason: 'price_too_high' },
  });
  await o({ customerRepId: repA, status: 'pending_confirmation' });
  await o({ customerRepId: repB, confirmedById: repB, status: 'delivered', deliveryDate: day });
  await o({ customerRepId: repB, status: 'pending_confirmation' });
  await o({ customerRepId: repB, confirmedById: repA, status: 'delivered', deliveryDate: day });

  const call = (salesRepId: number, outcome: any) =>
    prismaBase.call.create({ data: { customerId, salesRepId, outcome, tenantId, createdAt: day } });
  await call(repA, 'confirmed');
  await call(repA, 'no_answer');
  await call(repA, 'not_reachable');
  await call(repB, 'confirmed');
}, 60000);

afterAll(async () => {
  await Promise.all([...clients.values()].map((c) => c.close()));
  clearAuthCache();
  await pair.cleanup();
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

const clients = new Map<string, Client>();

describe('repRates (services/kpi/reps.ts)', () => {
  it('confirmation rate by assigned rep, delivered from confirmed by confirming rep', async () => {
    const r = await repRates(tenantId, from, to);
    expect(r.rep(repA).confirmationRate.value).toBe(75);
    expect(r.rep(repA).confirmationRate.detail).toEqual({ confirmed: 6, placed: 8 });
    expect(r.rep(repA).deliveredFromConfirmedRate.value).toBe(66.7);
    expect(r.rep(repA).deliveredFromConfirmedRate.detail).toEqual({ delivered: 4, failed: 1, returned: 1, closed: 6 });
    expect(r.rep(repB).confirmationRate.value).toBe(66.7);
    expect(r.rep(repB).deliveredFromConfirmedRate.value).toBe(100);
    expect(r.all.confirmationRate.value).toBe(72.7);
    expect(r.all.deliveredFromConfirmedRate.value).toBe(71.4);
    expect(r.all.deliveredFromConfirmedRate.formulaId).toBe('rate.deliveredFromConfirmed.v1');
  });

  it('matches rates() with a repId, and a rep with no orders is null, not NaN', async () => {
    const r = await repRates(tenantId, from, to);
    const std = await rates(tenantId, from, to, { repId: repA });
    expect(r.rep(repA).confirmationRate.value).toBe(std.confirmationRate.value);
    expect(r.rep(repA).deliveredFromConfirmedRate.value).toBe(std.deliverySuccessRate.value);
    expect(r.rep(999999).confirmationRate.value).toBeNull();
    expect(r.rep(999999).deliveredFromConfirmedRate.value).toBeNull();
  });

  it('rate code never reads commissionPaid', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/kpi/reps.ts'), 'utf8');
    expect(src).not.toMatch(/commissionPaid/);
  });
});

describe('payout regression (F-252, F-767)', () => {
  it('pay out all commission, re-read: the rates do not move', async () => {
    const read = () => runInTenant(tenantId, () => getRepPerformanceDetails(tenantId, String(repA), '2025-03-01', '2025-03-31'));
    const before = await read();
    const rateBefore = await repRates(tenantId, from, to);
    await prismaBase.order.updateMany({ where: { tenantId, status: 'delivered' }, data: { commissionPaid: true } });
    const after = await read();
    const rateAfter = await repRates(tenantId, from, to);

    expect(before[0].metrics.deliveredFromConfirmedRate.value).toBe(66.7);
    expect(after[0].metrics.deliveredFromConfirmedRate.value).toBe(66.7);
    expect(after[0].metrics.confirmationRate.value).toBe(75);
    expect(rateAfter.rep(repA).deliveredFromConfirmedRate.value).toBe(rateBefore.rep(repA).deliveredFromConfirmedRate.value);
    expect(rateAfter.all.deliveredFromConfirmedRate.value).toBe(rateBefore.all.deliveredFromConfirmedRate.value);
    expect('successRate' in after[0].metrics).toBe(false);
  });
});

describe('GET /api/users/reps/performance', () => {
  it('returns the two named rates and no successRate', async () => {
    const res = await request(app)
      .get('/api/users/reps/performance?startDate=2025-03-01&endDate=2025-03-31')
      .set(auth(pair.a.users.admin.token));
    expect(res.status).toBe(200);
    const row = res.body.performance.find((p: any) => p.repId === repA);
    expect(row.metrics.confirmationRate.value).toBe(75);
    expect(row.metrics.deliveredFromConfirmedRate.value).toBe(66.7);
    expect(JSON.stringify(res.body)).not.toMatch(/successRate|SuccessRate/);
    expect(JSON.stringify(res.body)).not.toContain(pair.b.marker);
  });

  it('a rep cannot read another rep with repId', async () => {
    const res = await request(app)
      .get(`/api/users/reps/performance?repId=${repB}&startDate=2025-03-01&endDate=2025-03-31`)
      .set(auth(pair.a.users.salesRep.token));
    expect(res.status).toBe(200);
    expect(res.body.performance.map((p: any) => p.repId)).toEqual([repA]);
  });

  it('400 for a date that is not a date', async () => {
    const res = await request(app).get('/api/users/reps/performance?startDate=nope').set(auth(pair.a.users.admin.token));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/reports/team', () => {
  it('401 with no token, 403 for a sales rep and a delivery agent', async () => {
    expect((await request(app).get(`/api/reports/team?${RANGE}`)).status).toBe(401);
    expect((await request(app).get(`/api/reports/team?${RANGE}`).set(auth(pair.a.users.salesRep.token))).status).toBe(403);
    expect((await request(app).get(`/api/reports/team?${RANGE}`).set(auth(pair.a.users.deliveryAgent.token))).status).toBe(403);
  });

  it('400 for a missing or reversed range', async () => {
    const h = auth(pair.a.users.admin.token);
    expect((await request(app).get('/api/reports/team').set(h)).status).toBe(400);
    expect((await request(app).get('/api/reports/team?from=2025-03-31&to=2025-03-01').set(h)).status).toBe(400);
  });

  it('admin gets tiles, rep rows and decline reasons for own tenant only', async () => {
    const res = await request(app).get(`/api/reports/team?${RANGE}`).set(auth(pair.a.users.admin.token));
    expect(res.status).toBe(200);
    const { tiles, reps, declineReasons } = res.body;
    expect(tiles.ordersConfirmed).toBe(8);
    expect(tiles.callsMade).toBe(4);
    expect(tiles.callsPerConfirmation).toBe(0.5);
    expect(tiles.notReachable).toEqual({ count: 2, percentOfCalls: 50 });
    expect(tiles.queue.pending).toBeGreaterThanOrEqual(2);
    const rowA = reps.find((r: any) => r.repId === repA);
    expect(rowA).toMatchObject({ calls: 3, confirmed: 7, notReachable: 2 });
    expect(rowA.confirmationRate.value).toBe(75);
    expect(rowA.deliveredFromConfirmedRate.value).toBe(66.7);
    expect(declineReasons).toEqual([{ reason: 'price_too_high', count: 1, percent: 100 }]);
    expect(res.body.all.deliveredFromConfirmedRate.value).toBe(71.4);
    expect(JSON.stringify(res.body)).not.toContain(pair.b.marker);
  });
});

describe('MCP reps_performance', () => {
  it('uses the named rates, string money and no successRate', async () => {
    const server = createMcpServer(() => pair.a.mcpKey);
    const client = new Client({ name: 'rep-rates-test', version: '1.0.0' });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(s), client.connect(c)]);
    clients.set('a', client);
    const res: any = await client.callTool({ name: 'reps_performance', arguments: { period: 'month' } });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0].text);
    expect(body.reps.length).toBeGreaterThan(0);
    for (const r of body.reps) {
      expect(r).toHaveProperty('confirmationRate');
      expect(r).toHaveProperty('deliveredFromConfirmedRate');
      expect(r.revenue).toMatch(/^-?\d+\.\d{2}$/);
    }
    expect(res.content[0].text).not.toMatch(/successRate/);
  });
});
