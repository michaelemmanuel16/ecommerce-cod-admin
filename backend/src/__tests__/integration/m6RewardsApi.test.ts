/**
 * M6-T09 (COD-58): rewards settings and attainment. Tier order check, tiers by role saved and read back, rep pay, attainment on
 * delivery-date numbers (confirmed in one month, delivered in the next), top tier, no target, AI agent, tenant isolation,
 * permissions.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { generateAccessToken } from '../../utils/jwt';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { getRepPay } from '../../services/rewardService';
import { rates, outcomesByPartner, deliveredByRep } from '../../services/kpi/rates';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let callRepRole: { id: number };
let deliveryRole: { id: number };
let customerId: number;
let seq = 0;

const api = {
  get: (token: string, url: string) => request(app).get(url).set(bearer(token)),
  put: (token: string, url: string, body: object = {}) => request(app).put(url).set(bearer(token)).send(body),
};
const OCT = { start: new Date('2026-10-01'), end: new Date('2026-10-31') };
const SEP = { start: new Date('2026-09-01'), end: new Date('2026-09-30') };

async function mkUser(label: string, role: 'sales_rep' | 'delivery_agent', extra: Record<string, unknown> = {}) {
  const name = `${label}${SUFFIX}x${seq++}`;
  const u = await prismaBase.user.create({
    data: { email: `${name}@codadmin.test`, password: await bcrypt.hash('Passw0rd!rw', 4), firstName: name, lastName: 'Rw', role, tenantId: pair.a.id, ...extra },
  });
  return { ...u, name: `${name} Rw`, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId: pair.a.id }) };
}
const hold = (userId: number, roleId: number) =>
  prismaBase.roleAssignment.create({ data: { tenantId: pair.a.id, roleId, holderId: userId, fromDate: new Date('2026-01-01') } });
const personTarget = (userId: number, roleId: number, month: { start: Date; end: Date }, metric: string, value: number, unit = 'count') =>
  prismaBase.target.create({ data: { tenantId: pair.a.id, scope: 'person', metric, unit, periodStart: month.start, periodEnd: month.end, value, roleId, userId } });
const monthTarget = (month: { start: Date; end: Date }, closedAt: Date | null = null) =>
  prismaBase.target.create({ data: { tenantId: pair.a.id, scope: 'month', metric: 'revenue', unit: 'currency', periodStart: month.start, periodEnd: month.end, value: 1000, closedAt } });
const order = (extra: Record<string, unknown>) => prismaBase.order.create({
  data: {
    tenantId: pair.a.id, customerId, status: 'delivered', subtotal: '10', totalAmount: '10', codAmount: '10',
    deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
  } as never,
});
/** `n` orders confirmed by `repId` on `confirmed` and delivered on `delivered`. */
const delivered = async (repId: number, n: number, confirmed: string, deliveredOn: string) => {
  for (let i = 0; i < n; i++) await order({ confirmedById: repId, customerRepId: repId, confirmedAt: new Date(confirmed), deliveryDate: new Date(deliveredOn), createdAt: new Date(confirmed) });
};
const rowOf = (body: { results: Array<{ userId: number }> }, userId: number) => body.results.find((r) => r.userId === userId) as Record<string, any>;
const attain = (token: string, query = '') => api.get(token, `/api/rewards/attainment${query}`);

