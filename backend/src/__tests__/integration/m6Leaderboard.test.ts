/**
 * M6-T11 (COD-58): leaderboard and badges. Call reps and delivery on a fixture (ranks with ties, no target, "Too early", the contract
 * flag), the period select (today, week, month, year, a past month), rewards only for month and year, a rep sees only their own row,
 * tenant isolation, the badge rules and "never awarded twice", GET /api/badges, GET /api/rewards/progress.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { generateAccessToken } from '../../utils/jwt';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTenant, createTwoTenants, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { awardMonthBadges } from '../../services/badgeService';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
const OCT = { start: new Date('2026-10-01'), end: new Date('2026-10-31') };
const SEP = { start: new Date('2026-09-01'), end: new Date('2026-09-30') };
const AUG = { start: new Date('2026-08-01'), end: new Date('2026-08-31') };
const api = {
  get: (token: string, url: string) => request(app).get(url).set(bearer(token)),
  put: (token: string, url: string, body: object = {}) => request(app).put(url).set(bearer(token)).send(body),
};
let seq = 0;

/** A small world for one tenant: users, targets and orders by helper. */
function world(tenantId: string, customerId: () => number, callRepRoleId: () => number, deliveryRoleId: () => number) {
  const user = async (label: string, role: 'sales_rep' | 'delivery_agent', kind: 'person' | 'ai_agent' | 'company', roleId: number, hold = true) => {
    const name = `${label}${SUFFIX}x${seq++}`;
    const u = await prismaBase.user.create({
      data: { email: `${name}@codadmin.test`, password: 'x', firstName: kind === 'person' ? name : name, lastName: kind === 'person' ? 'Lb' : 'Lb', role, kind, tenantId },
    });
    if (hold) await prismaBase.roleAssignment.create({ data: { tenantId, roleId, holderId: u.id, fromDate: new Date('2026-01-01') } });
    return { ...u, name: kind === 'person' ? `${name} Lb` : name, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
  };
  const target = (userId: number, roleId: number, month: { start: Date; end: Date }, metric: string, value: number) =>
    prismaBase.target.create({ data: { tenantId, scope: 'person', metric, unit: metric === 'delivery_success_rate' ? 'percent' : 'count', periodStart: month.start, periodEnd: month.end, value, roleId, userId } });
  const order = (extra: Record<string, unknown>) => prismaBase.order.create({
    data: {
      tenantId, customerId: customerId(), status: 'delivered', subtotal: '10', totalAmount: '10', codAmount: '10',
      deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
    } as never,
  });
  /** n delivered orders confirmed by the rep, delivered on `on`, placed on `on` too. */
  const repDelivered = async (repId: number, n: number, on: string) => {
    for (let i = 0; i < n; i++) await order({ confirmedById: repId, customerRepId: repId, confirmedAt: new Date(on), deliveryDate: new Date(on), createdAt: new Date(on) });
  };
  /** n orders that closed as `status` for a delivery partner. */
  const closed = async (partnerId: number, n: number, status: 'delivered' | 'returned', on: string, extra: Record<string, unknown> = {}) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(await order({
        deliveryAgentId: partnerId, status, createdAt: new Date(on),
        ...(status === 'delivered' ? { deliveryDate: new Date(on) } : { returnedAt: new Date(on) }), ...extra,
      }));
    }
    return rows;
  };
  return { user, target, order, repDelivered, closed, callRepRoleId, deliveryRoleId };
}

// ---- Tenant A: the leaderboard fixture ------------------------------------------------------------------------------------

let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let w: ReturnType<typeof world>;
let customerA: number;
let callRepRole: number;
let deliveryRole: number;
const people: Record<string, Awaited<ReturnType<ReturnType<typeof world>['user']>>> = {};

const board = (token: string, role: string, period?: string) =>
  api.get(token, `/api/leaderboard?role=${role}${period ? `&period=${period}` : ''}`);
const rowOf = (body: { rows: Array<Record<string, any>> }, id: number) => body.rows.find((r) => r.userId === id)!;

