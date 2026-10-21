/**
 * M3-T09 (F-200 to F-204): GET /api/dashboard/owner, blocks header, ladder, quests and tiles, on the numbers fixture with
 * the clock fixed at 17 October 2026, 13:00 (as toolOutputs.test.ts). Also the Target seed script, the empty tenant,
 * error isolation per block and the HTTP guards.
 *
 * Fixture numbers that differ from the plan text (M3.md, F-202, F-203; reasons in the COD-22 report):
 *   - North Star progress is 76.8 (1,382,000 / 1,800,000 = 76.78, half up), the plan writes 76.7. The chip still reads 3 pts behind.
 *   - Today the fixture delivers GH 4,950 in 19 orders, not the mockup's 4,200 in 17, so the sub-line needs GH 1,300 more, not 2,100.
 *   - The New orders quest was hit on 16 of 17 days (mockup: 14), 84 orders on Friday 10 October (mockup: +18%, here -24%), no failed-delivery call today (mockup: 6).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { deliveredRevenue } from '../../services/kpi/revenue';
import { endOfDay, startOfDay } from '../../services/kpi/dates';
import * as cash from '../../services/kpi/cash';
import { clearDashboardCache, ownerDashboard } from '../../services/dashboardService';
import { seedTargets, targetTree } from '../../../scripts/seed-targets';

jest.setTimeout(300_000);

const FIXTURE_NOW = new Date('2026-10-17T13:00:00Z');

let tenantId: string;
let adminToken: string;
let repToken: string;

/** The blocks are typed loosely (they are JSON); the tests read them by path. */
const dash = async (options: Parameters<typeof ownerDashboard>[1] = {}) => (await ownerDashboard(tenantId, options)) as any;

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  const [admin, rep] = await Promise.all([
    prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'admin' } }),
    prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'sales_rep' } }),
  ]);
  adminToken = generateAccessToken({ id: admin.id, email: admin.email, role: 'admin', tenantId });
  repToken = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId });
  jest.useFakeTimers({
    now: FIXTURE_NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
});

