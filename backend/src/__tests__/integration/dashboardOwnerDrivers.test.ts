/**
 * M3-T10 (F-200, F-205, F-207, F-210): the chart, the drivers and the recent orders of GET /api/dashboard/owner, the
 * 30-second cache per tenant and range, the permission trimming for a manager, and the 1-second budget. Numbers fixture,
 * clock fixed at 17 October 2026, 13:00.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { clearPermissionsCache } from '../../middleware/auth';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { AppEvent, emitOrderEvent } from '../../utils/appEvents';
import * as leadershipModule from '../../services/kpi/leadership';
import * as cash from '../../services/kpi/cash';
import { CACHE_TTL_MS, clearDashboardCache, ownerDashboard, registerDashboardCacheListeners } from '../../services/dashboardService';

jest.setTimeout(300_000);

const FIXTURE_NOW = new Date('2026-10-17T13:00:00Z');
const BUDGET_MS = 1000;

let tenantId: string;
let adminToken: string;
let managerToken: string;

const dash = async (options: Parameters<typeof ownerDashboard>[1] = {}) => (await ownerDashboard(tenantId, options)) as any;
const setManagerPermissions = async (resources: Record<string, string[]>) => {
  await prismaBase.systemConfig.updateMany({ where: { tenantId }, data: { rolePermissions: { manager: resources } as any } });
  clearPermissionsCache();
};

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  const admin = await prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'admin' } });
  const manager = await prismaBase.user.create({
    data: { email: 'dash-manager@fixture-numbers.test', password: 'x', firstName: 'Dash', lastName: 'Manager', role: 'manager', tenantId },
  });
  adminToken = generateAccessToken({ id: admin.id, email: admin.email, role: 'admin', tenantId });
  managerToken = generateAccessToken({ id: manager.id, email: manager.email, role: 'manager', tenantId });
  const config = await prismaBase.systemConfig.findFirst({ where: { tenantId } });
  if (!config) await prismaBase.systemConfig.create({ data: { tenantId } });
  jest.useFakeTimers({
    now: FIXTURE_NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  registerDashboardCacheListeners();
});

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.systemConfig.updateMany({ where: { tenantId }, data: { rolePermissions: undefined } });
  clearPermissionsCache();
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

beforeEach(() => clearDashboardCache());

describe('drivers on the fixture (F-205)', () => {
  it('projected October is 167.8k, 93% of target at the rate so far (92,000 / 17 x 31)', async () => {
    const { projectedMonth } = (await dash()).drivers;
    expect(projectedMonth).toMatchObject({ value: '167764.71', percentOfTarget: 93.2, basis: 'todays_rate', tooEarly: false, daysGone: 17, daysInMonth: 31 });
  });

  it('needed a day is 6.3k for the last 14 days (88,000 / 14)', async () => {
    expect((await dash()).drivers.neededPerDay).toEqual({ value: '6285.71', daysLeft: 14 });
  });

  it('the biggest lever is delivery success, worth 21k to 24k (22.9k: 1,871 confirmed x 5 points x 245)', async () => {
    const { biggestLever } = (await dash()).drivers;
    expect(biggestLever).toMatchObject({ rate: 'deliverySuccessRate', points: 5 });
    expect(Number(biggestLever.value)).toBeGreaterThan(21_000);
    expect(Number(biggestLever.value)).toBeLessThan(24_000);
  });

  it('the drivers always read the month of asOf, whatever the range', async () => {
    expect((await dash({ range: 'last_7_days' })).drivers).toEqual((await dash({ range: 'month' })).drivers);
  });

  it('on day 2 of a month the projection is "too early"', async () => {
    expect((await dash({ asOf: '2026-10-02' })).drivers.projectedMonth.tooEarly).toBe(true);
  });
});

describe('chart (F-205)', () => {
  it('month: one point a day for all 31 days; the cumulative reaches 92,000 on the 17th; the days after are empty', async () => {
    const { chart } = await dash();
    expect(chart).toMatchObject({ period: 'month', target: '180000.00', from: '2026-10-01', to: '2026-10-17' });
    expect(chart.days).toHaveLength(31);
    expect(chart.days[16]).toMatchObject({ date: '2026-10-17', cumulative: '92000.00' });
    expect(chart.days[17]).toEqual({ date: '2026-10-18', delivered: null, cumulative: null, targetPace: '104516.13', vsPace: null });
    const delivered = chart.days.slice(0, 17).reduce((sum: number, d: any) => sum + Number(d.delivered), 0);
    expect(delivered).toBeCloseTo(92_000, 2);
  });

  it('the target pace is straight: day i of 31 is i / 31 of 180,000 and the last day is the target; "vs pace" on the 17th is -6.7k', async () => {
    const { days } = (await dash()).chart;
    expect(days[0].targetPace).toBe('5806.45');
    expect(days[16].targetPace).toBe('98709.68');
    expect(days[16].vsPace).toBe('-6709.68');
    expect(days[30].targetPace).toBe('180000.00');
  });

  it('a range that is not a calendar period has days to asOf and no pace line', async () => {
    const { chart } = await dash({ range: 'week' });
    expect(chart.days.map((d: any) => d.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
    expect(chart).toMatchObject({ period: null, target: null });
    expect(chart.days.every((d: any) => d.targetPace === null && d.vsPace === null)).toBe(true);
  });

  it('year: 365 days to the 31 December, the cumulative reaches 1,382,000 on the 17 October', async () => {
    const { chart } = await dash({ range: 'year' });
    expect(chart.days).toHaveLength(365);
    expect(chart.days.find((d: any) => d.date === '2026-10-17').cumulative).toBe('1382000.00');
    expect(chart.days[364].targetPace).toBe('1800000.00');
  });
});

describe('recent orders (F-207)', () => {
  it('the 4 newest orders of the range, newest first, with number, customer, city, status and amount', async () => {
    const rows = await prismaBase.order.findMany({
      where: { tenantId, deletedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 4,
      include: { customer: true },
    });
    const { recentOrders } = await dash();
    expect(recentOrders.map((o: any) => o.id)).toEqual(rows.map((o) => o.id));
    expect(recentOrders[0]).toMatchObject({
      externalOrderId: rows[0].externalOrderId, customerName: `${rows[0].customer.firstName} ${rows[0].customer.lastName}`,
      city: rows[0].deliveryArea, status: 'pending_confirmation', amount: '249.00', currency: 'GHS', notReachable: false,
    });
  });

  it('a pending order whose last call was not reachable carries the note', async () => {
    const [top] = (await dash()).recentOrders;
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: top.id } });
    const rep = await prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'sales_rep' } });
    await prismaBase.call.create({ data: { orderId: order.id, customerId: order.customerId, salesRepId: rep.id, outcome: 'not_reachable', tenantId } });
    try {
      clearDashboardCache();
      const rows = (await dash()).recentOrders;
      expect(rows[0]).toMatchObject({ id: top.id, status: 'pending_confirmation', notReachable: true });
      expect(rows.slice(1).every((o: any) => o.notReachable === false)).toBe(true);
    } finally {
      await prismaBase.call.deleteMany({ where: { orderId: order.id } });
    }
  });

  it('a soft-deleted order does not show', async () => {
    const [top] = (await dash()).recentOrders;
    await prismaBase.order.update({ where: { id: top.id }, data: { deletedAt: new Date() } });
    try {
      clearDashboardCache();
      expect((await dash()).recentOrders.map((o: any) => o.id)).not.toContain(top.id);
    } finally {
      await prismaBase.order.update({ where: { id: top.id }, data: { deletedAt: null } });
    }
  });

  it('the range limits the list: asOf 7 September with the range today lists only orders placed on that day', async () => {
    const { recentOrders } = await dash({ asOf: '2026-09-07', range: 'today' });
    expect(recentOrders.length).toBeGreaterThan(0);
    expect(recentOrders.every((o: any) => o.createdAt.startsWith('2026-09-07'))).toBe(true);
  });
});

describe('cache: 30 seconds per tenant, range and day (F-200)', () => {
  it('the second call inside 30 seconds reads the cache; after 30 seconds it computes again', async () => {
    const spy = jest.spyOn(leadershipModule, 'leadership');
    await dash();
    await dash();
    expect(spy).toHaveBeenCalledTimes(1);
    await dash({ range: 'week' }); // another range is its own entry
    expect(spy).toHaveBeenCalledTimes(2);

    jest.setSystemTime(new Date(FIXTURE_NOW.getTime() + CACHE_TTL_MS + 1));
    try {
      await dash();
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      jest.setSystemTime(FIXTURE_NOW);
    }
  });

  it('an order:status_changed event of the tenant drops its entries; an event of another tenant does not', async () => {
    const spy = jest.spyOn(leadershipModule, 'leadership');
    await dash();
    emitOrderEvent(AppEvent.ORDER_STATUS_CHANGED, {
      orderId: 1, tenantId: 'some-other-tenant', from: 'confirmed', to: 'delivered', actor: { kind: 'system' }, depth: 0,
    } as any);
    await dash();
    expect(spy).toHaveBeenCalledTimes(1);

    emitOrderEvent(AppEvent.ORDER_STATUS_CHANGED, {
      orderId: 1, tenantId, from: 'confirmed', to: 'delivered', actor: { kind: 'system' }, depth: 0,
    } as any);
    await dash();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a response with a failed block is not cached', async () => {
    jest.spyOn(cash, 'cashHeldByPartners').mockRejectedValueOnce(new Error('once'));
    expect((await dash()).tiles).toEqual({ error: { code: 'block_failed', errorId: expect.any(String) } });
    expect((await dash()).tiles.cash.value).toBe('23400.00');
  });
});

describe('permission trimming for a manager (F-210)', () => {
  const get = (token: string) => request(app).get('/api/dashboard/owner?asOf=2026-10-17').set('Authorization', `Bearer ${token}`);

  it('a manager with the default permissions (financial:view) sees the cash tile and the recent orders', async () => {
    await setManagerPermissions({});
    const res = await get(managerToken);
    expect(res.status).toBe(200);
    expect(res.body.tiles.cash.value).toBe('23400.00');
    expect(res.body.recentOrders).toHaveLength(4);
  });

  it('a manager without financial:view gets no cash tile; the other tiles and blocks stay', async () => {
    await setManagerPermissions({ financial: [] });
    // the owner asks first, so the cache holds the whole body; the manager still must not get the cash tile from it
    expect((await get(adminToken)).body.tiles.cash.value).toBe('23400.00');
    const res = await get(managerToken);
    expect(res.status).toBe(200);
    expect(res.body.tiles).not.toHaveProperty('cash');
    expect(Object.keys(res.body.tiles)).toEqual(expect.arrayContaining(['ordersToday', 'confirmationRate', 'deliverySuccessRate']));
    expect(JSON.stringify(res.body)).not.toContain('23400');
    expect(res.body.ladder.year.percent).toBe(76.8);
    expect((await get(adminToken)).body.tiles.cash.value).toBe('23400.00'); // the cache entry is whole
  });

  it('a manager without orders:view gets no recent orders', async () => {
    await setManagerPermissions({ orders: [] });
    const res = await get(managerToken);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('recentOrders');
    expect(res.body.tiles.cash.value).toBe('23400.00');
  });

  it('a manager without analytics:view gets 403', async () => {
    await setManagerPermissions({ analytics: [] });
    expect((await get(managerToken)).status).toBe(403);
    await setManagerPermissions({});
  });
});

describe('response time on the fixture (budget 1 s)', () => {
  const milliseconds = async (run: () => Promise<unknown>) => {
    const start = performance.now();
    await run();
    return Math.round(performance.now() - start);
  };

  it(`computes every block in under ${BUDGET_MS} ms, cold, and over HTTP`, async () => {
    await setManagerPermissions({});
    await dash(); // warm the connection pool and the currency cache
    clearDashboardCache();
    const cold = await milliseconds(() => dash());
    const cached = await milliseconds(() => dash());
    clearDashboardCache();
    const http = await milliseconds(async () => {
      const res = await request(app).get('/api/dashboard/owner?asOf=2026-10-17').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });
    // eslint-disable-next-line no-console
    console.log(`[dashboard timing] service cold ${cold} ms, service cached ${cached} ms, HTTP cold ${http} ms (budget ${BUDGET_MS} ms)`);
    expect(cold).toBeLessThan(BUDGET_MS);
    expect(http).toBeLessThan(BUDGET_MS);
    expect(cached).toBeLessThan(50);
  });
});