beforeAll(async () => {
  pair = await createTwoTenants('m6lb');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'lb-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'lb-owner');
  callRepRole = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Call rep' } })).id;
  deliveryRole = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Delivery' } })).id;
  customerA = (await prismaBase.order.findFirstOrThrow({ where: { tenantId: pair.a.id } })).customerId;
  w = world(pair.a.id, () => customerA, () => callRepRole, () => deliveryRole);

  // Call reps in October: Adwoa 6 of 10 (60%), Tie 3 of 5 (60%), the AI agent 4 of 10 (40%), Nana 2 of 10 (20%), and a holder with no target.
  people.adwoa = await w.user('adwoa', 'sales_rep', 'person', callRepRole);
  people.tie = await w.user('tie', 'sales_rep', 'person', callRepRole);
  people.agent = await w.user('agent', 'sales_rep', 'ai_agent', callRepRole);
  people.nana = await w.user('nana', 'sales_rep', 'person', callRepRole);
  people.none = await w.user('notarget', 'sales_rep', 'person', callRepRole);
  for (const [who, goal, done] of [['adwoa', 10, 6], ['tie', 5, 3], ['agent', 10, 4], ['nana', 10, 2]] as const) {
    await w.target(people[who].id, callRepRole, OCT, 'confirmed_delivered', goal);
    await w.repDelivered(people[who].id, done, '2026-10-12T10:00:00Z');
  }
  // Adwoa also had 6 confirmed orders that came back: delivered from confirmed = 6 / 12 = 50%
  for (let i = 0; i < 6; i++) await w.order({ confirmedById: people.adwoa.id, customerRepId: people.adwoa.id, status: 'returned', returnedAt: new Date('2026-10-14T10:00:00Z'), createdAt: new Date('2026-10-12T10:00:00Z') });

  // Delivery in October, 60% success target: Esi 11/20 (55) and Kwesi 11/20 (a tie), Kofi 9/17 plus one paid delivery (10/18 = 55.5), Logiswift (company) 9/20 (45 = 75% of target),
  // Kasapa Express (company) has no closed orders.
  people.esi = await w.user('esi', 'delivery_agent', 'person', deliveryRole);
  people.kofi = await w.user('kofi', 'delivery_agent', 'person', deliveryRole);
  people.kwesi = await w.user('kwesi', 'delivery_agent', 'person', deliveryRole);
  people.logiswift = await w.user('logiswift', 'delivery_agent', 'company', deliveryRole);
  people.kasapa = await w.user('kasapa', 'delivery_agent', 'company', deliveryRole);
  for (const [who, ok, bad] of [['esi', 11, 9], ['kofi', 9, 8], ['kwesi', 11, 9], ['logiswift', 9, 11]] as const) {
    await w.target(people[who].id, deliveryRole, OCT, 'delivery_success_rate', 60);
    await w.closed(people[who].id, ok, 'delivered', '2026-10-15T10:00:00Z');
    await w.closed(people[who].id, bad, 'returned', '2026-10-16T10:00:00Z');
  }
  await w.target(people.kasapa.id, deliveryRole, OCT, 'delivery_success_rate', 60);
  // Kofi's cash came in two days after delivery, once: days to pay = 2.0
  const [paid] = await w.closed(people.kofi.id, 1, 'delivered', '2026-10-20T10:00:00Z');
  await prismaBase.agentCollection.create({
    data: { tenantId: pair.a.id, orderId: paid.id, agentId: people.kofi.id, amount: '10', status: 'deposited', collectionDate: new Date('2026-10-20T10:00:00Z'), verifiedAt: new Date('2026-10-22T10:00:00Z') },
  });
  // tiers for the Rewards card
  await api.put(ownerA, '/api/rewards/settings', {
    tiers: [
      { roleId: callRepRole, tier100: { amount: 300 }, tier120: { amount: 500, dayOff: true } },
      { roleId: deliveryRole, tier100: { amount: 250 }, tier120: { amount: 400, dayOff: true } },
    ],
  });
}, 150_000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('call rep leaderboard (F-1104)', () => {
  it('ranks by percent of own target, ties share a rank, no target is listed and not ranked', async () => {
    const res = await board(ownerA, 'call_rep', '2026-10');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'call_rep', period: { key: '2026-10', kind: 'month', label: 'October 2026', from: '2026-10-01', to: '2026-10-31' } });
    const ranked = res.body.rows.filter((r: any) => r.rank !== null);
    expect(ranked.map((r: any) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(ranked.map((r: any) => r.percent)).toEqual([60, 60, 40, 20]);
    expect(new Set(ranked.slice(0, 2).map((r: any) => r.userId))).toEqual(new Set([people.adwoa.id, people.tie.id]));
    expect(rowOf(res.body, people.agent.id).rank).toBe(3);
    expect(rowOf(res.body, people.nana.id).rank).toBe(4);
    const none = rowOf(res.body, people.none.id);
    expect(none).toMatchObject({ rank: null, ranked: false, percent: null, reason: 'Set a target' });
    expect(res.body.rows[res.body.rows.length - 1].userId).toBe(people.none.id); // not ranked go last
  });

  it('row columns: of target (percent and counts), confirmed, confirmation rate, delivered from confirmed', async () => {
    const res = await board(ownerA, 'call_rep', '2026-10');
    const adwoa = rowOf(res.body, people.adwoa.id);
    expect(adwoa).toMatchObject({ target: '10.00', actual: 6, percent: 60, delivered: 6, confirmed: 12, kind: 'person', roleName: 'Call rep' });
    expect(adwoa.deliveredFromConfirmed).toBe(50); // 6 delivered of 12 closed confirmed orders
    expect(adwoa.confirmationRate).toBe(100);
  });

  it('an AI agent ranks under the role it holds, with its kind, and no payout', async () => {
    const res = await board(ownerA, 'call_rep', '2026-10');
    const agent = rowOf(res.body, people.agent.id);
    expect(agent).toMatchObject({ kind: 'ai_agent', payout: false, rank: 3, reward: null, distance: null });
    expect(agent.message).toContain('No payout');
  });

  it('a month shows tiers, distance to the next tier and the rewards card; no 80 percent tier text anywhere', async () => {
    const res = await board(ownerA, 'call_rep', '2026-10');
    expect(res.body.rewards.tiers.find((t: any) => t.roleId === callRepRole)).toMatchObject({ tier100: { amount: '300.00' }, tier120: { amount: '500.00', dayOff: true } });
    expect(res.body.rewards.noPayout).toEqual(['ai_agent', 'company']);
    const adwoa = rowOf(res.body, people.adwoa.id);
    expect(adwoa.tier).toBe('none');
    expect(adwoa.distance).toMatchObject({ next: '100', amount: 4 });
    expect(adwoa.message).toContain('4 more confirmed orders');
    expect(JSON.stringify(res.body)).not.toMatch(/80\s?%|80 percent|airtime/i);
  });
});

describe('delivery leaderboard (F-1105)', () => {
  it('ranks by success against the success target; closed orders only; ties share a rank; Too early is not ranked', async () => {
    const res = await board(ownerA, 'delivery', '2026-10');
    expect(res.status).toBe(200);
    const esi = rowOf(res.body, people.esi.id);
    expect(esi).toMatchObject({ percent: 91.6, success: 55, delivered: 11, closed: 20, target: '60.00' });
    const kofi = rowOf(res.body, people.kofi.id);
    const kwesi = rowOf(res.body, people.kwesi.id);
    // Kofi: 10 of 18 closed = 55.5% (55.5 / 60 = 92.5) beats Esi and Kwesi, who tie on 55% (91.6): ranks 1, 2, 2, then 4
    expect(kofi).toMatchObject({ rank: 1, success: 55.5, delivered: 10, closed: 18 });
    expect(esi.rank).toBe(2);
    expect(kwesi).toMatchObject({ rank: 2, success: 55, closed: 20 });
    const logi = rowOf(res.body, people.logiswift.id);
    expect(logi).toMatchObject({ kind: 'company', rank: 4, percent: 75, success: 45, payout: false });
    const kasapa = rowOf(res.body, people.kasapa.id);
    expect(kasapa).toMatchObject({ rank: null, ranked: false, reason: 'Too early', success: null, closed: 0 });
    // all five holders are listed
    expect(res.body.rows).toHaveLength(5);
  });

  it('days to pay is the average gap from delivery to cash of the paid orders', async () => {
    const res = await board(ownerA, 'delivery', '2026-10');
    expect(rowOf(res.body, people.kofi.id).daysToPay).toBe(2);
    expect(rowOf(res.body, people.esi.id).daysToPay).toBeNull();
  });

  it('a company below 80 percent of its target is flagged for contract review, with no payout and no 80% tier', async () => {
    const res = await board(ownerA, 'delivery', '2026-10');
    const logi = rowOf(res.body, people.logiswift.id);
    expect(logi.flag).toBe('contract_review');
    expect(logi.reward).toBeNull();
    expect(logi.distance).toBeNull();
    expect(rowOf(res.body, people.esi.id).flag).toBeNull();
    expect(rowOf(res.body, people.kasapa.id).flag).toBeNull(); // too early: nothing to judge
    expect(res.body.rewards.tiers.find((t: any) => t.roleId === deliveryRole)).toMatchObject({ tier100: { amount: '250.00' }, tier120: { amount: '400.00' } });
    expect(JSON.stringify(res.body)).not.toMatch(/80\s?%|80 percent/i);
  });

  it('a person under the target shows the distance in deliveries with no failure', async () => {
    const res = await board(ownerA, 'delivery', '2026-10');
    expect(rowOf(res.body, people.kwesi.id).distance.message).toMatch(/more deliveries with no failure to reach 100%/);
  });
});

describe('period select (F-1107)', () => {
  it('today, week, month and year each reload the data; rewards, flags and badges are for month and year only', async () => {
    const nov = { start: new Date('2026-11-01'), end: new Date('2026-11-30') };
    const dec = { start: new Date('2026-12-01'), end: new Date('2026-12-31') };
    const now = new Date();
    const thisMonth = { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)) };
    void nov; void dec;
    // a rep with a target this month and two orders delivered today
    const today = await w.user('today', 'sales_rep', 'person', callRepRole);
    await w.target(today.id, callRepRole, thisMonth, 'confirmed_delivered', 31);
    await w.repDelivered(today.id, 2, now.toISOString());

    const day = await board(ownerA, 'call_rep', 'today');
    expect(day.status).toBe(200);
    expect(day.body.period).toMatchObject({ kind: 'today', label: 'Today' });
    const row = rowOf(day.body, today.id);
    expect(row).toMatchObject({ rank: 1, actual: 2 });
    expect(day.body.rewards).toBeNull();
    for (const key of ['tier', 'reward', 'distance', 'message', 'flag', 'badges']) expect(row).not.toHaveProperty(key);
    expect(day.body.note).toMatch(/Early in this period/); // 2 events

    const week = await board(ownerA, 'call_rep', 'week');
    expect(rowOf(week.body, today.id).actual).toBe(2);
    expect(week.body.rewards).toBeNull();

    const month = await board(ownerA, 'call_rep', 'month');
    expect(month.body.period.kind).toBe('month');
    const monthRow = rowOf(month.body, today.id);
    expect(monthRow).toMatchObject({ actual: 2, target: '31.00' });
    expect(monthRow).toHaveProperty('tier');
    expect(month.body.note).toBeNull();

    const year = await board(ownerA, 'call_rep', 'year');
    expect(year.body.period).toMatchObject({ kind: 'year', label: String(now.getUTCFullYear()) });
    expect(rowOf(year.body, today.id).actual).toBe(2);
    expect(year.body.rewards).not.toBeNull();

    // the period changes the data: October holds none of today's orders
    const oct = await board(ownerA, 'call_rep', '2026-10');
    expect(rowOf(oct.body, today.id)).toMatchObject({ actual: 0 });
    // the same person in different periods has a different number
    expect(rowOf(day.body, today.id).actual).not.toBe(rowOf(oct.body, today.id).actual);
  });

  it('a day with nothing in it says so; a bad period is 400', async () => {
    const res = await board(pair.b.users.admin.token, 'call_rep', 'today');
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.note).toMatch(/No orders/);
    expect((await board(ownerA, 'call_rep', '2026-13')).status).toBe(400);
    expect((await board(ownerA, 'call_rep', 'yesterday')).status).toBe(400);
    expect((await api.get(ownerA, '/api/leaderboard?role=boss')).status).toBe(400);
    expect((await api.get(ownerA, '/api/leaderboard')).status).toBe(400);
  });

  it('the year target is the sum of the monthly targets', async () => {
    const res = await board(ownerA, 'call_rep', 'year');
    // Adwoa has only an October target of 10 this year: the year target is 10 and her actual 6
    expect(rowOf(res.body, people.adwoa.id)).toMatchObject({ target: '10.00', actual: 6, percent: 60 });
  });
});

