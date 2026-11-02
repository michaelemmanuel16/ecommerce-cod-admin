/**
 * M6-T24 (COD-61): the M6 route groups as one sweep, over HTTP, on two tenants.
 *  1. Lists: tenant A never reads a row, name or id of tenant B (roles, staff, targets, rewards, leaderboard, badges).
 *  2. Detail routes: an id of tenant B in a tenant A request is 404, never the row, and nothing of B changes.
 *  3. Permission: a role without the cell is 403 on every route of each group (roles, staff and invites, targets, rewards,
 *     period close, leaderboard); the Owner reads the same routes, so the 403 is the permission and not a dead route.
 *  4. Invite token: used, expired, and a token of tenant B cannot be spent as a person of tenant A.
 * The single-route proofs live in m6RolesApi, m6StaffApi, m6InviteApi, m6Targets*, m6NorthStar, m6RewardsApi, m6Leaderboard
 * and m6PeriodClose; this file closes what they leave open (every :id route, every group, B's token).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { verifyAccessToken } from '../../utils/jwt';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTwoTenants, mkUser, TwoTenants } from './helpers/twoTenants';
import { clearAuthCache } from '../../mcp/auth';
import { clearPermissionsCache } from '../../middleware/auth';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const PASSWORD = 'Passw0rd!secure';
let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let seq = 0;
const mail = (label: string) => `${label}${SUFFIX}x${seq++}@codadmin.test`;
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

type Verb = 'get' | 'post' | 'put' | 'delete';
const call = (verb: Verb, token: string, url: string, body?: object) => {
  const r = request(app)[verb](url).set(bearer(token));
  return body === undefined ? r : r.send(body);
};
const accept = (token: string, password = PASSWORD) => request(app).post('/api/auth/accept-invite').send({ token, password });

/** What tenant B holds that tenant A must never reach. */
const b = {
  role: 0, assignment: 0, quarter: 0, roleTarget: 0, invited: 0, invitedToken: '', person: 0, name: '',
};
const aInvited = { id: 0, token: '' };
let aRole = 0;

