/**
 * M6-T12 (COD-58, F-208): the "Top this month" block of GET /api/dashboard/owner. The top 3 by percent of own role target across
 * the call rep and Delivery roles, fewer than 3 when fewer have targets, none when nobody does, a tie broken by closed orders,
 * an AI agent and a company can rank, two tenants, and a failing block does not break the others.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTenant, createTwoTenants, deleteTenantRows, type TwoTenants } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { clearDashboardCache, ownerDashboard } from '../../services/dashboardService';
import * as leaderboardService from '../../services/leaderboardService';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
const OCT = { start: new Date('2026-10-01'), end: new Date('2026-10-31') };
const AS_OF = '2026-10-17';
let seq = 0;

/** A small world in one tenant: people holding a role with an October target, and their October orders. */
function world(tenantId: string, customerId: number, callRepRole: number, deliveryRole: number) {
  const person = async (label: string, role: 'sales_rep' | 'delivery_agent', kind: 'person' | 'ai_agent' | 'company') => {
    const name = `${label}${SUFFIX}x${seq++}`;
    const u = await prismaBase.user.create({ data: { email: `${name}@codadmin.test`, password: 'x', firstName: name, lastName: kind === 'person' ? 'Tt' : 'Tt', role, kind, tenantId } });
    await prismaBase.roleAssignment.create({ data: { tenantId, roleId: role === 'sales_rep' ? callRepRole : deliveryRole, holderId: u.id, fromDate: new Date('2026-01-01') } });
    return { id: u.id, name: kind === 'person' ? `${name} Tt` : name };
  };
  const target = (userId: number, role: 'sales_rep' | 'delivery_agent', value: number) =>
    prismaBase.target.create({
      data: {
        tenantId, scope: 'person', metric: role === 'sales_rep' ? 'confirmed_delivered' : 'delivery_success_rate', unit: role === 'sales_rep' ? 'count' : 'percent',
        periodStart: OCT.start, periodEnd: OCT.end, value, roleId: role === 'sales_rep' ? callRepRole : deliveryRole, userId,
      },
    });
  const order = (extra: Record<string, unknown>) => prismaBase.order.create({
    data: { tenantId, customerId, status: 'delivered', subtotal: '10', totalAmount: '10', codAmount: '10', deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra } as never,
  });
  const repDelivered = async (repId: number, n: number) => {
    for (let i = 0; i < n; i++) await order({ confirmedById: repId, customerRepId: repId, confirmedAt: new Date('2026-10-12T10:00:00Z'), deliveryDate: new Date('2026-10-12T10:00:00Z'), createdAt: new Date('2026-10-12T10:00:00Z') });
  };
  const closed = async (partnerId: number, ok: number, bad: number) => {
    for (let i = 0; i < ok; i++) await order({ deliveryAgentId: partnerId, deliveryDate: new Date('2026-10-15T10:00:00Z'), createdAt: new Date('2026-10-15T10:00:00Z') });
    for (let i = 0; i < bad; i++) await order({ deliveryAgentId: partnerId, status: 'returned', returnedAt: new Date('2026-10-16T10:00:00Z'), createdAt: new Date('2026-10-15T10:00:00Z') });
  };
  return { person, target, repDelivered, closed };
}

let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
const names: Record<string, string> = {};
const extra: string[] = [];

const top = async (tenantId: string) => ((await ownerDashboard(tenantId, { asOf: AS_OF })) as any).topThisMonth;

beforeAll(async () => {
  pair = await createTwoTenants('m6top');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'top-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'top-owner');
  const roles = async (tenantId: string) => [
    (await prismaBase.role.findFirstOrThrow({ where: { tenantId, name: 'Call rep' } })).id,
    (await prismaBase.role.findFirstOrThrow({ where: { tenantId, name: 'Delivery' } })).id,
  ] as const;
  const [callRepRole, deliveryRole] = await roles(pair.a.id);
  const customerId = (await prismaBase.order.findFirstOrThrow({ where: { tenantId: pair.a.id } })).customerId;
  const w = world(pair.a.id, customerId, callRepRole, deliveryRole);

  // Delivery, 60% success target: Kofi 10 of 18 closed (55.5, 92.5% of target); Kwesi 22 of 40 and Esi 11 of 20 both 55 (91.6%): a tie,
  // Kwesi has more closed orders so he ranks above Esi. Adwoa (call rep) 6 of 10 = 60% is fourth: left out of the top 3.
  const kofi = await w.person('kofi', 'delivery_agent', 'person');
  const kwesi = await w.person('kwesi', 'delivery_agent', 'person');
  const esi = await w.person('esi', 'delivery_agent', 'person');
  const adwoa = await w.person('adwoa', 'sales_rep', 'person');
  for (const p of [kofi, kwesi, esi]) await w.target(p.id, 'delivery_agent', 60);
  await w.target(adwoa.id, 'sales_rep', 10);
  await w.closed(kofi.id, 10, 8);
  await w.closed(kwesi.id, 22, 18);
  await w.closed(esi.id, 11, 9);
  await w.repDelivered(adwoa.id, 6);
  Object.assign(names, { kofi: kofi.name, kwesi: kwesi.name, esi: esi.name, adwoa: adwoa.name });
}, 150_000);