describe('who sees what', () => {
  it('needs a login; the Owner and an admin see every row; a rep sees only their own row with their own rank', async () => {
    expect((await request(app).get('/api/leaderboard?role=call_rep')).status).toBe(401);
    expect((await board(pair.a.users.admin.token, 'call_rep', '2026-10')).body.rows.length).toBeGreaterThanOrEqual(5);
    const own = await board(people.nana.token, 'call_rep', '2026-10');
    expect(own.status).toBe(200);
    expect(own.body.rows).toHaveLength(1);
    expect(own.body.rows[0]).toMatchObject({ userId: people.nana.id, rank: 4 });
    // a rep asking for the delivery board has no row there
    expect((await board(people.nana.token, 'delivery', '2026-10')).body.rows).toEqual([]);
  });

  it('a delivery agent sees only their own row and rank', async () => {
    const own = await board(people.esi.token, 'delivery', '2026-10');
    expect(own.body.rows).toHaveLength(1);
    expect(own.body.rows[0]).toMatchObject({ userId: people.esi.id, rank: 2 });
  });

  it('two tenants: tenant B sees none of tenant A', async () => {
    const b = await board(ownerB, 'call_rep', '2026-10');
    expect(b.body.rows).toEqual([]);
    expect(JSON.stringify(b.body)).not.toContain(String(people.adwoa.id));
    expect((await board(ownerB, 'delivery', '2026-10')).body.rows).toEqual([]);
  });
});