afterAll(async () => {
  jest.useRealTimers();
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

beforeEach(() => clearDashboardCache());

describe('ladder on the fixture, 17 October (F-202)', () => {
  it('North Star 1.38M of 1.8M: 76.8 percent, pace 79.5, "3 pts behind", tag behind', async () => {
    const { year } = (await dash()).ladder;
    expect(year).toMatchObject({ actual: '1382000.00', target: '1800000.00', percent: 76.8, pace: 79.5, daysLeft: 75, tag: 'behind' });
    expect(year.paceChip).toEqual({ points: 3, tag: 'behind' });
  });

  it('quarter 92k of 540k with 75 days left is behind; month 92k of 180k with 14 days left is off track', async () => {
    const { quarter, month } = (await dash()).ladder;
    expect(quarter).toMatchObject({ actual: '92000.00', target: '540000.00', percent: 17, pace: 18.5, daysLeft: 75, tag: 'behind' });
    expect(month).toMatchObject({ actual: '92000.00', target: '180000.00', percent: 51.1, pace: 54.8, daysLeft: 14, tag: 'off_track' });
  });

  it("today's target is 6,285.71 (88,000 over 14 days) and today's delivered revenue and count come from the revenue KPI", async () => {
    const { day } = (await dash()).ladder;
    const today = await deliveredRevenue(tenantId, startOfDay('2026-10-17', 'Africa/Accra'), endOfDay('2026-10-17', 'Africa/Accra'));
    expect(day.target).toBe('6285.71');
    expect(day.actual).toBe(today.total.value);
    expect(day.deliveredOrders).toBe(today.deliveredOrders.value);
    expect(day.tag).toBe('in_progress');
  });

  it('has no margin chip and no deliveryRate key anywhere (margin comes with M5)', async () => {
    const text = JSON.stringify(await dash());
    expect(text).not.toMatch(/margin/i);
    expect(text).not.toContain('deliveryRate');
  });
});

describe('header (F-201)', () => {
  it('greets by the store-zone hour and states what today still needs, exact and rounded to 100', async () => {
    const { header, ladder } = await dash();
    expect(header).toMatchObject({ asOfDate: '2026-10-17', timeZone: 'Africa/Accra', greeting: 'afternoon', currency: 'GHS', targetMet: false });
    const remaining = Number(ladder.day.target) - Number(ladder.day.actual);
    expect(Number(header.remainingToday)).toBeCloseTo(remaining, 2);
    expect(header.remainingTodayRounded).toBe(`${Math.round(remaining / 100) * 100}.00`);
  });
});

describe('tiles on the fixture (F-204)', () => {
  it('confirmation 71% (1,026 of 1,445) is on track; delivery success 48.3% (376 of 778) is off track, 11.7 points under 60', async () => {
    const { confirmationRate, deliverySuccessRate } = (await dash()).tiles;
    expect(confirmationRate).toMatchObject({ value: 71, target: 70, tag: 'on_track', confirmed: 1026, placed: 1445 });
    expect(deliverySuccessRate).toMatchObject({ value: 48.3, target: 60, gapPoints: -11.7, tag: 'off_track', basis: 'cohort', delivered: 376, closed: 778 });
    expect(deliverySuccessRate.yield).toBeGreaterThanOrEqual(33);
    expect(deliverySuccessRate.yield).toBeLessThanOrEqual(35);
  });

  it('orders today 64 against a target of 56, with the same weekday last week', async () => {
    const { ordersToday } = (await dash()).tiles;
    expect(ordersToday).toMatchObject({ value: 64, target: 56 });
    expect(ordersToday.vsLastWeek).toMatchObject({ date: '2026-10-10', count: 84, deltaPercent: -24, trend: 'down' });
  });

  it('cash still with partners is 23,400.00 (cash.heldByPartners)', async () => {
    const { cash: tile } = (await dash()).tiles;
    expect(tile.value).toBe('23400.00');
    const kpi = await cash.cashHeldByPartners(tenantId);
    expect(kpi).toMatchObject({ value: '23400.00', unit: 'money', formulaId: 'cash.heldByPartners.v1' });
  });

  it('cash tile counts the orders behind the cash that were delivered more than 8 days ago (overdueOrders)', async () => {
    const { cash: tile } = (await dash()).tiles;
    const expected = await prismaBase.order.count({
      where: { tenantId, deletedAt: null, status: 'delivered', paymentStatus: 'collected', deliveryDate: { lt: new Date(FIXTURE_NOW.getTime() - 8 * 86_400_000) } },
    });
    expect(tile.overdueOrders).toBe(expected);
    expect(expected).toBeGreaterThan(0);
    expect(tile.overdueOrders).toBe((await cash.cashHeldByPartners(tenantId)).detail?.overdueOrders);
  });

  it('the rates follow the range: today covers 17 October only', async () => {
    const { tiles } = await dash({ range: 'today' });
    expect(tiles.range).toEqual({ from: '2026-10-17', to: '2026-10-17' });
    expect(tiles.confirmationRate.placed).toBe(64); // all 64 orders of the 17th are pending
    expect(tiles.confirmationRate.confirmed).toBe(0);
    expect(tiles.ordersToday.value).toBe(64); // orders today does not depend on the range
  });
});

describe('quests (F-203)', () => {
  it('New orders 64 of 56 is hit; the day count is the days the quest was hit, of the 17 days gone', async () => {
    const { quests } = await dash();
    expect(quests.items[0]).toMatchObject({ key: 'new_orders', value: 64, target: 56, tag: 'hit', tone: 'ok' });
    expect(quests.onTargetDays).toMatchObject({ of: 17, quest: 'new_orders' });
    expect(quests.onTargetDays.hit).toBeGreaterThan(0);
    expect(quests.onTargetDays.hit).toBeLessThanOrEqual(17);
  });

  it('Delivered revenue has the same target as the ladder; its tone follows the 50 and 100 percent bands', async () => {
    const { quests, ladder } = await dash();
    expect(quests.items[1]).toMatchObject({ key: 'delivered_revenue', target: ladder.day.target, value: ladder.day.actual, percent: ladder.day.percent, tone: 'warn', tag: 'open' });
  });

  it('Failed delivery calls: target 15 by default; a Target row sets it; two calls on one order count once (distinct orders)', async () => {
    const reps = await prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'sales_rep' } });
    const failed = await prismaBase.order.findMany({ where: { tenantId, status: 'failed_delivery' }, take: 2, select: { id: true, customerId: true } });
    const at = new Date('2026-10-17T10:00:00Z');
    await prismaBase.call.createMany({
      data: [failed[0], failed[0], failed[1]].map((o) => ({ orderId: o.id, customerId: o.customerId, salesRepId: reps.id, outcome: 'no_answer' as const, createdAt: at, tenantId })),
    });
    const target = await prismaBase.target.create({
      data: { tenantId, scope: 'daily', metric: 'failed_delivery_calls_per_day', unit: 'count', periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-12-31'), value: 4 },
    });
    try {
      expect((await dash()).quests.items[2]).toMatchObject({ key: 'failed_delivery_calls', value: 2, target: 4, targetSource: 'target', percent: 50, tone: 'warn' });
      await prismaBase.target.delete({ where: { id: target.id } });
      clearDashboardCache();
      expect((await dash()).quests.items[2]).toMatchObject({ value: 2, target: 15, targetSource: 'default', tone: 'bad' });
    } finally {
      await prismaBase.target.deleteMany({ where: { id: target.id } });
      await prismaBase.call.deleteMany({ where: { tenantId, createdAt: at } });
    }
  });
});

