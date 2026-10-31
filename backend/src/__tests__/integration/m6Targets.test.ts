/**
 * M6-T07 (COD-57, F-1100, F-1103): target service. Hierarchy and sum checks, closed month lock, role pool on unassign,
 * "Set a target", daily activity targets, year pace on the dashboard, two tenants.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
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

let northStar: { id: number };
let roleId: number;
let anna: number;
let ben: number;

beforeAll(async () => {
  pair = await createTwoTenants('m6targets');
  const role = await prismaBase.role.create({ data: { tenantId: A(), name: 'Call rep T07', area: 'Sales' } });
  roleId = role.id;
  const mk = (n: string) => prismaBase.user.create({ data: { email: `${n}-m6targets@codadmin.test`, password: 'x', firstName: n, lastName: 'T', role: 'sales_rep', tenantId: A() } });
  anna = (await mk('Anna')).id;
  ben = (await mk('Ben')).id;
  for (const holderId of [anna, ben]) await prismaBase.roleAssignment.create({ data: { tenantId: A(), roleId, holderId, fromDate: new Date('2026-01-01') } });
  northStar = await inA(() => targets.saveTarget({ scope: 'north_star', metric: 'revenue', unit: 'currency', value: 1_800_000, period: '2026' }));
});

afterAll(async () => {
  await prismaBase.target.deleteMany({ where: { tenantId: A() } });
  await prismaBase.roleAssignment.deleteMany({ where: { roleId } });
  await prismaBase.notification.deleteMany({ where: { tenantId: A(), type: 'target_returned' } });
  await prismaBase.role.delete({ where: { id: roleId } });
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

  it('months of a quarter must add up to it; a single month cannot push the sum over', async () => {
    const q4 = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'quarter', periodStart: new Date('2026-10-01') } });
    await rejects(inA(() => targets.setChildren(q4.id, [
      { period: '2026-10', value: 180_000 }, { period: '2026-11', value: 180_000 }, { period: '2026-12', value: 100_000 },
    ])), 400, /short.*Difference: 80000\.00/);
    await inA(() => targets.setChildren(q4.id, [
      { period: '2026-10', value: 180_000 }, { period: '2026-11', value: 180_000 }, { period: '2026-12', value: 180_000 },
    ]));
    await rejects(inA(() => targets.saveTarget({ scope: 'month', metric: 'revenue', unit: 'currency', value: 200_000, period: '2026-10' })), 400, /over.*Difference: 20000\.00/);
  });

  it('a parent value cannot change away from its children, and a child needs the same metric', async () => {
    await rejects(inA(() => targets.saveTarget({ scope: 'north_star', metric: 'revenue', unit: 'currency', value: 2_000_000, period: '2026' })), 400, /Difference: 200000\.00/);
    const oct = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'month', periodStart: new Date('2026-10-01') } });
    await rejects(inA(() => targets.saveTarget({ scope: 'role', metric: 'orders', unit: 'count', value: 5, period: '2026-10', roleId, parentId: oct.id })), 400, /same metric/);
  });
});

describe('role pool, person targets and "Set a target"', () => {
  let roleTarget: { id: number };

  it('a holder with no target shows "Set a target"; no automatic proration', async () => {
    roleTarget = await inA(() => targets.saveTarget({ scope: 'role', metric: 'delivered_orders', unit: 'count', value: 723, period: '2026-10', roleId }));
    const rows = await inA(() => targets.roleHolderTargets(roleId, '2026-10'));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.target === null && r.label === 'Set a target')).toBe(true);
    expect((await inA(() => targets.rolePool(roleId, '2026-10')))!.pool).toBe('723.00');
  });

  it('person targets link to the role target; over the role is rejected; the rest is the pool', async () => {
    const t = await inA(() => targets.saveTarget({ scope: 'person', metric: 'delivered_orders', unit: 'count', value: 400, period: '2026-10', roleId, userId: anna }));
    expect(t.parentId).toBe(roleTarget.id);
    await inA(() => targets.saveTarget({ scope: 'person', metric: 'delivered_orders', unit: 'count', value: 200, period: '2026-10', roleId, userId: ben }));
    await rejects(inA(() => targets.saveTarget({ scope: 'person', metric: 'delivered_orders', unit: 'count', value: 400, period: '2026-10', roleId, userId: ben })), 400, /over.*Difference: 77\.00/);
    expect(await inA(() => targets.rolePool(roleId, '2026-10'))).toMatchObject({ allocated: '600.00', pool: '123.00' });
    const rows = await inA(() => targets.roleHolderTargets(roleId, '2026-10'));
    expect(rows.find((r) => r.userId === anna)!.target!.value).toBe('400.00');
  });

  it('a person who does not hold the role cannot get a person target', async () => {
    await rejects(inA(() => targets.saveTarget({ scope: 'person', metric: 'delivered_orders', unit: 'count', value: 1, period: '2026-10', roleId, userId: pair.a.users.admin.id })), 400, /does not hold/);
  });

  it('removing a person from the role returns their target to the pool, with a notice', async () => {
    const owner = pair.a.users.admin.id;
    const assignment = await prismaBase.roleAssignment.findFirstOrThrow({ where: { roleId, holderId: ben, toDate: null } });
    const result = await inA(() => unassign({ id: owner, role: 'super_admin' }, roleId, assignment.id));
    expect(result.targetReturned?.notice).toMatch(/Ben T left Call rep T07.*200\.00 count.*pool/);
    expect(await prismaBase.target.count({ where: { tenantId: A(), scope: 'person', userId: ben } })).toBe(0);
    expect(await inA(() => targets.rolePool(roleId, '2026-10'))).toMatchObject({ allocated: '400.00', pool: '323.00' });
    expect(await prismaBase.notification.count({ where: { tenantId: A(), userId: owner, type: 'target_returned' } })).toBe(1);
  });

  it('unassigning a person with no target returns nothing', async () => {
    const extra = await prismaBase.user.create({ data: { email: `cy-m6targets@codadmin.test`, password: 'x', firstName: 'Cy', lastName: 'T', role: 'sales_rep', tenantId: A() } });
    const a = await prismaBase.roleAssignment.create({ data: { tenantId: A(), roleId, holderId: extra.id, fromDate: new Date('2026-01-01') } });
    const result = await inA(() => unassign({ id: pair.a.users.admin.id, role: 'super_admin' }, roleId, a.id));
    expect(result.targetReturned).toBeNull();
    await prismaBase.roleAssignment.deleteMany({ where: { holderId: extra.id } });
    await prismaBase.user.delete({ where: { id: extra.id } });
  });
});

describe('closed month', () => {
  it('a closed month and everything inside it cannot be edited', async () => {
    await prismaBase.target.updateMany({ where: { tenantId: A(), scope: 'month', periodStart: new Date('2026-11-01') }, data: { closedAt: new Date() } });
    await rejects(inA(() => targets.saveTarget({ scope: 'month', metric: 'revenue', unit: 'currency', value: 170_000, period: '2026-11' })), 409, /closed/);
    await rejects(inA(() => targets.saveTarget({ scope: 'role', metric: 'delivered_orders', unit: 'count', value: 600, period: '2026-11', roleId })), 409, /closed/);
    const nov = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'month', periodStart: new Date('2026-11-01') } });
    await rejects(inA(() => targets.deleteTarget(nov.id)), 409, /closed/);
    const q4 = await prismaBase.target.findFirstOrThrow({ where: { tenantId: A(), scope: 'quarter', periodStart: new Date('2026-10-01') } });
    await rejects(inA(() => targets.setChildren(q4.id, [{ period: '2026-10', value: 190_000 }, { period: '2026-11', value: 170_000 }])), 409, /closed/);
  });

  it('an open month next to it can still be edited', async () => {
    const dec = await inA(() => targets.saveTarget({ scope: 'month', metric: 'revenue', unit: 'currency', value: 180_000, period: '2026-12' }));
    expect(dec.value.toString()).toBe('180000');
  });
});

describe('daily activity targets', () => {
  it('saves "failed delivery calls 15" and reads it with the day count', async () => {
    await inA(() => targets.saveDailyTarget({ metric: FAILED_CALLS_METRIC, value: 15, from: '2026-10-01' }));
    const p = await inA(() => targets.dailyTargetProgress(FAILED_CALLS_METRIC, '2026-10-17'));
    expect(p).toMatchObject({ target: 15, actual: 0, message: null });
  });

  it('a newer start day replaces the older one from that day', async () => {
    await inA(() => targets.saveDailyTarget({ metric: FAILED_CALLS_METRIC, value: 20, from: '2026-10-20' }));
    expect((await inA(() => targets.dailyTargetProgress(FAILED_CALLS_METRIC, '2026-10-19'))).target).toBe(15);
    expect((await inA(() => targets.dailyTargetProgress(FAILED_CALLS_METRIC, '2026-10-20'))).target).toBe(20);
  });

  it('a metric with no data source returns "No data for this metric"', async () => {
    const saved = await inA(() => targets.saveDailyTarget({ metric: 'whatsapp_follow_ups', value: 30, from: '2026-10-01' }));
    expect(saved.scope).toBe('daily');
    expect(await inA(() => targets.dailyTargetProgress('whatsapp_follow_ups', '2026-10-17'))).toMatchObject({ target: 30, actual: null, message: 'No data for this metric' });
  });
});

describe('year pace on the dashboard ladder', () => {
  it('uses the quarter plan: 17 Oct reads 75.5%, not straight days', async () => {
    const l = await leadership(A(), '2026-10-17');
    expect(l.pace.year.value).toBe(75.5);
    expect(l.attainment.year.pace).toBe(75.5);
    expect(l.pace.quarter.value).toBe(18.5); // 17 / 92, straight days
  });
});

describe('two tenants', () => {
  it('tenant B cannot see or touch tenant A targets', async () => {
    const seen = await runInTenant(pair.b.id, () => targets.rolePool(roleId, '2026-10'));
    expect(seen).toBeNull();
    await rejects(runInTenant(pair.b.id, () => targets.deleteTarget(northStar.id)), 404, /not found/);
  });
});