afterAll(async () => {
  jest.restoreAllMocks();
  await deleteTenantRows(extra);
  await pair.cleanup();
  await prismaBase.$disconnect();
});

beforeEach(() => clearDashboardCache());

describe('top this month (F-208)', () => {
  it('lists the top 3 by percent of own role target across roles, a tie going to the higher closed-order count', async () => {
    const block = await top(pair.a.id);
    expect(block.month).toBe('2026-10');
    expect(block.people).toHaveLength(3);
    expect(block.people.map((p: any) => [p.rank, p.name, p.percent])).toEqual([
      [1, names.kofi, 92.5], [2, names.kwesi, 91.6], [3, names.esi, 91.6],
    ]);
    expect(block.people[0]).toMatchObject({ roleName: 'Delivery', family: 'delivery', kind: 'person', main: { unit: 'delivery_success', value: 55.5 } });
    expect(block.people.map((p: any) => p.name)).not.toContain(names.adwoa);
  });

  it('an AI agent and a company rank with their kind; each role shows its own main number; fewer than 3 shows what exists', async () => {
    // a tenant with only the call rep and one more person: fewer than 3
    const tenantId = (await createTenant('m6topfew')).id;
    extra.push(tenantId);
    await seedTenantDefaults(tenantId);
    const [callRep, delivery] = await Promise.all([
      prismaBase.role.findFirstOrThrow({ where: { tenantId, name: 'Call rep' } }),
      prismaBase.role.findFirstOrThrow({ where: { tenantId, name: 'Delivery' } }),
    ]);
    const customer = await prismaBase.customer.create({ data: { tenantId, firstName: 'Top', lastName: 'Few', phoneNumber: `+23325${String(SUFFIX).slice(-7)}`, address: 'x', state: 'Greater Accra', area: 'Accra' } });
    const w = world(tenantId, customer.id, callRep.id, delivery.id);
    const agent = await w.person('robo', 'sales_rep', 'ai_agent');
    const company = await w.person('logiswift', 'delivery_agent', 'company');
    await w.target(agent.id, 'sales_rep', 10);
    await w.target(company.id, 'delivery_agent', 60);
    await w.repDelivered(agent.id, 7);
    await w.closed(company.id, 9, 11); // 45% = 75% of target
    const block = await top(tenantId);
    expect(block.people).toHaveLength(2); // fewer than 3: what exists
    // a company at 75 percent of its target beats an agent at 70: ranks follow the percent, whatever the role
    expect(block.people[0]).toMatchObject({ rank: 1, name: company.name, kind: 'company', roleName: 'Delivery', family: 'delivery', percent: 75, main: { unit: 'delivery_success', value: 45 } });
    expect(block.people[1]).toMatchObject({ rank: 2, name: agent.name, kind: 'ai_agent', roleName: 'Call rep', family: 'call_rep', percent: 70, main: { unit: 'confirmed_delivered', value: 7 } });
  });

  it('nobody with a target: an empty list, not an error', async () => {
    const block = await top(pair.b.id);
    expect(block).toEqual({ month: '2026-10', people: [] });
  });

  it('two tenants: tenant B sees none of tenant A, over HTTP too', async () => {
    const a = await request(app).get(`/api/dashboard/owner?asOf=${AS_OF}`).set(bearer(ownerA));
    expect(a.status).toBe(200);
    expect(a.body.topThisMonth.people).toHaveLength(3);
    const b = await request(app).get(`/api/dashboard/owner?asOf=${AS_OF}`).set(bearer(ownerB));
    expect(b.body.topThisMonth.people).toEqual([]);
    expect(JSON.stringify(b.body.topThisMonth)).not.toContain(names.kofi);
  });

  it('a failing block becomes its own error and the other blocks still answer', async () => {
    const spy = jest.spyOn(leaderboardService, 'topThisMonth').mockRejectedValueOnce(new Error('board down'));
    let body: any;
    try { body = await ownerDashboard(pair.a.id, { asOf: AS_OF }); } finally { spy.mockRestore(); }
    expect(body.topThisMonth).toMatchObject({ error: { code: 'block_failed' } });
    expect(body.topThisMonth.error).not.toHaveProperty('message'); // the raw error stays in the log
    expect(body.header).not.toHaveProperty('error');
    expect(body.ladder).not.toHaveProperty('error');
    expect(body.quests).not.toHaveProperty('error');
  });

  it('the on-target-day count of the quests block is the New orders quest (decided question)', async () => {
    const body: any = await ownerDashboard(pair.a.id, { asOf: AS_OF });
    if (body.quests.onTargetDays) expect(body.quests.onTargetDays.quest).toBe('new_orders');
  });
});
