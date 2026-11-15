/**
 * M9-T16 (COD-80): notification preferences and role defaults, the owner rule for System problem,
 * and `notify` against the real database (owner fallback, deactivated people, actor, two tenants).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { notify } from '../../services/inbox/inboxService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { generateAccessToken } from '../../utils/jwt';

let pair: TwoTenants;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const prefsOf = async (token: string) => {
  const res = await request(app).get('/api/notifications/preferences').set(auth(token));
  expect(res.status).toBe(200);
  return Object.fromEntries(res.body.preferences.map((p: any) => [p.event, p]));
};

beforeAll(async () => {
  pair = await createTwoTenants('inboxprefs');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('GET /api/notifications/preferences', () => {
  it('requires a sign-in', async () => {
    expect((await request(app).get('/api/notifications/preferences')).status).toBe(401);
  });

  it('lists every event with the merged channels; unconnected channels are marked with a hint', async () => {
    const prefs = await prefsOf(pair.a.users.salesRep.token);
    expect(Object.keys(prefs)).toEqual(expect.arrayContaining(['customer_reply', 'mention', 'system_problem', 'order_assigned']));
    expect(prefs.mention.channels.inApp).toMatchObject({ enabled: true, available: true });
    expect(prefs.mention.channels.sms).toMatchObject({ enabled: false, available: false });
    expect(prefs.mention.channels.sms.hint).toMatch(/Connections/);
    expect(prefs.mention.source).toBe('default');
  });
});

describe('PUT /api/notifications/preferences', () => {
  it('saves my choice and reads it back; another person and another tenant are unchanged', async () => {
    const res = await request(app).put('/api/notifications/preferences').set(auth(pair.a.users.salesRep.token))
      .send({ preferences: [{ event: 'mention', email: true }] });
    expect(res.status).toBe(200);
    const mine = res.body.preferences.find((p: any) => p.event === 'mention');
    expect(mine).toMatchObject({ source: 'person' });
    expect(mine.channels.email.enabled).toBe(true);
    expect(mine.channels.inApp.enabled).toBe(true);
    expect((await prefsOf(pair.a.users.deliveryAgent.token)).mention.channels.email.enabled).toBe(false);
    expect((await prefsOf(pair.b.users.salesRep.token)).mention.channels.email.enabled).toBe(false);
  });

  it('refuses an unknown event and a bad body with 400', async () => {
    const bad = await request(app).put('/api/notifications/preferences').set(auth(pair.a.users.salesRep.token)).send({ preferences: [{ event: 'nope', inApp: true }] });
    expect(bad.status).toBe(400);
    const empty = await request(app).put('/api/notifications/preferences').set(auth(pair.a.users.salesRep.token)).send({});
    expect(empty.status).toBe(400);
  });

  it('refuses the owner turning in-app off for System problem with 400; a rep may', async () => {
    const owner = await request(app).put('/api/notifications/preferences').set(auth(pair.a.users.admin.token))
      .send({ preferences: [{ event: 'system_problem', inApp: false }] });
    expect(owner.status).toBe(400);
    expect(owner.body.code ?? owner.body.errorCode).toBe('OWNER_IN_APP_REQUIRED');
    const rep = await request(app).put('/api/notifications/preferences').set(auth(pair.a.users.salesRep.token))
      .send({ preferences: [{ event: 'system_problem', inApp: false }] });
    expect(rep.status).toBe(200);
  });
});

describe('role defaults', () => {
  it('are for owner, admin and manager only', async () => {
    expect((await request(app).get('/api/notifications/role-defaults').set(auth(pair.a.users.salesRep.token))).status).toBe(403);
    expect((await request(app).put('/api/notifications/role-defaults').set(auth(pair.a.users.salesRep.token)).send({ role: 'sales_rep', defaults: [{ event: 'mention', email: true }] })).status).toBe(403);
  });

  it('an admin sets a role default; people without their own choice get it, others keep theirs; the other tenant is unchanged', async () => {
    const put = await request(app).put('/api/notifications/role-defaults').set(auth(pair.a.users.admin.token))
      .send({ role: 'delivery_agent', defaults: [{ event: 'stock_incoming', email: true }] });
    expect(put.status).toBe(200);
    expect(put.body.roles[0].role).toBe('delivery_agent');
    const get = await request(app).get('/api/notifications/role-defaults?role=delivery_agent').set(auth(pair.a.users.admin.token));
    expect(get.body.roles[0].defaults.find((d: any) => d.event === 'stock_incoming').channels.email.enabled).toBe(true);

    const agent = await prefsOf(pair.a.users.deliveryAgent.token);
    expect(agent.stock_incoming).toMatchObject({ source: 'role' });
    expect(agent.stock_incoming.channels.email.enabled).toBe(true);
    expect((await prefsOf(pair.b.users.deliveryAgent.token)).stock_incoming.channels.email.enabled).toBe(false);
  });

  it('refuse in-app off for System problem on an owner role', async () => {
    const ownerUser = await prismaBase.user.findFirstOrThrow({ where: { tenantId: pair.a.id, role: 'super_admin' } });
    const owner = generateAccessToken({ id: ownerUser.id, email: ownerUser.email, role: 'super_admin', tenantId: pair.a.id });
    const res = await request(app).put('/api/notifications/role-defaults').set(auth(owner))
      .send({ role: 'super_admin', defaults: [{ event: 'system_problem', inApp: false }] });
    expect(res.status).toBe(400);
  });
});

describe('role defaults: who may change which role', () => {
  // The harness has no manager, so make one (and take the owner's id from the seed) in tenant A
  const tokenFor = async (role: 'manager' | 'super_admin') => {
    const tenantId = pair.a.id;
    const stamp = `${role}-${Date.now()}`;
    const u = role === 'super_admin'
      ? await prismaBase.user.findFirstOrThrow({ where: { tenantId, role } })
      : await prismaBase.user.create({ data: { email: `${stamp}@codadmin.test`, password: 'x', firstName: 'M', lastName: 'G', role, tenantId } });
    return generateAccessToken({ id: u.id, email: u.email, role, tenantId });
  };
  const put = (token: string, role: string) => request(app).put('/api/notifications/role-defaults').set(auth(token))
    .send({ role, defaults: [{ event: 'mention', email: true }] });
  let manager: string;
  let owner: string;
  beforeAll(async () => { manager = await tokenFor('manager'); owner = await tokenFor('super_admin'); });

  it('a manager changes Sales rep and Manager defaults', async () => {
    expect((await put(manager, 'sales_rep')).status).toBe(200);
    expect((await put(manager, 'manager')).status).toBe(200);
    expect((await request(app).get('/api/notifications/role-defaults?role=sales_rep').set(auth(manager))).status).toBe(200);
  });

  it('a manager cannot read or change Owner or Admin: 403', async () => {
    for (const role of ['super_admin', 'admin']) {
      expect((await put(manager, role)).status).toBe(403);
      expect((await request(app).get(`/api/notifications/role-defaults?role=${role}`).set(auth(manager))).status).toBe(403);
    }
    const all = await request(app).get('/api/notifications/role-defaults').set(auth(manager));
    expect(all.status).toBe(200);
    const roles = all.body.roles.map((r: any) => r.role);
    expect(roles).not.toContain('super_admin');
    expect(roles).not.toContain('admin');
    expect(roles).toContain('sales_rep');
  });

  it('an admin changes every role but Owner; the owner changes all of them', async () => {
    const admin = pair.a.users.admin.token;
    expect((await put(admin, 'admin')).status).toBe(200);
    expect((await put(admin, 'manager')).status).toBe(200);
    expect((await put(admin, 'super_admin')).status).toBe(403);
    expect((await request(app).get('/api/notifications/role-defaults?role=super_admin').set(auth(admin))).status).toBe(403);
    expect((await put(owner, 'super_admin')).status).toBe(200);
    expect((await put(owner, 'admin')).status).toBe(200);
  });

  it('a sales rep changes none: 403', async () => {
    expect((await put(pair.a.users.salesRep.token, 'sales_rep')).status).toBe(403);
  });
});

describe('notify against the database', () => {
  const rowsFor = (tenantId: string, userId: number, type: string) => prismaBase.notification.findMany({ where: { tenantId, userId, type } });

  it('an empty list goes to the tenant owner (admin), never to the other tenant', async () => {
    await notify({ tenantId: pair.a.id, event: 'workflow_failed', recipients: [], title: 'Flow broke', message: 'x' });
    expect(await rowsFor(pair.a.id, pair.a.users.admin.id, 'workflow_failed')).toHaveLength(1);
    expect(await prismaBase.notification.count({ where: { tenantId: pair.b.id, type: 'workflow_failed' } })).toBe(0);
  });

  it('a deactivated recipient sends it to the owner', async () => {
    await prismaBase.user.update({ where: { id: pair.a.users.deliveryAgent.id }, data: { isActive: false } });
    await notify({ tenantId: pair.a.id, event: 'agent_blocked', recipients: [pair.a.users.deliveryAgent.id], title: 'Blocked', message: 'x' });
    expect(await rowsFor(pair.a.id, pair.a.users.deliveryAgent.id, 'agent_blocked')).toHaveLength(0);
    expect(await rowsFor(pair.a.id, pair.a.users.admin.id, 'agent_blocked')).toHaveLength(1);
    await prismaBase.user.update({ where: { id: pair.a.users.deliveryAgent.id }, data: { isActive: true } });
  });

  it('the actor is not told about their own action', async () => {
    await notify({ tenantId: pair.a.id, event: 'order_assigned', recipients: [pair.a.users.salesRep.id], actorId: pair.a.users.salesRep.id, title: 'Self', message: 'x' });
    expect(await rowsFor(pair.a.id, pair.a.users.salesRep.id, 'order_assigned')).toHaveLength(0);
  });

  it('writes kind, subject and actor on the row', async () => {
    await notify({
      tenantId: pair.a.id, event: 'customer_reply', subject: { type: 'conversation', id: 5 }, recipients: [pair.a.users.salesRep.id],
      actorId: pair.a.users.admin.id, title: 'Reply', message: 'hi',
    });
    const [row] = await rowsFor(pair.a.id, pair.a.users.salesRep.id, 'customer_reply');
    expect(row).toMatchObject({ kind: 'reply', subjectType: 'conversation', subjectId: 5, actorId: pair.a.users.admin.id, isRead: false });
  });
});