beforeAll(async () => {
  pair = await createTwoTenants('m6rewards');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'rw-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'rw-owner');
  callRepRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Call rep' } });
  deliveryRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Delivery' } });
  customerId = (await prismaBase.order.findFirstOrThrow({ where: { tenantId: pair.a.id } })).customerId;
}, 90_000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const tiersBody = (roleId: number, a100: number | string, a120: number | string, dayOff = false) =>
  ({ tiers: [{ roleId, tier100: { amount: a100 }, tier120: { amount: a120, dayOff } }] });

describe('permissions', () => {
  it('needs a login; a rep cannot read or write settings; an admin reads but does not write; the Owner does both', async () => {
    expect((await request(app).get('/api/rewards/settings')).status).toBe(401);
    expect((await request(app).get('/api/rewards/attainment')).status).toBe(401);
    const rep = pair.a.users.salesRep.token;
    expect((await api.get(rep, '/api/rewards/settings')).status).toBe(403);
    expect((await api.put(rep, '/api/rewards/settings', tiersBody(callRepRole.id, 300, 500))).status).toBe(403);
    expect((await api.get(pair.a.users.admin.token, '/api/rewards/settings')).status).toBe(200);
    expect((await api.put(pair.a.users.admin.token, '/api/rewards/settings', { badgesDisplay: false })).status).toBe(403);
    expect((await api.put(ownerA, '/api/rewards/settings', { badgesDisplay: true })).status).toBe(200);
  });
});

describe('settings', () => {
  it('a fresh tenant reads the default rep pay (GH8, 10%) and no tiers set', async () => {
    const res = await api.get(ownerA, '/api/rewards/settings');
    expect(res.status).toBe(200);
    expect(res.body.repPay).toEqual({ baseCommission: '8.00', upsellPercent: '10.00' });
    expect(res.body.badgesDisplay).toBe(true);
    expect(res.body.noPayout).toEqual(['ai_agent', 'company']);
    const callRep = res.body.tiers.find((t: { roleId: number }) => t.roleId === callRepRole.id);
    expect(callRep).toMatchObject({ roleName: 'Call rep', tier100: null, tier120: null });
    expect(await runInTenant(pair.a.id, async () => (await getRepPay()).baseCommission.toString())).toBe('8');
  });

  it('a 120% reward below the 100% reward is refused with TIER_ORDER and nothing is saved', async () => {
    const res = await api.put(ownerA, '/api/rewards/settings', { ...tiersBody(callRepRole.id, 300, 299.99), repPay: { baseCommission: 9, upsellPercent: 12 } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TIER_ORDER');
    expect(res.body.message ?? res.body.error).toContain('120%');
    expect(await prismaBase.rewardTier.count({ where: { tenantId: pair.a.id, roleId: callRepRole.id } })).toBe(0);
    expect((await api.get(ownerA, '/api/rewards/settings')).body.repPay.baseCommission).toBe('8.00');
    // equal is allowed
    expect((await api.put(ownerA, '/api/rewards/settings', tiersBody(callRepRole.id, 300, 300))).status).toBe(200);
  });

  it('saves tiers by role and rep pay, and reads them back; a repeat save updates, not duplicates', async () => {
    const res = await api.put(ownerA, '/api/rewards/settings', {
      tiers: [
        { roleId: callRepRole.id, tier100: { amount: '300' }, tier120: { amount: 500, dayOff: true } },
        { roleId: deliveryRole.id, tier100: { amount: 250 }, tier120: { amount: 400, dayOff: true } },
      ],
      repPay: { baseCommission: '8.5', upsellPercent: 11 },
      badgesDisplay: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.notice).toContain('next month close');
    const read = (await api.get(ownerA, '/api/rewards/settings')).body;
    const byRole = (id: number) => read.tiers.find((t: { roleId: number }) => t.roleId === id);
    expect(byRole(callRepRole.id)).toMatchObject({ tier100: { amount: '300.00', dayOff: false, payout: true }, tier120: { amount: '500.00', dayOff: true, payout: true } });
    expect(byRole(deliveryRole.id)).toMatchObject({ tier100: { amount: '250.00' }, tier120: { amount: '400.00', dayOff: true } });
    expect(read.repPay).toEqual({ baseCommission: '8.50', upsellPercent: '11.00' });
    expect(read.badgesDisplay).toBe(false);
    expect(await runInTenant(pair.a.id, async () => (await getRepPay()).upsellPercent.toString())).toBe('11');

    await api.put(ownerA, '/api/rewards/settings', tiersBody(callRepRole.id, 310, 510));
    expect(await prismaBase.rewardTier.count({ where: { tenantId: pair.a.id, roleId: callRepRole.id } })).toBe(2);
    // the rest stays when only tiers are sent
    expect((await api.get(ownerA, '/api/rewards/settings')).body.repPay.baseCommission).toBe('8.50');
    // tiers back to the sample for the attainment tests
    await api.put(ownerA, '/api/rewards/settings', tiersBody(callRepRole.id, 300, 500, true));
    // one audit row per save
    expect(await prismaBase.auditLog.count({ where: { tenantId: pair.a.id, action: 'rewards_settings_update' } })).toBeGreaterThanOrEqual(3);
  });

  it('refuses bad input: unknown role, negative amount, upsell above 100, empty body, unknown key, 80% style extra tier, duplicate role', async () => {
    const t = (roleId: number) => ({ roleId, tier100: { amount: 1 }, tier120: { amount: 2 } });
    expect((await api.put(ownerA, '/api/rewards/settings', { tiers: [t(99999999)] })).status).toBe(404);
    expect((await api.put(ownerA, '/api/rewards/settings', tiersBody(callRepRole.id, -1, 5))).status).toBe(400);
    expect((await api.put(ownerA, '/api/rewards/settings', { repPay: { baseCommission: 8, upsellPercent: 101 } })).status).toBe(400);
    expect((await api.put(ownerA, '/api/rewards/settings', {})).status).toBe(400);
    expect((await api.put(ownerA, '/api/rewards/settings', { tiers: [{ ...t(callRepRole.id), tier80: { amount: 50 } }] })).status).toBe(400);
    expect((await api.put(ownerA, '/api/rewards/settings', { tiers: [t(callRepRole.id), t(callRepRole.id)] })).status).toBe(400);
  });
});

describe('attainment (delivery-date numbers)', () => {
  let top: Awaited<ReturnType<typeof mkUser>>;
  let hit: Awaited<ReturnType<typeof mkUser>>;
  let short: Awaited<ReturnType<typeof mkUser>>;
  let noTarget: Awaited<ReturnType<typeof mkUser>>;
  let agent: Awaited<ReturnType<typeof mkUser>>;
  let ai: { id: number; name: string };
  let partner: Awaited<ReturnType<typeof mkUser>>;

  beforeAll(async () => {
    [top, hit, short, noTarget] = [await mkUser('top', 'sales_rep'), await mkUser('hit', 'sales_rep'), await mkUser('short', 'sales_rep'), await mkUser('none', 'sales_rep')];
    for (const u of [top, hit, short, noTarget]) await hold(u.id, callRepRole.id);
    await personTarget(top.id, callRepRole.id, OCT, 'confirmed_delivered', 10);
    await personTarget(hit.id, callRepRole.id, OCT, 'confirmed_delivered', 10);
    await personTarget(short.id, callRepRole.id, OCT, 'confirmed_delivered', 10);
    // Confirmed in September, delivered in October: they count in October, not in September.
    await delivered(top.id, 12, '2026-09-28T10:00:00Z', '2026-10-05T10:00:00Z');
    await delivered(top.id, 3, '2026-09-10T10:00:00Z', '2026-09-20T10:00:00Z'); // delivered in September
    await delivered(top.id, 2, '2026-10-20T10:00:00Z', '2026-11-03T10:00:00Z'); // delivered in November
    await delivered(hit.id, 10, '2026-10-02T10:00:00Z', '2026-10-08T10:00:00Z');
    await delivered(short.id, 9, '2026-10-02T10:00:00Z', '2026-10-08T10:00:00Z');
    await order({ confirmedById: short.id, status: 'confirmed', confirmedAt: new Date('2026-10-09T10:00:00Z') }); // not delivered: no count

    // An AI agent holding the Call rep role, with 12 delivered orders against a target of 10.
    const aiUser = await prismaBase.user.create({
      data: { email: `rw-ai-${SUFFIX}@codadmin.test`, password: '!', firstName: 'Robo', lastName: 'Rep', role: 'sales_rep', kind: 'ai_agent', tenantId: pair.a.id },
    });
    ai = { id: aiUser.id, name: 'Robo Rep' };
    await hold(aiUser.id, callRepRole.id);
    await personTarget(aiUser.id, callRepRole.id, OCT, 'confirmed_delivered', 10);
    await delivered(aiUser.id, 12, '2026-10-02T10:00:00Z', '2026-10-09T10:00:00Z');

    // A delivery partner: target 60 percent success; 3 delivered and 2 returned in October = 60 percent.
    partner = await mkUser('part', 'delivery_agent');
    await hold(partner.id, deliveryRole.id);
    await personTarget(partner.id, deliveryRole.id, OCT, 'delivery_success_rate', 60, 'percent');
    for (let i = 0; i < 3; i++) await order({ deliveryAgentId: partner.id, deliveryDate: new Date('2026-10-12T10:00:00Z') });
    for (let i = 0; i < 2; i++) await order({ deliveryAgentId: partner.id, status: 'returned', returnedAt: new Date('2026-10-13T10:00:00Z') });

    agent = await mkUser('noagent', 'delivery_agent'); // holds Delivery, no target
    await hold(agent.id, deliveryRole.id);
  });

  it('counts orders confirmed in one month and delivered in the next in the delivery month', async () => {
    const oct = await attain(ownerA, '?period=2026-10');
    expect(oct.status).toBe(200);
    expect(rowOf(oct.body, top.id)).toMatchObject({ actual: 12, target: '10.00' });
    const sep = await attain(ownerA, '?period=2026-09');
    // top has no September target: still listed through the role, with the warning, but the delivery-date count is not read
    expect(rowOf(sep.body, top.id).warning).toBe('Set a target');
    await personTarget(top.id, callRepRole.id, SEP, 'confirmed_delivered', 3);
    const sepAgain = await attain(ownerA, '?period=2026-09');
    expect(rowOf(sepAgain.body, top.id)).toMatchObject({ actual: 3, percent: 100, tier: '100' });
    const nov = await attain(ownerA, `?period=2026-11&userId=${top.id}`);
    expect(rowOf(nov.body, top.id).warning).toBe('Set a target');
  });

  it('above 120 percent: Top tier reached, the 120 reward only (not both), with the day off', async () => {
    const row = rowOf((await attain(ownerA, '?period=2026-10')).body, top.id);
    expect(row).toMatchObject({ percent: 120, tier: '120', payout: true, reward: { amount: '500.00', dayOff: true }, distance: null, earned: false });
    expect(row.message).toContain('Top tier reached');
    expect(row.message).toContain('On track to earn');
    expect(row.message).toContain('500');
    expect(row.message).toContain('at month close');
  });

  it('exactly 100 percent earns the 100 reward and shows the distance to 120; just below earns nothing', async () => {
    const body = (await attain(ownerA, '?period=2026-10')).body;
    expect(rowOf(body, hit.id)).toMatchObject({ percent: 100, tier: '100', reward: { amount: '300.00', dayOff: false } });
    expect(rowOf(body, hit.id).distance).toMatchObject({ next: '120', amount: 2 });
    expect(rowOf(body, short.id)).toMatchObject({ actual: 9, percent: 90, tier: 'none', reward: null });
    expect(rowOf(body, short.id).distance).toMatchObject({ next: '100', amount: 1 });
    expect(rowOf(body, short.id).message).toContain('1 more confirmed orders');
  });

  it('no target set: no reward and a "Set a target" warning', async () => {
    const row = rowOf((await attain(ownerA, '?period=2026-10')).body, noTarget.id);
    expect(row).toMatchObject({ target: null, reward: null, tier: 'none', warning: 'Set a target' });
    expect(rowOf((await attain(ownerA, '?period=2026-10')).body, agent.id).warning).toBe('Set a target');
  });

  it('an AI agent shows attainment and gets no payout', async () => {
    const row = rowOf((await attain(ownerA, '?period=2026-10')).body, ai.id);
    expect(row).toMatchObject({ kind: 'ai_agent', actual: 12, percent: 120, tier: '120', payout: false, reward: null, distance: null });
    expect(row.message).toContain('No payout');
  });

  it('a delivery partner is judged on the success rate against the success target', async () => {
    const row = rowOf((await attain(ownerA, '?period=2026-10')).body, partner.id);
    expect(row).toMatchObject({ actual: 60, percent: 100, tier: '100', reward: { amount: '250.00' } });
    // 72 percent needs 3 more deliveries with no failure (6 of 8)
    expect(row.distance).toMatchObject({ next: '120', amount: 3, unit: 'deliveries with no failure' });
  });

  it('a partner success rate is the number rates() gives for that partner; the batch and the rep count agree with rates()', async () => {
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-11-01T00:00:00Z');
    const viaRates = await rates(pair.a.id, from, to, { basis: 'delivery', partnerId: partner.id });
    const batch = await outcomesByPartner(pair.a.id, from, to, [partner.id, agent.id]);
    expect(batch.get(partner.id)).toEqual({ delivered: viaRates.deliverySuccessRate.detail.delivered, failed: viaRates.deliverySuccessRate.detail.failed, returned: viaRates.deliverySuccessRate.detail.returned });
    expect(batch.has(agent.id)).toBe(false); // no closed orders, not in the map
    const row = rowOf((await attain(ownerA, '?period=2026-10')).body, partner.id);
    expect(row.actual).toBe(viaRates.deliverySuccessRate.value);
    const repViaRates = await rates(pair.a.id, from, to, { basis: 'delivery', repId: top.id });
    expect((await deliveredByRep(pair.a.id, from, to, [top.id])).get(top.id)).toBe(repViaRates.deliverySuccessRate.detail.delivered);
    expect((await deliveredByRep(pair.a.id, from, to)).get(top.id)).toBe(12);
  });

  it('a closed month says Earned instead of On track', async () => {
    await monthTarget(SEP, new Date('2026-10-01T03:00:00Z'));
    const row = rowOf((await attain(ownerA, '?period=2026-09')).body, top.id);
    expect(row).toMatchObject({ tier: '100', earned: true });
    expect(row.message).toContain('Earned');
    expect(row.message).not.toContain('On track');
    const body = (await attain(ownerA, '?period=2026-09')).body;
    expect(body.closed).toBe(true);
  });

  it('a person sees their own rows only; asking for someone else is refused; a filter by role and person works for the Owner', async () => {
    const mine = await attain(top.token, '?period=2026-10');
    expect(mine.status).toBe(200);
    expect(mine.body.results.every((r: { userId: number }) => r.userId === top.id)).toBe(true);
    expect(mine.body.results.length).toBeGreaterThan(0);
    expect((await attain(top.token, `?period=2026-10&userId=${hit.id}`)).status).toBe(403);
    expect((await attain(top.token, `?period=2026-10&userId=${top.id}`)).status).toBe(200);
    const one = await attain(ownerA, `?period=2026-10&userId=${hit.id}`);
    expect(one.body.results.map((r: { userId: number }) => r.userId)).toEqual([hit.id]);
    const byRole = await attain(ownerA, `?period=2026-10&roleId=${deliveryRole.id}`);
    expect(byRole.body.results.every((r: { roleId: number }) => r.roleId === deliveryRole.id)).toBe(true);
  });

  it('refuses a bad period; defaults to the current month; the Owner holder is not listed with a warning', async () => {
    expect((await attain(ownerA, '?period=2026-13')).status).toBe(400);
    expect((await attain(ownerA, '?period=October')).status).toBe(400);
    expect((await attain(ownerA)).status).toBe(200);
    const body = (await attain(ownerA, '?period=2026-10')).body;
    const ownerRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Owner' } });
    expect(body.results.some((r: { roleId: number }) => r.roleId === ownerRole.id)).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('tenant B sees none of A: settings, attainment, and A role ids are 404 for B', async () => {
    const settings = (await api.get(ownerB, '/api/rewards/settings')).body;
    expect(settings.tiers.map((t: { roleId: number }) => t.roleId)).not.toContain(callRepRole.id);
    // A saved Call rep and Delivery tiers; B's roles of those names have none. (The harness seeds one sample tier on B's Owner role.)
    for (const name of ['Call rep', 'Delivery']) {
      expect(settings.tiers.find((t: { roleName: string }) => t.roleName === name)).toMatchObject({ tier100: null, tier120: null });
    }
    const seededB = await prismaBase.rewardTier.findMany({ where: { tenantId: pair.b.id } });
    const shown = settings.tiers.filter((t: { tier100: unknown }) => t.tier100 !== null).map((t: { roleId: number }) => t.roleId);
    expect(shown.sort()).toEqual(seededB.map((r) => r.roleId).sort());
    expect(settings.repPay.baseCommission).toBe('8.00');
    const rolesB = new Set((await prismaBase.role.findMany({ where: { tenantId: pair.b.id }, select: { id: true } })).map((r) => r.id));
    expect(settings.tiers.every((t: { roleId: number }) => rolesB.has(t.roleId))).toBe(true);

    expect((await api.put(ownerB, '/api/rewards/settings', tiersBody(callRepRole.id, 1, 2))).status).toBe(404);
    expect(await prismaBase.rewardTier.count({ where: { tenantId: pair.b.id, roleId: callRepRole.id } })).toBe(0);

    const att = await attain(ownerB, '?period=2026-10');
    expect(att.status).toBe(200);
    const usersA = new Set((await prismaBase.user.findMany({ where: { tenantId: pair.a.id }, select: { id: true } })).map((u) => u.id));
    expect(att.body.results.every((r: { userId: number }) => !usersA.has(r.userId))).toBe(true);
    expect(att.body.results.every((r: { actual: number | null }) => r.actual === null || r.actual === 0)).toBe(true);
    // B's rep pay is its own
    await api.put(ownerB, '/api/rewards/settings', { repPay: { baseCommission: 12, upsellPercent: 5 } });
    expect((await api.get(ownerA, '/api/rewards/settings')).body.repPay.baseCommission).toBe('8.50');
    expect((await api.get(ownerB, '/api/rewards/settings')).body.repPay.baseCommission).toBe('12.00');
  });
});