describe('reward progress (F-1108)', () => {
  it('GET /api/rewards/progress is the attainment row of one person; a person sees their own, the Owner anyone', async () => {
    const own = await api.get(people.adwoa.token, '/api/rewards/progress?period=2026-10');
    expect(own.status).toBe(200);
    expect(own.body.results).toHaveLength(1);
    expect(own.body.results[0]).toMatchObject({ userId: people.adwoa.id, percent: 60 });
    expect(own.body.results[0].distance.message).toContain('more confirmed orders');
    expect((await api.get(people.adwoa.token, `/api/rewards/progress?period=2026-10&userId=${people.nana.id}`)).status).toBe(403);
    const asOwner = await api.get(ownerA, `/api/rewards/progress?period=2026-10&userId=${people.nana.id}`);
    expect(asOwner.body.results[0]).toMatchObject({ userId: people.nana.id, percent: 20 });
  });
});

// ---- Badges: an own tenant so the ranks are what the test says ------------------------------------------------------------

describe('badges (F-1109)', () => {
  let tenantId: string;
  let ownerToken: string;
  let who: Record<string, Awaited<ReturnType<ReturnType<typeof world>['user']>>> = {};
  let b: ReturnType<typeof world>;
  let callRole: number;
  let delRole: number;

  beforeAll(async () => {
    tenantId = (await createTenant('m6badges')).id;
    await seedTenantDefaults(tenantId);
    ownerToken = await superAdminToken(tenantId, `badges-${SUFFIX}`, 'bo');
    callRole = (await prismaBase.role.findFirstOrThrow({ where: { tenantId, name: 'Call rep' } })).id;
    delRole = (await prismaBase.role.findFirstOrThrow({ where: { tenantId, name: 'Delivery' } })).id;
    const customer = await prismaBase.customer.create({ data: { tenantId, firstName: 'Bad', lastName: 'Ges', phoneNumber: `+23324${String(SUFFIX).slice(-7)}`, address: 'x', state: 'Greater Accra', area: 'Accra' } });
    b = world(tenantId, () => customer.id, () => callRole, () => delRole);

    // Streaker: 2 of 2 in August and September, 5 of 2 in October (250 percent): Top of month, Beat by 20, Hit 3 months running.
    who.streaker = await b.user('streaker', 'sales_rep', 'person', callRole);
    // Plain: 1 of 2 each month (50 percent).
    who.plain = await b.user('plain', 'sales_rep', 'person', callRole);
    for (const [month, window, day] of [['aug', AUG, '2026-08-12'], ['sep', SEP, '2026-09-12'], ['oct', OCT, '2026-10-12']] as const) {
      void month;
      await b.target(who.streaker.id, callRole, window, 'confirmed_delivered', 2);
      await b.target(who.plain.id, callRole, window, 'confirmed_delivered', 2);
      await b.repDelivered(who.streaker.id, month === 'oct' ? 5 : 2, `${day}T10:00:00Z`);
      await b.repDelivered(who.plain.id, 1, `${day}T10:00:00Z`);
    }
    // Delivery: Prompt has closed orders and no unpaid delivered order; Slow has one delivered Oct 5 whose cash was never collected.
    who.prompt = await b.user('prompt', 'delivery_agent', 'person', delRole);
    who.slow = await b.user('slow', 'delivery_agent', 'company', delRole);
    for (const p of [who.prompt, who.slow]) await b.target(p.id, delRole, OCT, 'delivery_success_rate', 60);
    await b.closed(who.prompt.id, 3, 'delivered', '2026-10-10T10:00:00Z');
    const [late] = await b.closed(who.slow.id, 3, 'delivered', '2026-10-05T10:00:00Z');
    await prismaBase.agentCollection.create({ data: { tenantId, orderId: late.id, agentId: who.slow.id, amount: '10', status: 'draft', collectionDate: new Date('2026-10-05T10:00:00Z') } });
  }, 120_000);

  afterAll(async () => { await deleteTenantRows([tenantId]); });

  const award = (period: string) => runInTenant(tenantId, () => awardMonthBadges(period));
  const heldBy = async (userId: number) =>
    (await prismaBase.badgeAward.findMany({ where: { tenantId, userId }, orderBy: { key: 'asc' } })).map((a) => `${a.key}@${a.period}`);

  it('awards Top of month, Beat by 20 percent, Hit target 3 months running and Zero unpaid over 8 days from the month numbers', async () => {
    const result = await award('2026-10');
    expect(await heldBy(who.streaker.id)).toEqual(['beat_target_20@2026-10', 'hit_target_3_months@2026-10', 'top_of_month@2026-10']);
    expect(await heldBy(who.plain.id)).toEqual([]);
    // Prompt: best delivery success, no late unpaid; Slow: the unpaid order is over 8 days old
    expect(await heldBy(who.prompt.id)).toEqual(expect.arrayContaining(['zero_unpaid_8_days@2026-10']));
    expect(await heldBy(who.slow.id)).not.toContain('zero_unpaid_8_days@2026-10');
    expect(result.byKey.top_of_month).toBeGreaterThanOrEqual(1);
  });

  it('a badge is never awarded twice for one period: a second run adds nothing', async () => {
    const before = await prismaBase.badgeAward.count({ where: { tenantId } });
    const again = await award('2026-10');
    expect(again.awarded).toBe(0);
    expect(await prismaBase.badgeAward.count({ where: { tenantId } })).toBe(before);
    // the unique key also refuses a direct duplicate
    await expect(prismaBase.badgeAward.create({ data: { tenantId, userId: who.streaker.id, key: 'top_of_month', period: '2026-10' } })).rejects.toThrow();
  });

  it('a different month awards on its own numbers: the streak needs three months', async () => {
    await award('2026-09'); // only Aug and Sep history: no streak
    const sep = await heldBy(who.streaker.id);
    expect(sep).toContain('top_of_month@2026-09');
    expect(sep).not.toContain('hit_target_3_months@2026-09');
    expect(await heldBy(who.plain.id)).toEqual([]);
  });

  it('GET /api/badges lists every badge with holders and month, or "Locked, no one yet"; filters by user and period', async () => {
    const all = await api.get(ownerToken, '/api/badges');
    expect(all.status).toBe(200);
    expect(all.body.display).toBe(true);
    const byKey = Object.fromEntries(all.body.badges.map((x: any) => [x.key, x]));
    expect(Object.keys(byKey).sort()).toEqual(['beat_target_20', 'hit_target_3_months', 'top_of_month', 'zero_unpaid_8_days']);
    expect(byKey.beat_target_20.holders).toEqual(expect.arrayContaining([expect.objectContaining({ userId: who.streaker.id, period: '2026-10', kind: 'person' })]));
    expect(byKey.top_of_month.holders.map((h: any) => h.userId)).toContain(who.streaker.id);
    expect(byKey.beat_target_20.locked).toBe(false);
    const sep = await api.get(ownerToken, '/api/badges?period=2026-09');
    const sepByKey = Object.fromEntries(sep.body.badges.map((x: any) => [x.key, x]));
    expect(sepByKey.beat_target_20.holders).toEqual([]);
    expect(sepByKey.beat_target_20).toMatchObject({ locked: true, message: 'Locked, no one yet' });
    const mine = await api.get(ownerToken, `/api/badges?userId=${who.plain.id}`);
    expect(mine.body.badges.every((x: any) => x.locked)).toBe(true);
  });

  it('a person sees only their own badges; the leaderboard row of a month carries the badges of that month', async () => {
    const own = await api.get(who.streaker.token, `/api/badges?userId=${who.plain.id}`); // asks for someone else: gets their own
    const heldKeys = own.body.badges.filter((x: any) => !x.locked).map((x: any) => x.key).sort();
    expect(heldKeys).toEqual(['beat_target_20', 'hit_target_3_months', 'top_of_month']);
    expect(own.body.badges.flatMap((x: any) => x.holders).every((h: any) => h.userId === who.streaker.id)).toBe(true);

    const res = await board(ownerToken, 'call_rep', '2026-10');
    const streaker = rowOf(res.body, who.streaker.id);
    expect(streaker.rank).toBe(1);
    expect(streaker.badges.map((x: any) => x.key).sort()).toEqual(['beat_target_20', 'hit_target_3_months', 'top_of_month']);
    expect(streaker.tier).toBe('120');
    expect(streaker.message).toContain('Top tier reached');
    expect(rowOf(res.body, who.plain.id).badges).toEqual([]);
  });

  it('with the badge display switched off the list and the rows carry none', async () => {
    await runInTenant(tenantId, async () => {
      const { mergeFeatureKey } = await import('../../services/tenantFeatures');
      const { default: prisma } = await import('../../utils/prisma');
      await mergeFeatureKey(prisma as never, 'rewards', { badgesDisplay: false } as never);
    });
    const { clearTenantFeaturesCache } = await import('../../services/tenantFeatures');
    clearTenantFeaturesCache(tenantId);
    const list = await api.get(ownerToken, '/api/badges');
    expect(list.body).toEqual({ display: false, badges: [] });
    expect(rowOf((await board(ownerToken, 'call_rep', '2026-10')).body, who.streaker.id).badges).toEqual([]);
  });

  it('is read only: there is no write route for badges', async () => {
    expect((await request(app).post('/api/badges').set(bearer(ownerToken)).send({ key: 'top_of_month' })).status).toBe(404);
  });
});
