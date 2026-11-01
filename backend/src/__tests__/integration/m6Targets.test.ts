/**
 * M6-T07 (COD-57, F-1100, F-1103): target service. Hierarchy and sum checks, one write path with row locks, closed month lock,
 * role pool on unassign (same transaction, history kept, audit, notice), "Set a target", daily activity targets, year pace,
 * two tenants. The clock is fixed at 17 October 2026.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import * as targets from '../../services/targetService';
import { unassign } from '../../services/roleAssignmentService';
import { leadership } from '../../services/kpi/leadership';
import { FAILED_CALLS_METRIC } from '../../services/kpi/daily';

jest.setTimeout(90_000);

let pair: TwoTenants;
const A = () => pair.a.id;
const inA = <T>(fn: () => Promise<T>) => runInTenant(A(), fn);
const rejects = async (p: Promise<unknown>, status: number, text: RegExp) => {
  await expect(p).rejects.toMatchObject({ statusCode: status, message: expect.stringMatching(text) });
};
const ORDERS = 'delivered_orders';
const orders = (extra: object) => ({ metric: ORDERS, unit: 'count', ...extra }) as const;
const monthOf = (period: string, metric = 'revenue') =>
  prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'month', metric, periodStart: new Date(`${period}-01`) } });

let northStar: { id: number };
let roleId: number;
let otherRoleId: number;
let anna: number;
let ben: number;
let actor: number;

beforeAll(async () => {
  jest.useFakeTimers({
    now: new Date('2026-10-17T12:00:00Z'),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  pair = await createTwoTenants('m6targets');
  actor = pair.a.users.admin.id;
  roleId = (await prismaBase.role.create({ data: { tenantId: A(), name: 'Call rep T07', area: 'Sales' } })).id;
  otherRoleId = (await prismaBase.role.create({ data: { tenantId: A(), name: 'Delivery T07', area: 'Ops' } })).id;
  const mk = (n: string) => prismaBase.user.create({ data: { email: `${n}-m6targets@codadmin.test`, password: 'x', firstName: n, lastName: 'T', role: 'sales_rep', tenantId: A() } });
  anna = (await mk('Anna')).id;
  ben = (await mk('Ben')).id;
  for (const holderId of [anna, ben]) await prismaBase.roleAssignment.create({ data: { tenantId: A(), roleId, holderId, fromDate: new Date('2026-01-01') } });
  northStar = await inA(() => targets.saveTarget({ scope: 'north_star', metric: 'revenue', unit: 'currency', value: 1_800_000, period: '2026' }));
});

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.target.deleteMany({ where: { tenantId: A() } });
  await prismaBase.roleAssignment.deleteMany({ where: { roleId: { in: [roleId, otherRoleId] } } });
  await prismaBase.notification.deleteMany({ where: { tenantId: A(), type: 'target_returned' } });
  await prismaBase.auditLog.deleteMany({ where: { tenantId: A(), action: 'target_release' } });
  await prismaBase.role.deleteMany({ where: { id: { in: [roleId, otherRoleId] } } });
  await prismaBase.user.deleteMany({ where: { id: { in: [anna, ben] } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('hierarchy and sum checks', () => {
  it('quarters that do not add up to the North Star are rejected with the difference', async () => {
    await rejects(inA(() => targets.setChildren(northStar.id, [
      { period: '2026-Q1', value: 360_000 }, { period: '2026-Q2', value: 420_000 }, { period: '2026-Q3', value: 480_000 }, { period: '2026-Q4', value: 500_000 },
    ])), 400, /Difference: 40000\.00/);
    expect(await prismaBase.target.count({ where: { tenantId: A(), scope: 'quarter' } })).toBe(0);
  });

  it('quarters that add up are saved, with the North Star as parent', async () => {
    const saved = await inA(() => targets.setChildren(northStar.id, [
      { period: '2026-Q1', value: 360_000 }, { period: '2026-Q2', value: 420_000 }, { period: '2026-Q3', value: 480_000 }, { period: '2026-Q4', value: 540_000 },
    ]));
    expect(saved).toHaveLength(4);
    expect(saved.every((q) => q.parentId === northStar.id && q.scope === 'quarter')).toBe(true);
  });

  it('months of a quarter must add up to it', async () => {
    const q4 = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'quarter', periodStart: new Date('2026-10-01') } });
    await rejects(inA(() => targets.setChildren(q4.id, [
      { period: '2026-10', value: 180_000 }, { period: '2026-11', value: 180_000 }, { period: '2026-12', value: 100_000 },
    ])), 400, /short by 80000\.00.*Difference: 80000\.00/);
    await inA(() => targets.setChildren(q4.id, [
      { period: '2026-10', value: 180_000 }, { period: '2026-11', value: 180_000 }, { period: '2026-12', value: 180_000 },
    ]));
  });

  it('a quarter or month cannot be saved alone; a parent value cannot move away from its children', async () => {
    await rejects(inA(() => targets.saveTarget({ scope: 'month', metric: 'revenue', unit: 'currency', value: 200_000, period: '2026-10' })), 400, /setChildren/);
    await rejects(inA(() => targets.saveTarget({ scope: 'north_star', metric: 'revenue', unit: 'currency', value: 2_000_000, period: '2026' })), 400, /Difference: 200000\.00/);
    await rejects(inA(() => targets.deleteTarget(northStar.id)), 409, /Remove the targets under it/);
  });

  it('a role target needs a revenue month to sit under (no orphans)', async () => {
    await rejects(inA(() => targets.saveTarget({ scope: 'role', ...orders({ value: 5, period: '2027-01', roleId }) })), 400, /needs a month target/);
  });

  it('a count or a rate role target saves under the revenue month; a revenue sum ignores them', async () => {
    const count = await inA(() => targets.saveTarget({ scope: 'role', ...orders({ value: 723, period: '2026-10', roleId }) }));
    const oct = await monthOf('2026-10');
    expect(count.parentId).toBe(oct.id);
    const rate = await inA(() => targets.saveTarget({ scope: 'role', metric: 'delivery_success_rate', unit: 'percent', value: 60, period: '2026-10', roleId: otherRoleId }));
    expect(rate.parentId).toBe(oct.id);
    // 723 orders and 60 percent sit under a month of 180,000 revenue, and do not count in it
    await inA(() => targets.saveTarget({ scope: 'role', metric: 'revenue', unit: 'currency', value: 100_000, period: '2026-10', roleId }));
    await inA(() => targets.saveTarget({ scope: 'role', metric: 'revenue', unit: 'currency', value: 80_000, period: '2026-10', roleId: otherRoleId }));
    await rejects(inA(() => targets.saveTarget({ scope: 'role', metric: 'revenue', unit: 'currency', value: 80_001, period: '2026-10', roleId: otherRoleId })), 400, /Difference: 1\.00/);
    await prismaBase.target.deleteMany({ where: { tenantId: A(), scope: 'role', metric: { in: ['revenue', 'delivery_success_rate'] } } });
  });
});

describe('role pool, person targets and "Set a target"', () => {
  it('a holder with no target shows "Set a target"; no automatic proration', async () => {
    await inA(() => targets.saveTarget({ scope: 'role', ...orders({ value: 723, period: '2026-11', roleId }) }));
    const rows = await inA(() => targets.roleHolderTargets(roleId, '2026-10'));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.target === null && r.label === 'Set a target')).toBe(true);
    expect((await inA(() => targets.rolePool(roleId, '2026-10')))!.pool).toBe('723.00');
  });

  it('a role target over its month is rejected with the difference', async () => {
    await rejects(inA(() => targets.saveTarget({ scope: 'role', metric: 'revenue', unit: 'currency', value: 200_000, period: '2026-12', roleId: otherRoleId })), 400, /over by 20000\.00.*Difference: 20000\.00/);
  });

  it('person targets link to the role target; over the role is rejected; the rest is the pool', async () => {
    const roleTarget = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'role', roleId, periodStart: new Date('2026-10-01') } });
    const t = await inA(() => targets.saveTarget({ scope: 'person', ...orders({ value: 400, period: '2026-10', roleId, userId: anna }) }));
    expect(t.parentId).toBe(roleTarget.id);
    await inA(() => targets.saveTarget({ scope: 'person', ...orders({ value: 200, period: '2026-10', roleId, userId: ben }) }));
    await inA(() => targets.saveTarget({ scope: 'person', ...orders({ value: 200, period: '2026-11', roleId, userId: ben }) }));
    await rejects(inA(() => targets.saveTarget({ scope: 'person', ...orders({ value: 400, period: '2026-10', roleId, userId: ben }) })), 400, /over by 77\.00/);
    expect(await inA(() => targets.rolePool(roleId, '2026-10'))).toMatchObject({ allocated: '600.00', pool: '123.00' });
    const rows = await inA(() => targets.roleHolderTargets(roleId, '2026-10'));
    expect(rows.find((r) => r.userId === anna)!.target!.value).toBe('400.00');
  });

  it('a role target cannot drop below what its persons hold', async () => {
    await rejects(inA(() => targets.saveTarget({ scope: 'role', ...orders({ value: 500, period: '2026-10', roleId }) })), 400, /over by 100\.00/);
  });

  it('a person who does not hold the role cannot get a person target', async () => {
    await rejects(inA(() => targets.saveTarget({ scope: 'person', ...orders({ value: 1, period: '2026-10', roleId, userId: actor }) })), 400, /does not hold/);
  });

  it('unassign mid-month: this month kept with a shorter period, pool grows, later months removed, audit and notice', async () => {
    const assignment = await prismaBase.roleAssignment.findFirstOrThrow({ where: { roleId, holderId: ben, toDate: null } });
    const result = await inA(() => unassign({ id: actor, role: 'super_admin' }, roleId, assignment.id));
    expect(result.targetReturned?.notice).toMatch(/Ben T left Call rep T07.*200\.00 count for 2026-10.*200\.00 count for 2026-11.*pool/);
    const mine = await prismaBase.target.findMany({ where: { tenantId: A(), scope: 'person', userId: ben } });
    expect(mine).toHaveLength(1);
    expect(mine[0].periodStart.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(mine[0].periodEnd.toISOString().slice(0, 10)).toBe('2026-10-16');
    expect(await inA(() => targets.rolePool(roleId, '2026-10'))).toMatchObject({ allocated: '400.00', pool: '323.00' });
    expect(await prismaBase.auditLog.count({ where: { tenantId: A(), action: 'target_release', resourceId: String(roleId) } })).toBe(1);
    expect(await prismaBase.notification.count({ where: { tenantId: A(), userId: actor, type: 'target_returned' } })).toBe(1);
  });

  it('unassigning a person with no target returns nothing', async () => {
    const extra = await prismaBase.user.create({ data: { email: 'cy-m6targets@codadmin.test', password: 'x', firstName: 'Cy', lastName: 'T', role: 'sales_rep', tenantId: A() } });
    const a = await prismaBase.roleAssignment.create({ data: { tenantId: A(), roleId, holderId: extra.id, fromDate: new Date('2026-01-01') } });
    const result = await inA(() => unassign({ id: actor, role: 'super_admin' }, roleId, a.id));
    expect(result.targetReturned).toBeNull();
    await prismaBase.roleAssignment.deleteMany({ where: { holderId: extra.id } });
    await prismaBase.user.delete({ where: { id: extra.id } });
  });
});

describe('concurrent writes', () => {
  it('two role targets that together exceed their month: one is saved, one is rejected', async () => {
    const results = await Promise.allSettled([
      inA(() => targets.saveTarget({ scope: 'role', metric: 'revenue', unit: 'currency', value: 100_000, period: '2026-12', roleId })),
      inA(() => targets.saveTarget({ scope: 'role', metric: 'revenue', unit: 'currency', value: 100_000, period: '2026-12', roleId: otherRoleId })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ statusCode: 400, message: expect.stringMatching(/Difference: 20000\.00/) });
  });
});

describe('daily activity targets', () => {
  it('saves "failed delivery calls 15" and reads it with the day count', async () => {
    await inA(() => targets.saveTarget({ scope: 'daily', metric: FAILED_CALLS_METRIC, unit: 'count', value: 15, period: '2026-10-01' }));
    expect(await inA(() => targets.dailyTargetProgress(FAILED_CALLS_METRIC, '2026-10-17'))).toMatchObject({ target: 15, actual: 0, message: null });
  });

  it('a newer start day replaces the older one from that day', async () => {
    await inA(() => targets.saveTarget({ scope: 'daily', metric: FAILED_CALLS_METRIC, unit: 'count', value: 20, period: '2026-10-20' }));
    expect((await inA(() => targets.dailyTargetProgress(FAILED_CALLS_METRIC, '2026-10-19'))).target).toBe(15);
    expect((await inA(() => targets.dailyTargetProgress(FAILED_CALLS_METRIC, '2026-10-20'))).target).toBe(20);
  });

  it('a metric with no data source returns "No data for this metric"', async () => {
    const saved = await inA(() => targets.saveTarget({ scope: 'daily', metric: 'whatsapp_follow_ups', unit: 'count', value: 30, period: '2026-10-01' }));
    expect(saved.scope).toBe('daily');
    expect(await inA(() => targets.dailyTargetProgress('whatsapp_follow_ups', '2026-10-17'))).toMatchObject({ target: 30, actual: null, message: 'No data for this metric' });
  });
});

describe('year pace on the dashboard ladder', () => {
  it('uses the quarter plan: 17 Oct reads 75.5%, not straight days', async () => {
    const l = await leadership(A(), '2026-10-17');
    expect(l.pace.year.value).toBe(75.5);
    expect(l.attainment.year).toMatchObject({ pace: 75.5, paceBasis: 'quarter_plan' });
    expect(l.attainment.quarter).toMatchObject({ pace: 18.5, paceBasis: 'days', target: '540000.00' });
  });
});

describe('closed month', () => {
  it('a closed month and everything inside it cannot be edited', async () => {
    await prismaBase.target.updateMany({ where: { tenantId: A(), scope: 'month', periodStart: new Date('2026-10-01') }, data: { closedAt: new Date() } });
    const q4 = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'quarter', metric: 'revenue', periodStart: new Date('2026-10-01') } });
    await rejects(inA(() => targets.setChildren(q4.id, [{ period: '2026-10', value: 190_000 }, { period: '2026-11', value: 170_000 }])), 409, /closed/);
    await rejects(inA(() => targets.saveTarget({ scope: 'person', ...orders({ value: 300, period: '2026-10', roleId, userId: anna }) })), 409, /closed/);
    await rejects(inA(() => targets.saveTarget({ scope: 'role', metric: 'delivery_success_rate', unit: 'percent', value: 61, period: '2026-10', roleId: otherRoleId })), 409, /closed/);
    await rejects(inA(() => targets.saveTarget({ scope: 'role', ...orders({ value: 700, period: '2026-10', roleId }) })), 409, /closed/);
    const person = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'person', userId: anna } });
    await rejects(inA(() => targets.deleteTarget(person.id)), 409, /closed/);
  });

  it('the other months of the quarter can be re-planned; the closed month keeps its value', async () => {
    const q4 = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'quarter', metric: 'revenue', periodStart: new Date('2026-10-01') } });
    const saved = await inA(() => targets.setChildren(q4.id, [{ period: '2026-10', value: 180_000 }, { period: '2026-11', value: 170_000 }, { period: '2026-12', value: 190_000 }]));
    expect(saved.map((m) => Number(m.value))).toEqual([180_000, 170_000, 190_000]);
    expect(Number((await monthOf('2026-10')).value)).toBe(180_000);
  });
});

describe('two tenants', () => {
  it('tenant B cannot see or touch tenant A targets', async () => {
    expect(await runInTenant(pair.b.id, () => targets.rolePool(roleId, '2026-10'))).toBeNull();
    await rejects(runInTenant(pair.b.id, () => targets.deleteTarget(northStar.id)), 404, /not found/);
    await rejects(runInTenant(pair.b.id, () => targets.setChildren(northStar.id, [])), 404, /not found/);
  });
});