describe('error isolation per block', () => {
  it('a block that throws returns { error } and the others still answer', async () => {
    jest.spyOn(cash, 'cashHeldByPartners').mockRejectedValue(new Error('select * from agent_balances failed'));
    const body = await dash();
    expect(body.tiles).toEqual({ error: { code: 'block_failed', errorId: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain('agent_balances');
    expect(body.header.asOfDate).toBe('2026-10-17');
    expect(body.ladder.year.percent).toBe(76.8);
    expect(body.quests.items).toHaveLength(3);
    expect(body.drivers.projectedMonth.value).toBeDefined();
    expect(body.chart.days.length).toBeGreaterThan(0);
  });
});

describe('HTTP guards', () => {
  const get = (token: string | null, query = 'range=month&asOf=2026-10-17') => {
    const r = request(app).get(`/api/dashboard/owner?${query}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('401 without a token, 403 for a sales rep', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get(repToken)).status).toBe(403);
  });

  it('400 for an unknown range and for a day that does not exist', async () => {
    expect((await get(adminToken, 'range=decade')).status).toBe(400);
    expect((await get(adminToken, 'asOf=2026-02-30')).status).toBe(400);
    expect((await get(adminToken, 'asOf=17-10-2026')).status).toBe(400);
  });

  it('an admin gets every block of M3-T09 for the fixture', async () => {
    const res = await get(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.ladder.year.percent).toBe(76.8);
    expect(res.body.tiles.cash.value).toBe('23400.00');
    expect(res.body.quests.items.map((q: any) => q.key)).toEqual(['new_orders', 'delivered_revenue', 'failed_delivery_calls']);
  });

  it('a day in the future is moved back to today', async () => {
    const res = await get(adminToken, 'asOf=2026-12-31');
    expect(res.status).toBe(200);
    expect(res.body.header.asOfDate).toBe('2026-10-17');
  });
});

describe('a tenant with no orders and no targets', () => {
  let emptyId: string;
  beforeAll(async () => { emptyId = (await createTenant('Dash Empty')).id; });
  afterAll(async () => { await deleteTenantRows([emptyId]); });

  it('answers with zeros, null rates and no_target tags, never a division by zero, and sees no fixture data', async () => {
    const body = (await ownerDashboard(emptyId, { asOf: '2026-10-17' })) as any;
    expect(body.ladder.year).toMatchObject({ actual: '0.00', target: null, percent: null, tag: 'no_target', paceChip: null });
    expect(body.ladder.day).toMatchObject({ target: null, tag: 'no_target' });
    expect(body.header).toMatchObject({ remainingToday: null, targetMet: false });
    expect(body.tiles.confirmationRate).toMatchObject({ value: null, tag: 'no_data' });
    expect(body.tiles.deliverySuccessRate).toMatchObject({ value: null, tag: 'no_data' });
    expect(body.tiles.ordersToday.vsLastWeek.deltaPercent).toBeNull();
    expect(body.tiles.cash.value).toBe('0.00');
    expect(body.quests.onTargetDays).toBeNull();
    expect(JSON.stringify(body)).not.toContain('1382000');
  });
});

describe('scripts/seed-targets.ts', () => {
  let seedTenant: string;
  beforeAll(async () => { seedTenant = (await createTenant('Dash Seed')).id; });
  afterAll(async () => {
    await prismaBase.target.deleteMany({ where: { tenantId: seedTenant, parentId: { not: null } } });
    await deleteTenantRows([seedTenant]);
  });

  it('a dry run writes nothing; the first run creates the tree; the second run changes nothing', async () => {
    const rows = targetTree(2026).length;
    expect(await seedTargets(prismaBase as any, seedTenant, 2026, true)).toEqual({ created: rows, updated: 0, unchanged: 0 });
    expect(await prismaBase.target.count({ where: { tenantId: seedTenant } })).toBe(0);

    expect(await seedTargets(prismaBase as any, seedTenant, 2026)).toEqual({ created: rows, updated: 0, unchanged: 0 });
    expect(await seedTargets(prismaBase as any, seedTenant, 2026)).toEqual({ created: 0, updated: 0, unchanged: rows });
    expect(await prismaBase.target.count({ where: { tenantId: seedTenant } })).toBe(rows);
  });

  it('writes 1.8M for 2026, the four quarters, October to December at 180,000 and the two rate targets, linked to their parents', async () => {
    const t = await prismaBase.target.findMany({ where: { tenantId: seedTenant }, include: { parent: true } });
    const one = (scope: string, month?: number) =>
      t.find((x) => x.scope === scope && x.metric === 'revenue' && (month === undefined || x.periodStart.getUTCMonth() + 1 === month))!;
    expect(Number(one('north_star').value)).toBe(1_800_000);
    expect(t.filter((x) => x.scope === 'quarter').map((x) => Number(x.value)).sort()).toEqual([360_000, 420_000, 480_000, 540_000]);
    expect([10, 11, 12].map((m) => Number(one('month', m).value))).toEqual([180_000, 180_000, 180_000]);
    expect(t.filter((x) => x.scope === 'month')).toHaveLength(3);
    expect(one('month', 10).parent?.scope).toBe('quarter');
    expect(one('quarter', 10).parent?.scope).toBe('north_star');
    expect(t.filter((x) => x.metric.endsWith('_rate')).map((x) => [x.metric, Number(x.value)]).sort()).toEqual([['confirmation_rate', 70], ['delivery_success_rate', 60]]);
  });

  it('a changed value is put back, and the row keeps its id', async () => {
    const october = await prismaBase.target.findFirstOrThrow({ where: { tenantId: seedTenant, scope: 'month', periodStart: new Date('2026-10-01') } });
    await prismaBase.target.update({ where: { id: october.id }, data: { value: 99 } });
    expect(await seedTargets(prismaBase as any, seedTenant, 2026)).toMatchObject({ created: 0, updated: 1 });
    const again = await prismaBase.target.findUniqueOrThrow({ where: { id: october.id } });
    expect(Number(again.value)).toBe(180_000);
  });
});