beforeAll(async () => {
  pair = await createTwoTenants('m6sec');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'sec-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'sec-owner');

  // Tenant B: a North Star tree, a custom role with a holder, a role target, and an invited person.
  expect((await call('post', ownerB, '/api/targets/north-star', { year: 2026, annual: 1_800_000, mode: 'grow', plannedAov: 249 })).status).toBe(201);
  const role = await call('post', ownerB, '/api/roles', { name: `Secret ${pair.b.marker}` });
  expect(role.status).toBe(201);
  b.role = role.body.role.id;
  const assign = await call('post', ownerB, `/api/roles/${b.role}/assign`, { type: 'existing', holderId: pair.b.users.salesRep.id });
  expect(assign.status).toBe(201);
  b.assignment = assign.body.assignment.id;
  b.person = pair.b.users.salesRep.id;
  expect((await call('post', ownerB, '/api/targets', { scope: 'role', metric: 'revenue', unit: 'money', value: 50_000, period: '2026-11', roleId: b.role })).status).toBe(201);
  b.roleTarget = (await prismaBase.target.findFirstOrThrow({ where: { tenantId: pair.b.id, scope: 'role' } })).id;
  b.quarter = (await prismaBase.target.findFirstOrThrow({ where: { tenantId: pair.b.id, scope: 'quarter' } })).id;
  b.name = `Bea ${pair.b.marker}`;
  const inv = await call('post', ownerB, '/api/staff/invite', { name: b.name, email: mail(`bea${pair.b.marker}`), role: 'sales_rep' });
  expect(inv.status).toBe(201);
  b.invited = inv.body.staff.id;
  b.invitedToken = tokenOf(inv.body.link);

  // Tenant A: a North Star tree (the calculators read a month target), one invited person and its own role, so A's requests run in a tenant that has data.
  expect((await call('post', ownerA, '/api/targets/north-star', { year: 2026, annual: 1_200_000, mode: 'grow', plannedAov: 249 })).status).toBe(201);
  const invA = await call('post', ownerA, '/api/staff/invite', { name: 'Ama Mensah', email: mail('ama'), role: 'sales_rep' });
  expect(invA.status).toBe(201);
  aInvited.id = invA.body.staff.id;
  aInvited.token = tokenOf(invA.body.link);
  aRole = (await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Call rep' } })).id;
}, 120_000);

afterAll(async () => {
  clearAuthCache();
  await pair.cleanup();
  await prismaBase.$disconnect();
});

beforeEach(() => { clearAuthCache(); clearPermissionsCache(); });

describe('lists: tenant A never reads a row of tenant B', () => {
  const lists: Array<[string, string]> = [
    ['roles', '/api/roles'],
    ['roles overview', '/api/roles/overview'],
    ['role assignments (A role)', '/api/roles/__A__/assignments'],
    ['staff, every tab but deleted', '/api/staff'],
    ['staff, invited', '/api/staff?status=invited'],
    ['staff workload', '/api/staff/workload'],
    ['targets tree', '/api/targets/tree?year=2026&month=2026-11'],
    ['targets drivers', '/api/targets/drivers?year=2026'],
    ['rewards settings', '/api/rewards/settings'],
    ['rewards attainment', '/api/rewards/attainment?period=2026-10'],
    ['leaderboard, call rep', '/api/leaderboard?role=call_rep&period=2026-10'],
    ['leaderboard, delivery', '/api/leaderboard?role=delivery&period=2026-10'],
    ['badges', '/api/badges?period=2026-10'],
  ];

  it.each(lists)('%s: none of B\'s names, ids or marker', async (_label, url) => {
    const res = await call('get', ownerA, url.replace('__A__', String(aRole)));
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(pair.b.marker);
    expect(text).not.toContain(b.name);
    // ids of B's role, person and invited person never show as an id field
    for (const key of ['roleId', 'userId', 'holderId', 'id']) {
      const ids = [...text.matchAll(new RegExp(`"${key}":(\\d+)`, 'g'))].map((m) => Number(m[1]));
      expect(ids).not.toContain(b.role);
      expect(ids).not.toContain(b.person);
      expect(ids).not.toContain(b.invited);
    }
  });

  it('the same lists show B its own rows (the checks above are not empty because the routes are empty)', async () => {
    const roles = await call('get', ownerB, '/api/roles');
    expect(roles.body.roles.map((r: { id: number }) => r.id)).toContain(b.role);
    const staff = await call('get', ownerB, '/api/staff?status=invited');
    expect(staff.body.staff.map((s: { id: number }) => s.id)).toContain(b.invited);
    const tree = await call('get', ownerB, '/api/targets/tree?year=2026&month=2026-11');
    expect(tree.body.northStar).not.toBeNull();
    expect(JSON.stringify((await call('get', ownerB, '/api/badges?period=2026-10')).body)).toContain(pair.b.marker);
  });
});

describe('detail routes: an id of tenant B in a tenant A request is 404 and changes nothing', () => {
  const routes = (): Array<[string, Verb, string, object?]> => [
    ['GET role', 'get', `/api/roles/${b.role}`],
    ['PUT role', 'put', `/api/roles/${b.role}`, { area: 'Hacked' }],
    ['DELETE role', 'delete', `/api/roles/${b.role}`],
    ['PUT role tools', 'put', `/api/roles/${b.role}/tools`, { tools: ['manage_team'] }],
    ['GET role permissions', 'get', `/api/roles/${b.role}/permissions`],
    ['PUT role permissions', 'put', `/api/roles/${b.role}/permissions`, { permissions: { orders: ['view'] } }],
    ['GET role assignments', 'get', `/api/roles/${b.role}/assignments`],
    ['POST role assign (B role, A person)', 'post', `/api/roles/${b.role}/assign`, { type: 'existing', holderId: pair.a.users.salesRep.id }],
    ['DELETE assignment of B', 'delete', `/api/roles/${b.role}/assignments/${b.assignment}`],
    ['POST assign A role to a B person', 'post', `/api/roles/${aRole}/assign`, { type: 'existing', holderId: b.person }],
    ['PUT staff', 'put', `/api/staff/${b.person}`, { firstName: 'Hacked' }],
    ['POST reset-password', 'post', `/api/staff/${b.person}/reset-password`, { password: 'BrandNew#1234' }],
    ['POST deactivate', 'post', `/api/staff/${b.person}/deactivate`, {}],
    ['POST reactivate', 'post', `/api/staff/${b.person}/reactivate`, {}],
    ['DELETE staff', 'delete', `/api/staff/${b.person}`],
    ['DELETE staff permanent', 'delete', `/api/staff/${b.person}/permanent`, { confirm: 'x' }],
    ['POST resend-invite', 'post', `/api/staff/${b.invited}/resend-invite`, {}],
    ['POST revoke-invite', 'post', `/api/staff/${b.invited}/revoke-invite`, {}],
    ['POST invite into a B role', 'post', '/api/staff/invite', { name: 'Eve Spy', email: mail('eve'), roleId: b.role }],
    ['PUT target', 'put', `/api/targets/${b.roleTarget}`, { value: 1 }],
    ['DELETE target', 'delete', `/api/targets/${b.roleTarget}`],
    ['PUT target children', 'put', `/api/targets/${b.quarter}/children`, { children: [{ period: '2026-01', value: 1 }] }],
    ['POST target for a B role', 'post', '/api/targets', { scope: 'role', metric: 'revenue', unit: 'money', value: 1, period: '2026-11', roleId: b.role }],
    ['PUT reward tiers on a B role', 'put', '/api/rewards/settings', { tiers: [{ roleId: b.role, tier100: { amount: 1 }, tier120: { amount: 2, dayOff: false } }] }],
  ];

  it('every route answers 404 with no row of B, and the rows of B are the same after all of them', async () => {
    const before = await snapshotOfB();
    const out: string[] = [];
    for (const [label, verb, url, body] of routes()) {
      const res = await call(verb, ownerA, url, body);
      if (res.status !== 404 || JSON.stringify(res.body).includes(pair.b.marker)) out.push(`${label}: ${verb.toUpperCase()} ${url} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
    }
    expect(out).toEqual([]);
    expect(await snapshotOfB()).toEqual(before);
  });

  it('GET pool, progress and attainment with an id of B: no row of B comes back', async () => {
    const pool = await call('get', ownerA, `/api/targets/roles/${b.role}/pool?month=2026-11`);
    expect([200, 404]).toContain(pool.status);
    expect(pool.body.pool ?? null).toBeNull();
    expect(pool.body.holders ?? []).toEqual([]);
    const progress = await call('get', ownerA, `/api/rewards/progress?period=2026-10&userId=${b.person}`);
    // the service looks the person up inside A: no such person gives no row (200, empty) or a refusal, never B's row
    expect([200, 403, 404]).toContain(progress.status);
    expect(JSON.stringify(progress.body)).not.toContain(pair.b.marker);
    expect((progress.body.results ?? []).map((r: { userId: number }) => r.userId)).not.toContain(b.person);
    const attain = await call('get', ownerA, `/api/rewards/attainment?period=2026-10&userId=${b.person}`);
    expect(JSON.stringify(attain.body)).not.toContain(pair.b.marker);
    expect((attain.body.results ?? []).map((r: { userId: number }) => r.userId)).not.toContain(b.person);
    const role = await call('get', ownerA, `/api/rewards/attainment?period=2026-10&roleId=${b.role}`);
    expect((role.body.results ?? []).map((r: { userId: number }) => r.userId)).not.toContain(b.person);
  });
});

/** The rows of B the detail routes could change: the role, its holder, the invited person, the targets, the reward tiers. */
async function snapshotOfB() {
  const [role, assignments, users, targets, tiers] = await Promise.all([
    prismaBase.role.findUnique({ where: { id: b.role } }),
    prismaBase.roleAssignment.findMany({ where: { tenantId: pair.b.id }, orderBy: { id: 'asc' } }),
    prismaBase.user.findMany({ where: { tenantId: pair.b.id }, orderBy: { id: 'asc' } }),
    prismaBase.target.findMany({ where: { tenantId: pair.b.id }, orderBy: { id: 'asc' } }),
    prismaBase.rewardTier.findMany({ where: { tenantId: pair.b.id }, orderBy: { id: 'asc' } }),
  ]);
  return JSON.parse(JSON.stringify({ role, assignments, users, targets, tiers }));
}

describe('permission: a role without the cell is denied on each M6 route group', () => {
  let limited: { id: number; token: string };

  beforeAll(async () => {
    // A manager whose only position role grants one cell (orders:view): no users, settings, analytics or targets cell.
    const role = await call('post', ownerA, '/api/roles', { name: `View orders only ${SUFFIX}` });
    expect(role.status).toBe(201);
    expect((await call('put', ownerA, `/api/roles/${role.body.role.id}/permissions`, { permissions: { orders: ['view'] } })).status).toBe(200);
    limited = await mkUser(pair.a.id, 'limited', 'manager');
    expect((await call('post', ownerA, `/api/roles/${role.body.role.id}/assign`, { type: 'existing', holderId: limited.id })).status).toBe(201);
    clearPermissionsCache();
    const me = await call('get', limited.token, '/api/auth/me');
    expect(me.body.permissions).toEqual(expect.objectContaining({ orders: ['view'] }));
    expect(me.body.permissions.users ?? []).toEqual([]);
  });

  // [group, verb, url, body]. The ids are real rows of A, so a 403 can only come from the permission check.
  const groups = (): Array<[string, Verb, string, object?]> => [
    ['roles', 'get', '/api/roles'],
    ['roles', 'get', '/api/roles/overview'],
    ['roles', 'get', `/api/roles/${aRole}`],
    ['roles', 'post', '/api/roles', { name: 'Nope' }],
    ['roles', 'put', `/api/roles/${aRole}`, { area: 'X' }],
    ['roles', 'delete', `/api/roles/${aRole}`],
    ['roles', 'put', `/api/roles/${aRole}/tools`, { tools: [] }],
    ['roles', 'get', `/api/roles/${aRole}/permissions`],
    ['roles', 'put', `/api/roles/${aRole}/permissions`, { permissions: { orders: ['view'] } }],
    ['roles', 'get', `/api/roles/${aRole}/assignments`],
    ['roles', 'post', `/api/roles/${aRole}/assign`, { type: 'existing', holderId: pair.a.users.salesRep.id }],
    ['roles', 'delete', `/api/roles/${aRole}/assignments/1`],
    ['staff', 'get', '/api/staff'],
    ['staff', 'get', '/api/staff/workload'],
    ['staff', 'put', `/api/staff/${aInvited.id}`, { firstName: 'X' }],
    ['staff', 'post', `/api/staff/${aInvited.id}/reset-password`, { password: 'BrandNew#1234' }],
    ['staff', 'post', `/api/staff/${aInvited.id}/deactivate`, {}],
    ['staff', 'post', `/api/staff/${aInvited.id}/reactivate`, {}],
    ['staff', 'delete', `/api/staff/${aInvited.id}`],
    ['staff', 'delete', `/api/staff/${aInvited.id}/permanent`, { confirm: 'x' }],
    ['invites', 'post', '/api/staff/invite', { name: 'Zed Nope', email: 'zed@codadmin.test', role: 'sales_rep' }],
    ['invites', 'post', `/api/staff/${aInvited.id}/resend-invite`, {}],
    ['invites', 'post', `/api/staff/${aInvited.id}/revoke-invite`, {}],
    ['targets', 'get', '/api/targets/tree?year=2026'],
    ['targets', 'get', `/api/targets/roles/${aRole}/pool?month=2026-11`],
    ['targets', 'get', '/api/targets/daily?metric=failed_delivery_calls_per_day&date=2026-11-02'],
    ['targets', 'get', '/api/targets/drivers?year=2026'],
    ['targets', 'get', '/api/targets/north-star/preview?year=2026&annual=1800000&mode=grow'],
    ['targets', 'get', '/api/targets/calculators?month=2026-11&aov=249&confirmationRate=70&deliverySuccessRate=60'],
    ['targets', 'post', '/api/targets/north-star', { year: 2026, annual: 1, mode: 'grow', plannedAov: 249 }],
    ['targets', 'put', '/api/targets/drivers', { year: 2026, confirmationRate: 71 }],
    ['targets', 'put', '/api/targets/1/children', { children: [] }],
    ['targets', 'post', '/api/targets', { scope: 'role', metric: 'revenue', unit: 'money', value: 1, period: '2026-11', roleId: aRole }],
    ['targets', 'put', '/api/targets/1', { value: 1 }],
    ['targets', 'delete', '/api/targets/1'],
    ['rewards', 'get', '/api/rewards/settings'],
    ['rewards', 'put', '/api/rewards/settings', { repPay: { baseCommission: 12, upsellPercent: 5 } }],
    ['period close', 'post', '/api/period-close/2026-09/preview', {}],
    ['period close', 'post', '/api/period-close/2026-09', {}],
    ['leaderboard', 'get', '/api/leaderboard?role=call_rep&period=2026-10'],
    ['leaderboard', 'get', '/api/badges?period=2026-10'],
  ];

  it('the person with one cell is 403 on every route of every group, and nothing is written', async () => {
    const before = { roles: await prismaBase.role.count({ where: { tenantId: pair.a.id } }), users: await prismaBase.user.count({ where: { tenantId: pair.a.id } }), targets: await prismaBase.target.count({ where: { tenantId: pair.a.id } }) };
    const out: string[] = [];
    for (const [group, verb, url, body] of groups()) {
      const res = await call(verb, limited.token, url, body);
      if (res.status !== 403) out.push(`${group} ${verb.toUpperCase()} ${url} -> ${res.status}`);
    }
    expect(out).toEqual([]);
    expect({ roles: await prismaBase.role.count({ where: { tenantId: pair.a.id } }), users: await prismaBase.user.count({ where: { tenantId: pair.a.id } }), targets: await prismaBase.target.count({ where: { tenantId: pair.a.id } }) }).toEqual(before);
  });

  it('a call rep and a delivery partner (base roles) are 403 on every route of the management groups', async () => {
    const management = groups().filter(([group]) => !['leaderboard'].includes(group));
    for (const [label, token] of [['sales rep', pair.a.users.salesRep.token], ['delivery partner', pair.a.users.deliveryAgent.token]] as const) {
      const out: string[] = [];
      for (const [group, verb, url, body] of management) {
        const res = await call(verb, token, url, body);
        if (res.status !== 403) out.push(`${label}: ${group} ${verb.toUpperCase()} ${url} -> ${res.status}`);
      }
      expect(out).toEqual([]);
    }
  });

  it('an admin is 403 on the Owner-only routes: make or delete a role, tools, the grid, the North Star, drivers, period close, permanent delete', async () => {
    const admin = pair.a.users.admin.token;
    const ownerOnly: Array<[Verb, string, object?]> = [
      ['post', '/api/roles', { name: 'Admin made' }],
      ['delete', `/api/roles/${aRole}`],
      ['put', `/api/roles/${aRole}/tools`, { tools: [] }],
      ['put', `/api/roles/${aRole}/permissions`, { permissions: { orders: ['view'] } }],
      ['get', '/api/roles'],
      ['post', '/api/targets/north-star', { year: 2026, annual: 1, mode: 'grow', plannedAov: 249 }],
      ['put', '/api/targets/drivers', { year: 2026, confirmationRate: 71 }],
      ['put', '/api/targets/1/children', { children: [] }],
      ['put', '/api/rewards/settings', { repPay: { baseCommission: 12, upsellPercent: 5 } }],
      ['post', '/api/period-close/2026-09/preview', {}],
      ['post', '/api/period-close/2026-09', {}],
      ['delete', `/api/staff/${aInvited.id}/permanent`, { confirm: 'x' }],
    ];
    const out: string[] = [];
    for (const [verb, url, body] of ownerOnly) {
      const res = await call(verb, admin, url, body);
      if (res.status !== 403) out.push(`${verb.toUpperCase()} ${url} -> ${res.status}`);
    }
    expect(out).toEqual([]);
  });

  it('the Owner reads the same routes (200): the 403 above is the permission, not a dead route', async () => {
    const reads = groups().filter(([, verb]) => verb === 'get');
    const out: string[] = [];
    for (const [group, , url] of reads) {
      const res = await call('get', ownerA, url);
      if (res.status !== 200) out.push(`${group} GET ${url} -> ${res.status}`);
    }
    expect(out).toEqual([]);
  });

  it('no token and a bad token are 401 on a route of each group', async () => {
    for (const url of ['/api/roles/overview', '/api/staff', '/api/targets/tree', '/api/rewards/settings', '/api/leaderboard?role=call_rep', '/api/badges']) {
      expect((await request(app).get(url)).status).toBe(401);
      expect((await request(app).get(url).set(bearer('not-a-token'))).status).toBe(401);
    }
    expect((await request(app).post('/api/period-close/2026-09')).status).toBe(401);
    expect((await request(app).post('/api/staff/invite').send({})).status).toBe(401);
  });
});

describe('invite token: one use, expiry, and the tenant it was made in', () => {
  it('a used token is refused and cannot set a second password', async () => {
    const res = await call('post', ownerA, '/api/staff/invite', { name: 'Kojo Once', email: mail('once'), role: 'sales_rep' });
    const raw = tokenOf(res.body.link);
    const first = await accept(raw);
    expect(first.status).toBe(200);
    const again = await accept(raw, 'Another1!password');
    expect(again.status).toBe(400);
    expect((await request(app).post('/api/auth/check-invite').send({ token: raw })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: res.body.staff.email, password: 'Another1!password' })).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).post('/api/auth/login').send({ email: res.body.staff.email, password: PASSWORD })).status).toBe(200);
  });

  it('an expired token is 410 on check and on accept, and the person is not activated', async () => {
    const res = await call('post', ownerA, '/api/staff/invite', { name: 'Efua Late', email: mail('late'), role: 'sales_rep' });
    await prismaBase.user.update({ where: { id: res.body.staff.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    const raw = tokenOf(res.body.link);
    expect((await request(app).post('/api/auth/check-invite').send({ token: raw })).status).toBe(410);
    expect((await accept(raw)).status).toBe(410);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: res.body.staff.id } })).isActive).toBe(false);
  });

  it('a token of tenant B signs in a person of tenant B only: A\'s people and data are untouched and unreachable with the session', async () => {
    // the owner of A cannot resend or revoke B\'s invite, so B\'s link is still good afterwards
    expect((await call('post', ownerA, `/api/staff/${b.invited}/revoke-invite`, {})).status).toBe(404);
    expect((await call('post', ownerA, `/api/staff/${b.invited}/resend-invite`, {})).status).toBe(404);
    const check = await request(app).post('/api/auth/check-invite').send({ token: b.invitedToken });
    expect(check.status).toBe(200);
    expect(check.body).toEqual({ valid: true }); // no tenant name, no person

    const aBefore = await prismaBase.user.findUniqueOrThrow({ where: { id: aInvited.id } });
    const done = await accept(b.invitedToken);
    expect(done.status).toBe(200);
    expect(verifyAccessToken(done.body.tokens.accessToken).tenantId).toBe(pair.b.id);
    const person = await prismaBase.user.findUniqueOrThrow({ where: { id: b.invited } });
    expect(person).toMatchObject({ tenantId: pair.b.id, isActive: true });
    // A's invited person was not touched
    expect(await prismaBase.user.findUniqueOrThrow({ where: { id: aInvited.id } })).toMatchObject({ isActive: false, inviteTokenHash: aBefore.inviteTokenHash });

    // the new session reads tenant B and nothing of A
    const me = await call('get', done.body.tokens.accessToken, '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(b.invited);
    const board = await call('get', done.body.tokens.accessToken, '/api/leaderboard?role=call_rep&period=2026-10');
    expect(JSON.stringify(board.body)).not.toContain(pair.a.marker);
    // and A's own token still works for A's invite: the two tokens do not cross
    expect((await accept(aInvited.token)).status).toBe(200);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: aInvited.id } })).tenantId).toBe(pair.a.id);
  });
});
