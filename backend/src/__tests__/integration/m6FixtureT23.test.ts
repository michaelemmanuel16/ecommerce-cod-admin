/**
 * M6-T23 (COD-59): the gaps the M6 fixture tests left, at service level on the real test DB. The clock is fixed at 17 October 2026.
 *  - a 30-day month: 180,000 / 249 = 723, / (0.70 x 0.60) = 1,721, / 30 = 58 (a 31-day month gives 56, in m6NorthStar)
 *  - year pace on the quarter plan with real orders: done 76.7%, pace 75.5%, chip "1 pt ahead"
 *  - leaderboard side of the contract with the dashboard "Top this month": the top 3 by percent of the role target.
 *    The dashboard half (M6-T24, now that T12 is merged): "Top this month" on the owner dashboard and the Leaderboard give the
 *    same userIds and percents for the same month.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { world } from './helpers/leaderboardWorld';
import * as northStar from '../../services/northStarService';
import { leadership } from '../../services/kpi/leadership';
import { paceChip } from '../../services/kpi/status';
import { leaderboard } from '../../services/leaderboardService';
import { clearDashboardCache, ownerDashboard } from '../../services/dashboardService';

jest.setTimeout(120_000);

let pair: TwoTenants;
const A = () => pair.a.id;
const inA = <T>(fn: () => Promise<T>) => runInTenant(A(), fn);
const OCT = { start: new Date('2026-10-01'), end: new Date('2026-10-31') };

beforeAll(async () => {
  jest.useFakeTimers({
    now: new Date('2026-10-17T12:00:00Z'),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  pair = await createTwoTenants('m6t23');
}, 90_000);

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.target.deleteMany({ where: { tenantId: A() } });
  await prismaBase.roleAssignment.deleteMany({ where: { tenantId: A() } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('the plan, the calculators and the year pace', () => {
  it('1.8M on grow gives 360/420/480/540k; a 30-day month (November) gives 58 orders a day', async () => {
    const tree = await inA(() => northStar.saveNorthStar({ year: 2026, annual: 1_800_000, mode: 'grow', plannedAov: 249 }));
    expect(tree.quarters.map((q) => q.value)).toEqual(['360000.00', '420000.00', '480000.00', '540000.00']);
    const nov = await inA(() => northStar.calculators({ month: '2026-11', aov: 249, confirmationRate: 70, deliverySuccessRate: 60 }));
    expect(nov).toMatchObject({ revenueTarget: '180000.00', daysInMonth: 30, ordersDelivered: 723, ordersToTakeIn: 1721, ordersPerDay: 58 });
  });

  it('17 Oct: pace 75.5% (1,359,783), done 76.7% reads "1 pt ahead"', async () => {
    // 76.7% of 1,800,000 = 1,380,600 delivered this year
    await prismaBase.order.update({
      where: { id: pair.a.ids.order },
      data: { status: 'delivered', deliveryDate: new Date('2026-10-10T10:00:00Z'), totalAmount: 1_380_600, subtotal: 1_380_600, codAmount: 1_380_600 },
    });
    const l = await leadership(A(), '2026-10-17');
    expect(l.attainment.year).toMatchObject({ value: 76.7, pace: 75.5, paceBasis: 'quarter_plan', actual: '1380600.00', target: '1800000.00' });
    expect(paceChip(l.attainment.year.value, l.attainment.year.pace)).toEqual({ points: 1, tag: 'ahead' });
  });
});

describe('leaderboard side of the "Top this month" contract', () => {
  it('the top 3 of October are the three highest percents of the role target, in order', async () => {
    const role = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: A(), name: 'Call rep' } })).id;
    const customer = (await prismaBase.order.findFirstOrThrow({ where: { tenantId: A() } })).customerId;
    const w = world(A(), () => customer, () => role, () => role);
    const reps: Array<[string, number]> = [['ama', 9], ['kojo', 7], ['yaw', 5], ['efua', 2]];
    for (const [label, done] of reps) {
      const u = await w.user(label, 'sales_rep', 'person', role);
      await w.target(u.id, role, OCT, 'confirmed_delivered', 10);
      await w.repDelivered(u.id, done, '2026-10-12T10:00:00Z');
    }
    const owner = { id: pair.a.users.admin.id, role: 'super_admin' } as never;
    const board = await inA(() => leaderboard(owner, { role: 'call_rep', period: '2026-10' }));
    const top3 = board.rows.slice(0, 3).map((r: Record<string, any>) => ({ rank: r.rank, percent: r.percent }));
    expect(top3).toEqual([{ rank: 1, percent: 90 }, { rank: 2, percent: 70 }, { rank: 3, percent: 50 }]);
  });
});

describe('dashboard half of the "Top this month" contract (M6-T24)', () => {
  it('the dashboard block and the two Leaderboard boards give the same userIds, ranks order and percents for October', async () => {
    const callRepRole = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: A(), name: 'Call rep' } })).id;
    const deliveryRole = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: A(), name: 'Delivery' } })).id;
    const customer = (await prismaBase.order.findFirstOrThrow({ where: { tenantId: A() } })).customerId;
    const w = world(A(), () => customer, () => callRepRole, () => deliveryRole);
    // a Delivery partner joins the call reps of the test above: 12 of 20 closed = 60% against a 70% target = 85.7% of target
    const partner = await w.user('kwabena', 'delivery_agent', 'person', deliveryRole);
    await w.target(partner.id, deliveryRole, OCT, 'delivery_success_rate', 70);
    await w.closed(partner.id, 12, 'delivered', '2026-10-14T10:00:00Z');
    await w.closed(partner.id, 8, 'returned', '2026-10-14T10:00:00Z');

    clearDashboardCache();
    const dash: any = await ownerDashboard(A(), { asOf: '2026-10-17' });
    expect(dash.topThisMonth.month).toBe('2026-10');

    const owner = { id: pair.a.users.admin.id, role: 'super_admin' } as never;
    const boards = await Promise.all((['call_rep', 'delivery'] as const).map((role) => inA(() => leaderboard(owner, { role, period: '2026-10' }))));
    const fromBoards = boards
      .flatMap((b) => b.rows as Array<Record<string, any>>)
      .filter((r) => r.ranked && r.percent !== null)
      .sort((x, y) => y.percent - x.percent)
      .slice(0, 3)
      .map((r) => ({ userId: r.userId, percent: r.percent }));
    const fromDashboard = dash.topThisMonth.people.map((p: Record<string, any>) => ({ userId: p.userId, percent: p.percent }));

    expect(fromDashboard).toHaveLength(3);
    expect(fromDashboard).toEqual(fromBoards);
    expect(dash.topThisMonth.people.map((p: Record<string, any>) => p.rank)).toEqual([1, 2, 3]);
    // the partner (85.7%) sits between kojo (70) and ama (90): ama, partner, kojo
    expect(fromDashboard.map((p: { percent: number }) => p.percent)).toEqual([90, 85.7, 70]);
    expect(fromDashboard[1].userId).toBe(partner.id);
  });
});
