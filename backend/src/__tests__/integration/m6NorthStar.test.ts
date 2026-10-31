/**
 * M6-T08 (COD-57, F-1111 to F-1113): North Star service and /api/targets routes, end to end. Fixture numbers (1.8M, 360/420/480/540k,
 * 723 / 1,721 / 56), custom quarters that do not add up, rates of 0, AOV empty and required, a manual AOV that survives a re-plan,
 * a closed month that does not move, tenant isolation and permissions on every route. The clock is fixed at 17 October 2026.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

jest.setTimeout(90_000);

let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let roleId: number;
const A = () => pair.a.id;
const api = {
  get: (t: string, url: string) => request(app).get(url).set(bearer(t)),
  post: (t: string, url: string, body: object = {}) => request(app).post(url).set(bearer(t)).send(body),
  put: (t: string, url: string, body: object = {}) => request(app).put(url).set(bearer(t)).send(body),
  del: (t: string, url: string) => request(app).delete(url).set(bearer(t)),
};
const message = (res: request.Response) => String(res.body.message ?? res.body.error);
const monthRow = (period: string) => prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'month', metric: 'revenue', periodStart: new Date(`${period}-01`) } });
const planBody = (extra: object = {}) => ({ year: 2026, annual: 1_800_000, mode: 'grow', ...extra });

beforeAll(async () => {
  jest.useFakeTimers({
    now: new Date('2026-10-17T12:00:00Z'),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  pair = await createTwoTenants('m6northstar');
  ownerA = await superAdminToken(A(), pair.a.slug);
  ownerB = await superAdminToken(pair.b.id, pair.b.slug);
  roleId = (await prismaBase.role.create({ data: { tenantId: A(), name: 'Call rep T08', area: 'Sales' } })).id;
  // Tenant A has one delivered order of 245 in the last 30 days (the fixture AOV); tenant B has none.
  await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { status: 'delivered', deliveryDate: new Date('2026-10-10T10:00:00Z'), totalAmount: 245, subtotal: 245, codAmount: 245 } });
}, 90_000);

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.roleAssignment.deleteMany({ where: { roleId } });
  await prismaBase.auditLog.deleteMany({ where: { tenantId: A(), resource: 'target' } });
  await prismaBase.target.deleteMany({ where: { tenantId: { in: [A(), pair.b.id] }, metric: { in: ['revenue', 'planned_aov', 'confirmation_rate', 'delivery_success_rate', 'net_margin', 'failed_delivery_calls_per_day'] } } });
  await prismaBase.role.delete({ where: { id: roleId } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('AOV required', () => {
  it('no delivered orders in 30 days: the AOV is empty and required, and the tree is not saved', async () => {
    const drivers = await api.get(ownerB, '/api/targets/drivers?year=2026');
    expect(drivers.body.plannedAov).toMatchObject({ value: null, source: 'auto', required: true });
    const res = await api.post(ownerB, '/api/targets/north-star', planBody());
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.errorCode).toBe('AOV_REQUIRED');
    expect(await prismaBase.target.count({ where: { tenantId: pair.b.id, metric: 'revenue', scope: { in: ['north_star', 'quarter', 'month'] } } })).toBe(0);
  });

  it('typing an AOV with the tree saves both', async () => {
    const res = await api.post(ownerB, '/api/targets/north-star', planBody({ plannedAov: 249 }));
    expect(res.status).toBe(201);
    expect((await api.get(ownerB, '/api/targets/drivers?year=2026')).body.plannedAov).toMatchObject({ value: '249.00', source: 'manual', required: false });
  });
});

describe('create the tree', () => {
  it('grow: 1,800,000 gives 360/420/480/540k and 120/140/160/180k a month; the AOV default is 245 (auto)', async () => {
    const res = await api.post(ownerA, '/api/targets/north-star', planBody());
    expect(res.status).toBe(201);
    expect(res.body.northStar.value).toBe('1800000.00');
    expect(res.body.quarters.map((q: any) => Number(q.value))).toEqual([360_000, 420_000, 480_000, 540_000]);
    expect(res.body.months.map((m: any) => Number(m.value))).toEqual([120, 120, 120, 140, 140, 140, 160, 160, 160, 180, 180, 180].map((v) => v * 1000));
    expect(res.body.months.every((m: any) => m.parentId !== null)).toBe(true);
    expect((await api.get(ownerA, '/api/targets/drivers?year=2026')).body.plannedAov).toMatchObject({ value: '245.00', source: 'auto', last30Days: '245.00', deliveredOrders: 1 });
  });

  it('GET tree returns the same rows; with a month it adds the role targets', async () => {
    const res = await api.get(ownerA, '/api/targets/tree?year=2026');
    expect(res.status).toBe(200);
    expect(res.body.quarters).toHaveLength(4);
    expect(res.body.months).toHaveLength(12);
    expect(res.body.roles).toBeUndefined();
  });

  it('custom quarters that do not add up are blocked with the difference; nothing changes', async () => {
    const res = await api.post(ownerA, '/api/targets/north-star', planBody({ mode: 'custom', customQuarters: [300_000, 400_000, 500_000, 500_000] }));
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.errorCode).toBe('TARGET_SUM_MISMATCH');
    expect(message(res)).toMatch(/Difference: 100000\.00/);
    const tree = await api.get(ownerA, '/api/targets/tree?year=2026');
    expect(tree.body.quarters.map((q: any) => Number(q.value))).toEqual([360_000, 420_000, 480_000, 540_000]);
  });
});

describe('calculators (October fixture)', () => {
  it('180,000 / 249 = 723; / (0.70 x 0.60) = 1,721; / 31 = 56; max cost from the profit given', async () => {
    const res = await api.get(ownerA, '/api/targets/calculators?month=2026-10&aov=249&confirmationRate=70&deliverySuccessRate=60&profitPerOrder=20720');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revenueTarget: '180000.00', ordersDelivered: 723, ordersToTakeIn: 1721, ordersPerDay: 56, daysInMonth: 31, maxCostPerOrder: '8702.40' });
  });

  it('without an AOV it uses the planned AOV in use (245)', async () => {
    const res = await api.get(ownerA, '/api/targets/calculators?month=2026-10&profitPerOrder=20720');
    expect(res.body).toMatchObject({ plannedAov: '245.00', plannedAovSource: 'auto', ordersDelivered: 735 });
  });

  it('a rate of 0, or above 100, is rejected', async () => {
    for (const q of ['confirmationRate=0', 'deliverySuccessRate=0', 'confirmationRate=101']) {
      const res = await api.get(ownerA, `/api/targets/calculators?month=2026-10&aov=249&${q}`);
      expect(res.status).toBe(400);
      expect(res.body.code ?? res.body.errorCode).toBe('RATE_INVALID');
    }
    const save = await api.put(ownerA, '/api/targets/drivers', { year: 2026, deliverySuccessRate: 0 });
    expect(save.status).toBe(400);
    expect(save.body.code ?? save.body.errorCode).toBe('RATE_INVALID');
  });
});

describe('driver targets and the manual AOV', () => {
  it('saves the rates and a manual AOV; the AOV is kept when the tree is re-planned; reset goes back to the default', async () => {
    const saved = await api.put(ownerA, '/api/targets/drivers', { year: 2026, plannedAov: 250, confirmationRate: 72, deliverySuccessRate: 58 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ confirmationRate: { value: 72, source: 'target' }, deliverySuccessRate: { value: 58 }, plannedAov: { value: '250.00', source: 'manual' } });
    const replan = await api.post(ownerA, '/api/targets/north-star', planBody({ mode: 'even' }));
    expect(replan.status).toBe(201);
    expect((await api.get(ownerA, '/api/targets/drivers?year=2026')).body.plannedAov).toMatchObject({ value: '250.00', source: 'manual', last30Days: '245.00' });
    const reset = await api.put(ownerA, '/api/targets/drivers', { year: 2026, plannedAov: null });
    expect(reset.body.plannedAov).toMatchObject({ value: '245.00', source: 'auto' });
    expect(await prismaBase.target.count({ where: { tenantId: A(), metric: 'planned_aov' } })).toBe(0);
  });
});

describe('role, person and daily targets', () => {
  it('a role target under November, a person under it, the pool and "Set a target"', async () => {
    const nov = await monthRow('2026-11');
    expect(Number(nov.value)).toBe(180_000);
    const rep = pair.a.users.salesRep.id;
    await prismaBase.roleAssignment.create({ data: { tenantId: A(), roleId, holderId: rep, fromDate: new Date('2026-01-01') } });
    const before = await api.get(ownerA, `/api/targets/roles/${roleId}/pool?month=2026-11`);
    expect(before.body.pool).toBeNull();
    const role = await api.post(ownerA, '/api/targets', { scope: 'role', metric: 'revenue', unit: 'money', value: 100_000, period: '2026-11', roleId });
    expect(role.status).toBe(201);
    expect((await api.get(ownerA, `/api/targets/roles/${roleId}/pool?month=2026-11`)).body.holders).toEqual([expect.objectContaining({ userId: rep, target: null, label: 'Set a target' })]);
    const person = await api.post(ownerA, '/api/targets', { scope: 'person', metric: 'revenue', unit: 'money', value: 40_000, period: '2026-11', roleId, userId: rep });
    expect(person.status).toBe(201);
    const pool = await api.get(ownerA, `/api/targets/roles/${roleId}/pool?month=2026-11`);
    expect(pool.body.pool).toMatchObject({ total: '100000.00', allocated: '40000.00', pool: '60000.00' });
    const tree = await api.get(ownerA, '/api/targets/tree?year=2026&month=2026-11');
    expect(tree.body.roles).toEqual([expect.objectContaining({ roleId, roleName: 'Call rep T08', pool: expect.objectContaining({ pool: '60000.00' }) })]);
  });

  it('a person target over the role is rejected with the difference; PUT changes a value', async () => {
    const over = await api.post(ownerA, '/api/targets', { scope: 'person', metric: 'revenue', unit: 'money', value: 150_000, period: '2026-11', roleId, userId: pair.a.users.salesRep.id });
    expect(over.status).toBe(400);
    expect(message(over)).toMatch(/Difference: 50000\.00/);
    const person = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'person' } });
    const put = await api.put(ownerA, `/api/targets/${person.id}`, { value: 50_000 });
    expect(put.status).toBe(200);
    expect(Number(put.body.target.value)).toBe(50_000);
  });

  it('daily target: saves and reads; a metric with no source says "No data for this metric"', async () => {
    const save = await api.post(ownerA, '/api/targets', { scope: 'daily', metric: 'failed_delivery_calls_per_day', unit: 'count', value: 15, period: '2026-11-01' });
    expect(save.status).toBe(201);
    expect((await api.get(ownerA, '/api/targets/daily?metric=failed_delivery_calls_per_day&date=2026-11-02')).body).toMatchObject({ target: 15, actual: 0 });
    await api.post(ownerA, '/api/targets', { scope: 'daily', metric: 'whatsapp_follow_ups', unit: 'count', value: 30, period: '2026-11-01' });
    expect((await api.get(ownerA, '/api/targets/daily?metric=whatsapp_follow_ups&date=2026-11-02')).body).toMatchObject({ actual: null, message: 'No data for this metric' });
  });

  it('DELETE removes a person target; a quarter cannot be deleted', async () => {
    const person = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'person' } });
    expect((await api.del(ownerA, `/api/targets/${person.id}`)).status).toBe(200);
    const q = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'quarter', periodStart: new Date('2026-10-01') } });
    expect((await api.del(ownerA, `/api/targets/${q.id}`)).status).toBe(409);
  });
});

describe('closed month and past months', () => {
  it('re-plan with October closed: October and the past months keep their value; November and December take the rest', async () => {
    await prismaBase.target.updateMany({ where: { tenantId: A(), scope: 'month', periodStart: new Date('2026-10-01') }, data: { closedAt: new Date() } });
    const res = await api.post(ownerA, '/api/targets/north-star', planBody({ annual: 2_000_000, mode: 'even' }));
    expect(res.status).toBe(201);
    expect(res.body.pastMonthsKept).toBe(10);
    const q = res.body.quarters.map((x: any) => Number(x.value));
    expect(q).toEqual([360_000, 420_000, 480_000, 740_000]); // Q1 to Q3 are past: they keep the grow plan
    const m = res.body.months.map((x: any) => Number(x.value));
    expect(m.slice(0, 9)).toEqual([120, 120, 120, 140, 140, 140, 160, 160, 160].map((v) => v * 1000));
    expect(m.slice(9)).toEqual([180_000, 280_000, 280_000]);
  });

  it('PUT children on Q4: the closed October keeps its value, November and December can move', async () => {
    const q4 = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'quarter', periodStart: new Date('2026-10-01') } });
    const ok = await api.put(ownerA, `/api/targets/${q4.id}/children`, { children: [{ period: '2026-11', value: 200_000 }, { period: '2026-12', value: 360_000 }] });
    expect(ok.status).toBe(200);
    const bad = await api.put(ownerA, `/api/targets/${q4.id}/children`, { children: [{ period: '2026-10', value: 100_000 }, { period: '2026-11', value: 320_000 }, { period: '2026-12', value: 320_000 }] });
    expect(bad.status).toBe(409);
    expect(bad.body.code ?? bad.body.errorCode).toBe('MONTH_CLOSED');
    expect(Number((await monthRow('2026-10')).value)).toBe(180_000);
  });
});

describe('tenant isolation and permissions', () => {
  it('tenant B sees none of tenant A and cannot touch it', async () => {
    const tree = await api.get(ownerB, '/api/targets/tree?year=2026');
    expect(tree.body.quarters.map((q: any) => Number(q.value))).toEqual([360_000, 420_000, 480_000, 540_000]); // B's own tree, not A's
    const aRows = await prismaBase.target.findMany({ where: { tenantId: A(), scope: 'month' }, take: 1 });
    const id = aRows[0].id;
    expect((await api.put(ownerB, `/api/targets/${id}`, { value: 1 })).status).toBe(404);
    expect((await api.del(ownerB, `/api/targets/${id}`)).status).toBe(404);
    const q4 = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'quarter' } });
    expect((await api.put(ownerB, `/api/targets/${q4.id}/children`, { children: [{ period: '2026-01', value: 1 }] })).status).toBe(404);
    expect((await api.get(ownerB, `/api/targets/roles/${roleId}/pool?month=2026-11`)).body).toMatchObject({ pool: null, holders: [] });
    expect((await api.get(ownerB, '/api/targets/daily?metric=failed_delivery_calls_per_day&date=2026-11-02')).body.target).toBeNull();
    expect((await api.get(ownerB, '/api/targets/drivers?year=2026')).body.confirmationRate.source).toBe('default');
  });

  it('a sales rep is refused on every route; an admin reads and sets one target but cannot set the North Star', async () => {
    const rep = pair.a.users.salesRep.token;
    const calls = [
      api.get(rep, '/api/targets/tree?year=2026'), api.get(rep, `/api/targets/roles/${roleId}/pool?month=2026-11`),
      api.get(rep, '/api/targets/daily?metric=x&date=2026-11-02'), api.get(rep, '/api/targets/drivers?year=2026'), api.get(rep, '/api/targets/calculators'),
      api.post(rep, '/api/targets/north-star', planBody()), api.put(rep, '/api/targets/drivers', { year: 2026, netMargin: 30 }),
      api.put(rep, '/api/targets/1/children', { children: [{ period: '2026-01', value: 1 }] }), api.post(rep, '/api/targets', { scope: 'daily', metric: 'x', unit: 'count', value: 1 }),
      api.put(rep, '/api/targets/1', { value: 1 }), api.del(rep, '/api/targets/1'),
    ];
    expect((await Promise.all(calls)).map((r) => r.status)).toEqual(Array(11).fill(403));
    const admin = pair.a.users.admin.token;
    expect((await api.get(admin, '/api/targets/tree?year=2026')).status).toBe(200);
    expect((await api.post(admin, '/api/targets/north-star', planBody())).status).toBe(403);
    expect((await api.post(admin, '/api/targets', { scope: 'daily', metric: 'calls_made', unit: 'count', value: 40, period: '2026-11-01' })).status).toBe(201);
    expect((await request(app).get('/api/targets/tree?year=2026')).status).toBe(401);
  });
});
