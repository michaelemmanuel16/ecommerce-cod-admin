/**
 * M6-T15 (COD-59, F-1101, F-1102): GET /api/targets/tree with actuals. A past month with revenue and margin, a missed month with no
 * margin data ("n/a"), the current month behind its pace, a future month with its target only, the year on the quarter plan, the role
 * rows of a month (vacant roles, AI agents), tenant isolation and a sales rep refused. The clock is fixed at 17 October 2026.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import glService from '../../services/glService';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

jest.setTimeout(90_000);

let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
const A = () => pair.a.id;
const get = (t: string, url: string) => request(app).get(url).set(bearer(t));

const deliveredOrder = (day: string, amount: number) => prismaBase.order.create({
  data: {
    customerId: pair.a.ids.customer, customerRepId: pair.a.users.salesRep.id, deliveryAgentId: pair.a.users.deliveryAgent.id, status: 'delivered',
    deliveryDate: new Date(`${day}T10:00:00Z`), subtotal: amount, shippingCost: 0, totalAmount: amount, codAmount: amount,
    deliveryAddress: '1 Test Street', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: A(),
  },
});

beforeAll(async () => {
  jest.useFakeTimers({
    now: new Date('2026-10-17T12:00:00Z'),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  pair = await createTwoTenants('m6tree');
  ownerA = await superAdminToken(A(), pair.a.slug);
  ownerB = await superAdminToken(pair.b.id, pair.b.slug);
  expect((await request(app).post('/api/targets/north-star').set(bearer(ownerA)).send({ year: 2026, annual: 1_800_000, mode: 'grow', plannedAov: 249 })).status).toBe(201);

  // September: 170,000 delivered, with the books: revenue 170,000 and cost of goods 140,000 (margin 17.6%, under the 35% target)
  await deliveredOrder('2026-09-15', 170_000);
  // October so far: 92,000 delivered (the Dashboard fixture)
  await deliveredOrder('2026-10-10', 92_000);
  await runInTenant(A(), async () => {
    const accounts = await prisma.account.findMany({ where: { code: { in: ['1010', '4010', '5010'] } } });
    const id = (code: string) => accounts.find((x) => x.code === code)!.id;
    await glService.createJournalEntry({
      entryDate: new Date('2026-09-15T10:00:00Z'), description: 'Sep sales', sourceType: 'manual',
      transactions: [
        { accountId: id('1010'), debitAmount: 170_000, creditAmount: 0 }, { accountId: id('4010'), debitAmount: 0, creditAmount: 170_000 },
        { accountId: id('5010'), debitAmount: 140_000, creditAmount: 0 }, { accountId: id('1010'), debitAmount: 0, creditAmount: 140_000 },
      ],
    }, { id: pair.a.users.admin.id } as any);
  });
}, 90_000);

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.order.deleteMany({ where: { tenantId: A(), status: 'delivered', totalAmount: { in: [170_000, 92_000] } } });
  await prismaBase.target.deleteMany({ where: { tenantId: A(), metric: { in: ['revenue', 'planned_aov'] } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const month = (tree: any, ym: string) => tree.months.find((m: any) => m.periodStart.startsWith(ym));

describe('GET /api/targets/tree: actuals', () => {
  let tree: any;
  beforeAll(async () => { tree = (await get(ownerA, '/api/targets/tree?year=2026')).body; });

  it('a past month with revenue and margin: Revenue hit, margin missed', () => {
    const sep = month(tree, '2026-09');
    expect(sep.value).toBe('160000.00');
    expect(sep.actuals).toMatchObject({ state: 'past', actual: '170000.00', marginPct: 17.6, status: { key: 'hit_margin_missed', label: 'Revenue hit, margin missed' } });
    expect(sep.actuals.percent).toBe(106.3);
  });

  it('a past month below its target with no margin data: Behind and margin n/a (null)', () => {
    const aug = month(tree, '2026-08');
    expect(aug.actuals).toMatchObject({ state: 'past', actual: '0.00', marginPct: null, status: { key: 'behind' } });
  });

  it('the current month is measured against the straight-day pace', () => {
    const oct = month(tree, '2026-10');
    expect(oct.actuals).toMatchObject({ state: 'current', actual: '92000.00', percent: 51.1, pace: 54.8, status: { key: 'behind', label: 'Behind' } });
    expect(typeof oct.actuals.marginPct === 'number' || oct.actuals.marginPct === null).toBe(true);
  });

  it('a future month shows its target only', () => {
    const nov = month(tree, '2026-11');
    expect(nov.value).toBe('180000.00');
    expect(nov.actuals).toEqual({ state: 'future', actual: null, percent: null, marginPct: null, status: null, pace: null, paceBasis: null, chip: null });
  });

  it('quarters: Q3 hit its revenue and missed the margin; Q4 is behind', () => {
    const q = (n: number) => tree.quarters[n - 1];
    expect(q(3).actuals).toMatchObject({ state: 'past', actual: '170000.00', percent: 35.4, status: { key: 'behind' } });
    expect(q(4).actuals).toMatchObject({ state: 'current', actual: '92000.00', percent: 17, pace: 18.5, status: { key: 'behind' } });
    expect(q(1).actuals.state).toBe('past');
  });

  it('the year follows the quarter plan: pace 75.5, not straight days (79.5)', () => {
    expect(tree.northStar.actuals).toMatchObject({ state: 'current', actual: '262000.00', percent: 14.6, pace: 75.5, paceBasis: 'quarter_plan' });
    expect(tree.northStar.actuals.chip).toEqual({ points: 61, tag: 'behind' });
    expect(tree.marginTarget).toBe(35);
    expect(tree.currency).toBeTruthy();
  });
});

describe('GET /api/targets/tree?month: role rows', () => {
  it('lists every role but the Owner with its holders; a role with no holder has none; an AI agent holder is included with its kind', async () => {
    const roles = await prismaBase.role.findMany({ where: { tenantId: A() } });
    const callRep = roles.find((r) => r.name === 'Call rep')!;
    const agent = await prismaBase.user.create({ data: { email: 'bot-m6tree@codadmin.test', password: 'x', firstName: 'Confirm', lastName: 'Agent', role: 'sales_rep', kind: 'ai_agent', tenantId: A() } });
    await prismaBase.roleAssignment.create({ data: { tenantId: A(), roleId: callRep.id, holderId: agent.id, fromDate: new Date('2026-01-01') } });
    try {
      const res = await get(ownerA, '/api/targets/tree?year=2026&month=2026-10');
      expect(res.status).toBe(200);
      const names = res.body.roles.map((r: any) => r.roleName);
      expect(names).not.toContain('Owner');
      expect(names).toContain('Call rep');
      const call = res.body.roles.find((r: any) => r.roleName === 'Call rep');
      expect(call.holders).toEqual(expect.arrayContaining([expect.objectContaining({ userId: agent.id, kind: 'ai_agent', label: 'Set a target' })]));
      const vacant = res.body.roles.find((r: any) => r.holders.length === 0);
      expect(vacant).toBeTruthy();
      expect(vacant.target).toBeNull();
    } finally {
      await prismaBase.roleAssignment.deleteMany({ where: { holderId: agent.id } });
      await prismaBase.user.delete({ where: { id: agent.id } });
    }
  });
});

describe('GET /api/targets/tree: light form and role attainment', () => {
  it('actuals=false leaves the actuals out of the nodes and still lists the roles', async () => {
    const res = await get(ownerA, '/api/targets/tree?year=2026&month=2026-10&actuals=false');
    expect(res.status).toBe(200);
    expect(res.body.months.length).toBeGreaterThan(0);
    expect(res.body.months.every((m: any) => m.actuals === undefined)).toBe(true);
    expect(res.body.northStar.actuals).toBeUndefined();
    expect(res.body.roles.length).toBeGreaterThan(0);
    expect((await get(ownerA, '/api/targets/tree?year=2026&actuals=maybe')).status).toBe(400);
  });

  it('roleAttainment: null with no role target, the sum of the holders against the role target, null for a month not started', async () => {
    const callRep = await prismaBase.role.findFirstOrThrow({ where: { tenantId: A(), name: 'Call rep' } });
    const rep = pair.a.users.salesRep.id;
    const assignment = await prismaBase.roleAssignment.create({ data: { tenantId: A(), roleId: callRep.id, holderId: rep, fromDate: new Date('2026-01-01') } });
    try {
      let call = (await get(ownerA, '/api/targets/tree?year=2026&month=2026-10')).body.roles.find((r: any) => r.roleId === callRep.id);
      expect(call.roleAttainment).toBeNull();
      const save = (body: object) => request(app).post('/api/targets').set(bearer(ownerA)).send(body);
      expect((await save({ scope: 'role', metric: 'confirmed_delivered', unit: 'count', value: 100, period: '2026-10', roleId: callRep.id })).status).toBe(201);
      expect((await save({ scope: 'person', metric: 'confirmed_delivered', unit: 'count', value: 60, period: '2026-10', roleId: callRep.id, userId: rep })).status).toBe(201);
      call = (await get(ownerA, '/api/targets/tree?year=2026&month=2026-10')).body.roles.find((r: any) => r.roleId === callRep.id);
      expect(call.roleAttainment).toMatchObject({ target: 100, rate: false });
      expect(call.roleAttainment.percent).toBe(Math.round((call.roleAttainment.done / 100) * 100));
      const nov = (await get(ownerA, '/api/targets/tree?year=2026&month=2026-11')).body.roles.find((r: any) => r.roleId === callRep.id);
      expect(nov.roleAttainment).toBeNull();
    } finally {
      await prismaBase.target.deleteMany({ where: { tenantId: A(), metric: 'confirmed_delivered' } });
      await prismaBase.roleAssignment.delete({ where: { id: assignment.id } });
    }
  });
});

describe('POST /api/targets/batch', () => {
  it('saves the rows N single saves would, in one transaction: a bad member saves nothing; north_star is refused; a rep is refused', async () => {
    const callRep = await prismaBase.role.findFirstOrThrow({ where: { tenantId: A(), name: 'Call rep' } });
    const rep = pair.a.users.salesRep.id;
    const assignment = await prismaBase.roleAssignment.create({ data: { tenantId: A(), roleId: callRep.id, holderId: rep, fromDate: new Date('2026-01-01') } });
    const post = (token: string, targets: object[]) => request(app).post('/api/targets/batch').set(bearer(token)).send({ targets });
    const role = { scope: 'role', metric: 'confirmed_delivered', unit: 'count', value: 100, period: '2026-10', roleId: callRep.id };
    const person = { scope: 'person', metric: 'confirmed_delivered', unit: 'count', value: 60, period: '2026-10', roleId: callRep.id, userId: rep };
    try {
      // role 100, person 60 over a role that is 100: fine. A person of 150 is over the role: the whole batch fails and the role row is not kept.
      const bad = await post(ownerA, [role, { ...person, value: 150 }]);
      expect(bad.status).toBe(400);
      expect(await prismaBase.target.count({ where: { tenantId: A(), metric: 'confirmed_delivered' } })).toBe(0);

      const ok = await post(ownerA, [role, person]);
      expect({ s: ok.status, b: ok.body }).toMatchObject({ s: 201 });
      expect(ok.body.targets.map((t: any) => [t.scope, t.value])).toEqual([['role', '100.00'], ['person', '60.00']]);
      const rows = await prismaBase.target.findMany({ where: { tenantId: A(), metric: 'confirmed_delivered' }, orderBy: { id: 'asc' } });
      expect(rows.map((r) => [r.scope, Number(r.value), r.roleId, r.userId])).toEqual([['role', 100, callRep.id, null], ['person', 60, callRep.id, rep]]);
      expect(rows[1].parentId).toBe(rows[0].id);

      expect((await post(ownerA, [{ scope: 'north_star', metric: 'revenue', unit: 'money', value: 1, period: '2026' }])).status).toBe(403);
      expect((await post(pair.a.users.salesRep.token, [role])).status).toBe(403);
    } finally {
      await prismaBase.target.deleteMany({ where: { tenantId: A(), metric: 'confirmed_delivered' } });
      await prismaBase.roleAssignment.delete({ where: { id: assignment.id } });
    }
  });
});

describe('isolation and permission', () => {
  it('tenant B sees none of tenant A: no North Star, no actuals, no role rows of A', async () => {
    const res = await get(ownerB, '/api/targets/tree?year=2026&month=2026-10');
    expect(res.body.northStar).toBeNull();
    expect(res.body.quarters).toEqual([]);
    const idsA = (await prismaBase.role.findMany({ where: { tenantId: A() } })).map((r) => r.id);
    expect(res.body.roles.some((r: any) => idsA.includes(r.roleId))).toBe(false);
  });

  it('a sales rep is refused', async () => {
    expect((await get(pair.a.users.salesRep.token, '/api/targets/tree?year=2026&month=2026-10')).status).toBe(403);
  });
});
