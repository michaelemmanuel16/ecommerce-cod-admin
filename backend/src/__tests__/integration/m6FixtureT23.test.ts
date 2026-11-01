/**
 * M6-T23 (COD-59): the gaps the M6 fixture tests left, at service level on the real test DB. The clock is fixed at 17 October 2026.
 *  - a 30-day month: 180,000 / 249 = 723, / (0.70 x 0.60) = 1,721, / 30 = 58 (a 31-day month gives 56, in m6NorthStar)
 *  - year pace on the quarter plan with real orders: done 76.7%, pace 75.5%, chip "1 pt ahead"
 *  - leaderboard side of the contract with the dashboard "Top this month": the top 3 by percent of the role target.
 *    The dashboard half is added after T12 is merged (the `top` block is not in dashboardService on this base).
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
