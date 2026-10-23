/**
 * M3-T20 (F-1050 to F-1052, F-1064): GET /api/reports/overview and /api/reports/sales on the numbers fixture, clock fixed
 * at 17 October 2026, 13:00. Fixture figures, the previous period, the same KPI on the Dashboard and on Reports, permissions,
 * error isolation per block, and the empty tenant.
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
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { clearDashboardCache, ownerDashboard } from '../../services/dashboardService';
import { overviewReport, previousDays, reportRange, salesReport } from '../../services/reportsService';
import * as outcomes from '../../services/kpi/outcomes';
import { rates } from '../../services/kpi/rates';
import { deliveredRevenue } from '../../services/kpi/revenue';
import { endOfDay, startOfDay } from '../../services/kpi/dates';

jest.setTimeout(300_000);

const FIXTURE_NOW = new Date('2026-10-17T13:00:00Z');
const RANGE = 'from=2026-10-01&to=2026-10-17';

let tenantId: string;
let adminToken: string;
let managerToken: string;
let repToken: string;
let agentToken: string;

const get = (token: string | null, path: string, query = RANGE) => {
  const r = request(app).get(`/api/reports/${path}?${query}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const setManagerPermissions = async (resources: Record<string, string[]>) => {
  await prismaBase.systemConfig.updateMany({ where: { tenantId }, data: { rolePermissions: { manager: resources } as any } });
  clearPermissionsCache();
};

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  const user = (role: string) => prismaBase.user.create({
    data: { email: `rep-${role}@fixture-numbers.test`, password: 'x', firstName: 'Rep', lastName: role, role: role as any, tenantId },
  });
  const [admin, manager, agent] = await Promise.all([
    prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'admin' } }),
    user('manager'),
    prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'delivery_agent' } }),
  ]);
  const rep = await prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'sales_rep' } });
  const token = (u: { id: number; email: string }, role: string) => generateAccessToken({ id: u.id, email: u.email, role: role as any, tenantId });
  adminToken = token(admin, 'admin');
  managerToken = token(manager, 'manager');
  repToken = token(rep, 'sales_rep');
  agentToken = token(agent, 'delivery_agent');
  if (!(await prismaBase.systemConfig.findFirst({ where: { tenantId } }))) await prismaBase.systemConfig.create({ data: { tenantId } });
  jest.useFakeTimers({
    now: FIXTURE_NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
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

describe('the previous period (F-1050)', () => {
  it('1-17 Oct compares with 1-17 Sep; a full month with the whole month before; other ranges with the equal period just before', () => {
    expect(previousDays('2026-10-01', '2026-10-17')).toEqual({ from: '2026-09-01', to: '2026-09-17' });
    expect(previousDays('2026-10-01', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousDays('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousDays('2026-03-01', '2026-03-30')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousDays('2026-01-01', '2026-01-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(previousDays('2026-10-11', '2026-10-17')).toEqual({ from: '2026-10-04', to: '2026-10-10' });
    expect(previousDays('2026-10-17', '2026-10-17')).toEqual({ from: '2026-10-16', to: '2026-10-16' });
  });
});

describe('overview on the fixture (F-1051)', () => {
  it('tiles: orders 1,445; confirmed 1,026 at 71% (target 70); delivered 376, success 48.3% (target 60); revenue 92,000', async () => {
    const res = await get(adminToken, 'overview');
    expect(res.status).toBe(200);
    const { tiles, range, compare } = res.body;
    expect(range).toEqual({ from: '2026-10-01', to: '2026-10-17', days: 17, timeZone: 'Africa/Accra' });
    expect(compare).toBeNull();
    expect(tiles.orders.value).toBe(1445);
    expect(tiles.confirmed).toMatchObject({ value: 1026, confirmationRate: { value: 71, target: 70, tag: 'on_track' } });
    expect(tiles.delivered).toMatchObject({ value: 376, dateBasis: 'deliveryDate' });
    expect(tiles.delivered.deliverySuccessRate).toMatchObject({ value: 48.3, target: 60, tag: 'off_track', basis: 'cohort', delivered: 376, closed: 778 });
    expect(tiles.deliveredRevenue).toMatchObject({ value: '92000.00', previous: null, deltaPercent: null });
    expect(tiles.orderToCashYield.value).toBeGreaterThanOrEqual(33);
    expect(tiles.orderToCashYield.value).toBeLessThanOrEqual(35);
  });

  it('has no tile or key called "delivery rate"', async () => {
    const text = JSON.stringify((await get(adminToken, 'overview')).body);
    expect(text).not.toMatch(/deliveryRate"/);
    expect(text).not.toMatch(/delivery rate/i);
  });

  it('"Where orders ended up": 376 delivered, 354 failed, 48 returned, 148 out, 100 waiting, 64 pending, 355 cancelled, sum 1,445', async () => {
    const { endedUp } = (await get(adminToken, 'overview')).body;
    const by = Object.fromEntries(endedUp.segments.map((s: any) => [s.key, s.count]));
    expect(by).toEqual({ delivered: 376, failed: 354, returned: 48, outForDelivery: 148, waitingToDispatch: 100, pendingCall: 64, cancelled: 355, other: 0 });
    expect(endedUp.segments.reduce((n: number, s: any) => n + s.count, 0)).toBe(1445);
    expect(endedUp.total).toBe(1445);
    expect(endedUp.deliverySuccessRate).toBe(48.3);
  });

  it('daily breakdown: one row per day (17), rows add up to the tiles', async () => {
    const { daily, tiles } = (await get(adminToken, 'overview')).body;
    expect(daily.rows).toHaveLength(17);
    expect(daily.rows[0].date).toBe('2026-10-01');
    expect(daily.rows[16].date).toBe('2026-10-17');
    const sum = (key: string) => daily.rows.reduce((n: number, r: any) => n + r[key], 0);
    expect(sum('orders')).toBe(tiles.orders.value);
    expect(sum('confirmed')).toBe(tiles.confirmed.value);
    expect(sum('delivered')).toBe(tiles.delivered.value);
    const revenue = daily.rows.reduce((n: number, r: any) => n + Number(r.revenue), 0);
    expect(revenue.toFixed(2)).toBe(tiles.deliveredRevenue.value);
    expect(daily.total).toMatchObject({ orders: 1445, confirmed: 1026, delivered: 376, revenue: '92000.00', previous: null });
    expect(daily.rows[16].orders).toBe(64);
  });

  it('compare=previous adds the previous period to the tiles and the daily rows, with the change', async () => {
    const res = await get(adminToken, 'overview', `${RANGE}&compare=previous`);
    expect(res.status).toBe(200);
    const { tiles, daily, compare } = res.body;
    expect(compare).toEqual({ from: '2026-09-01', to: '2026-09-17', days: 17 });
    const zone = 'Africa/Accra';
    const prevFrom = startOfDay('2026-09-01', zone);
    const prevTo = endOfDay('2026-09-17', zone);
    const [prevRates, prevRevenue] = await Promise.all([rates(tenantId, prevFrom, prevTo, { basis: 'cohort' }), deliveredRevenue(tenantId, prevFrom, prevTo)]);
    expect(tiles.orders.previous).toBe(prevRates.confirmationRate.detail!.placed);
    expect(tiles.deliveredRevenue.previous).toBe(prevRevenue.total.value);
    expect(tiles.deliveredRevenue.deltaPercent).toBe(Math.round(((92000 - Number(prevRevenue.total.value)) / Number(prevRevenue.total.value)) * 100));
    expect(daily.rows[0].previous.date).toBe('2026-09-01');
    expect(daily.rows[16].previous.date).toBe('2026-09-17');
    expect(daily.total.previous.revenue).toBe(prevRevenue.total.value);
  });

  it('a compare range with no data gives zero previous values and no change (the page says "no data")', async () => {
    const res = await get(adminToken, 'overview', 'from=2026-01-01&to=2026-01-02&compare=previous');
    expect(res.status).toBe(200);
    expect(res.body.compare).toEqual({ from: '2025-12-01', to: '2025-12-02', days: 2 });
    expect(res.body.tiles.orders.previous).toBe(0);
    expect(res.body.tiles.orders.deltaPercent).toBeNull();
  });
});

describe('the same KPI on the Dashboard and on Reports', () => {
  it('confirmation rate, delivery success rate, yield and the placed, confirmed, delivered and closed counts are equal for 1-17 October', async () => {
    const dash = (await ownerDashboard(tenantId, { range: 'month', asOf: '2026-10-17' })) as any;
    const { tiles } = (await get(adminToken, 'overview')).body;
    expect(tiles.confirmed.confirmationRate.value).toBe(dash.tiles.confirmationRate.value);
    expect(tiles.orders.value).toBe(dash.tiles.confirmationRate.placed);
    expect(tiles.confirmed.value).toBe(dash.tiles.confirmationRate.confirmed);
    expect(tiles.delivered.deliverySuccessRate.value).toBe(dash.tiles.deliverySuccessRate.value);
    expect(tiles.delivered.deliverySuccessRate.delivered).toBe(dash.tiles.deliverySuccessRate.delivered);
    expect(tiles.delivered.deliverySuccessRate.closed).toBe(dash.tiles.deliverySuccessRate.closed);
    expect(tiles.orderToCashYield.value).toBe(dash.tiles.deliverySuccessRate.yield);
    expect(tiles.confirmed.confirmationRate.target).toBe(dash.tiles.confirmationRate.target);
    expect(tiles.delivered.deliverySuccessRate.target).toBe(dash.tiles.deliverySuccessRate.target);
    expect(tiles.deliveredRevenue.value).toBe(dash.ladder.month.actual);
    // and Sales shows the same revenue and cash as the Dashboard
    const sales = (await get(adminToken, 'sales')).body;
    expect(sales.tiles.deliveredRevenue.value).toBe(dash.ladder.month.actual);
    expect(sales.tiles.cashWithPartners.value).toBe(dash.tiles.cash.value);
  });
});

describe('sales on the fixture (F-1052)', () => {
  it('tiles: revenue 92,000.00 from 376 orders, AOV 244.68, cash with partners 23,400.00, cash received 0.00 (no deposits yet)', async () => {
    const { tiles } = (await get(adminToken, 'sales')).body;
    expect(tiles.deliveredRevenue.value).toBe('92000.00');
    expect(tiles.deliveredOrders.value).toBe(376);
    expect(tiles.aov).toMatchObject({ value: '244.68', previous: null, deltaAmount: null });
    expect(tiles.thirtyDayAov.value).toMatch(/^\d+\.\d{2}$/);
    expect(tiles.cashWithPartners).toMatchObject({ value: '23400.00' });
    expect(tiles.cashReceived).toMatchObject({ value: '0.00', percentOfDeliveredRevenue: 0 });
  });

  it('the 30-day AOV is the delivered AOV of the 30 days that end with the range', async () => {
    const zone = 'Africa/Accra';
    const to = endOfDay('2026-10-17', zone);
    const revenue = await deliveredRevenue(tenantId, new Date(to.getTime() - 30 * 86_400_000), to);
    const expected = (Number(revenue.total.value) / revenue.deliveredOrders.value).toFixed(2);
    const { tiles } = (await get(adminToken, 'sales')).body;
    expect(tiles.thirtyDayAov.value).toBe(expected);
    expect(tiles.thirtyDayAov.deliveredOrders).toBe(revenue.deliveredOrders.value);
  });

  it('revenue per day adds up to the tile; compare lines each day up with the day of the previous period', async () => {
    const { revenuePerDay, tiles } = (await get(adminToken, 'sales', `${RANGE}&compare=previous`)).body;
    expect(revenuePerDay.rows).toHaveLength(17);
    const sum = revenuePerDay.rows.reduce((n: number, r: any) => n + Number(r.revenue), 0);
    expect(sum.toFixed(2)).toBe(tiles.deliveredRevenue.value);
    expect(revenuePerDay.rows[0].previous.date).toBe('2026-09-01');
    expect(tiles.cashReceived.previous).toBe('0.00');
    expect(tiles.aov.previous).toMatch(/^\d+\.\d{2}$/);
  });

  it('the state table is titled State and its rows and total equal the revenue and the 376 delivered orders', async () => {
    const { byState } = (await get(adminToken, 'sales')).body;
    expect(byState.label).toBe('State');
    expect(byState.total).toMatchObject({ delivered: 376, revenue: '92000.00', averageOrder: '244.68' });
    expect(byState.rows.reduce((n: number, r: any) => n + r.delivered, 0)).toBe(376);
    expect(byState.rows.reduce((n: number, r: any) => n + Number(r.revenue), 0).toFixed(2)).toBe('92000.00');
    expect(byState.rows.reduce((n: number, r: any) => n + r.sharePercent, 0)).toBeGreaterThan(99);
    const accra = byState.rows.find((r: any) => r.state === 'Greater Accra');
    expect(accra.averageOrder).toBe((Number(accra.revenue) / accra.delivered).toFixed(2));
  });

  it('revenue by product shows the delivered units of the product KPI (306 + 172 + 89 + 58 + 10 = 635)', async () => {
    const { byProduct } = (await get(adminToken, 'sales')).body;
    expect(byProduct.rows.reduce((n: number, r: any) => n + r.units, 0)).toBe(635);
    expect(byProduct.rows.find((r: any) => r.sku === 'MG-COPYBOOK-SET')).toMatchObject({ units: 306, revenue: '76194.00' });
  });
});

describe('permissions', () => {
  it('401 without a token; 403 for a sales rep and a delivery agent on every tab', async () => {
    for (const tab of ['overview', 'sales', 'delivery']) {
      expect((await get(null, tab)).status).toBe(401);
      expect((await get(repToken, tab)).status).toBe(403);
      expect((await get(agentToken, tab)).status).toBe(403);
    }
  });

  it('a manager with the default permissions opens all three tabs and sees the cash tiles', async () => {
    await setManagerPermissions({});
    for (const tab of ['overview', 'sales', 'delivery']) expect((await get(managerToken, tab)).status).toBe(200);
    expect((await get(managerToken, 'sales')).body.tiles.cashWithPartners.value).toBe('23400.00');
  });

  it('a manager without financial:view gets Sales without the cash tiles', async () => {
    await setManagerPermissions({ financial: [] });
    const res = await get(managerToken, 'sales');
    expect(res.status).toBe(200);
    expect(res.body.tiles).not.toHaveProperty('cashReceived');
    expect(res.body.tiles).not.toHaveProperty('cashWithPartners');
    expect(res.body.tiles.deliveredRevenue.value).toBe('92000.00');
    expect(JSON.stringify(res.body)).not.toContain('23400');
    await setManagerPermissions({});
  });

  it('a manager without analytics:view gets 403; Marketing needs marketing:view and Products needs financial:view', async () => {
    await setManagerPermissions({ analytics: [] });
    expect((await get(managerToken, 'overview')).status).toBe(403);
    await setManagerPermissions({ marketing: [], financial: [] });
    expect((await get(managerToken, 'marketing')).status).toBe(403);
    expect((await get(managerToken, 'products')).status).toBe(403);
    await setManagerPermissions({});
    expect((await get(managerToken, 'marketing')).status).toBe(404); // allowed, but the tab is not built yet (M8)
    await setManagerPermissions({});
  });
});

describe('query checks', () => {
  it('400 for a missing range, a range turned round, a bad compare value and a range over 366 days', async () => {
    expect((await get(adminToken, 'overview', '')).status).toBe(400);
    expect((await get(adminToken, 'overview', 'from=2026-10-17&to=2026-10-01')).status).toBe(400);
    expect((await get(adminToken, 'overview', `${RANGE}&compare=sideways`)).status).toBe(400);
    const wide = await get(adminToken, 'sales', 'from=2025-01-01&to=2026-10-17');
    expect(wide.status).toBe(400);
    expect(wide.body.error.message ?? wide.body.message ?? JSON.stringify(wide.body)).toMatch(/366/);
    expect((await get(adminToken, 'sales', 'from=2025-10-17&to=2026-10-16')).status).toBe(200); // exactly 365 days
  });
});

describe('error isolation per block', () => {
  it('a block that throws returns { error } without the raw message; the other blocks still answer', async () => {
    jest.spyOn(outcomes, 'ordersByStatus').mockRejectedValue(new Error('select * from orders failed: relation "orders"'));
    const res = await get(adminToken, 'overview');
    expect(res.status).toBe(200);
    expect(res.body.endedUp).toEqual({ error: { code: 'block_failed', errorId: expect.any(String) } });
    expect(JSON.stringify(res.body)).not.toContain('relation');
    expect(res.body.tiles.orders.value).toBe(1445);
    expect(res.body.daily.rows).toHaveLength(17);
  });
});

describe('a tenant with no orders', () => {
  let emptyId: string;
  beforeAll(async () => { emptyId = (await createTenant('Reports Empty')).id; });
  afterAll(async () => { await deleteTenantRows([emptyId]); });

  it('answers with zeros and nulls, never a division by zero, and sees no fixture data', async () => {
    const r = reportRange(emptyId, startOfDay('2026-10-01', 'Africa/Accra'), endOfDay('2026-10-17', 'Africa/Accra'), true);
    const overview = (await overviewReport(emptyId, r)) as any;
    expect(overview.tiles.orders).toEqual({ value: 0, previous: 0, deltaPercent: null });
    expect(overview.tiles.confirmed.confirmationRate.value).toBeNull();
    expect(overview.endedUp.total).toBe(0);
    expect(overview.endedUp.segments.every((s: any) => s.percent === null)).toBe(true);
    const sales = (await salesReport(emptyId, r)) as any;
    expect(sales.tiles.aov.value).toBeNull();
    expect(sales.byState.rows).toEqual([]);
    expect(JSON.stringify([overview, sales])).not.toContain('92000');
  });
});
