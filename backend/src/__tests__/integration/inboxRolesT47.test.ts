/**
 * M9-T47 (COD-85): gaps left after the audit of the inbox suites.
 * 1. The done-when case end to end: a real WhatsApp reply and a real team note each reach the right inbox once.
 * 2. The manager rule for the inbox and reminders (code rule: only the owner and admin see more than their own rows).
 * 3. Two tenants for thread reads.
 */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, mkUser, TwoTenants } from './helpers/twoTenants';
import { makeOrder } from './helpers/kpiOrders';
import whatsappService, { clearWhatsAppConfigCache } from '../../services/whatsappService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

let pair: TwoTenants;
let manager: { id: number; token: string };
let rep2: { id: number; token: string };
let orderId: number;
const SUFFIX = Date.now();
const phoneId = `wa-t47-${SUFFIX}`;
const secret = `secret-t47-${SUFFIX}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const rep = () => pair.a.users.salesRep;
const owner = () => pair.a.users.admin;
const sign = (raw: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const inboxOf = (userId: number) => prismaBase.notification.findMany({ where: { userId }, orderBy: { id: 'asc' } });
const feed = async (token: string, qs = '') => (await request(app).get(`/api/inbox${qs}`).set(auth(token))).body;

async function reply(from: string, text: string, id: string) {
  const m = { from: from.replace(/^\+/, ''), id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } };
  const body = { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId }, messages: [m] } }] }] };
  const raw = JSON.stringify(body);
  return request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw);
}

beforeAll(async () => {
  pair = await createTwoTenants('t47');
  manager = await mkUser(pair.a.id, 'mgr', 'manager');
  rep2 = await mkUser(pair.a.id, 'rep2', 'sales_rep');
  orderId = (await makeOrder({ tenantId: pair.a.id, customerId: pair.a.ids.customer, status: 'confirmed', paymentMethod: 'cod', orderType: 'physical' } as any)).id;
  await prismaBase.order.update({ where: { id: orderId }, data: { customerRepId: rep().id } });
  await prismaBase.systemConfig.upsert({
    where: { tenantId: pair.a.id },
    create: { tenantId: pair.a.id, whatsappProvider: { isEnabled: true, accessToken: 'tok', phoneNumberId: phoneId, appSecret: secret } as any },
    update: { whatsappProvider: { isEnabled: true, accessToken: 'tok', phoneNumberId: phoneId, appSecret: secret } as any },
  });
  clearWhatsAppConfigCache();
}, 60000);

afterAll(async () => {
  clearWhatsAppConfigCache();
  await prismaBase.thread.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.reminder.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

beforeEach(async () => {
  await prismaBase.notification.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
});

describe('done-when: a customer reply and a team note reach the right inbox, once each', () => {
  let spy: any;
  beforeEach(() => { spy = jest.spyOn(whatsappService, 'sendText').mockImplementation(async () => ({ messageLogId: 999, sent: true })); });
  afterEach(() => spy?.mockRestore());

  it('the reply lands only in the order rep inbox, once, even when the provider sends it twice', async () => {
    const id = `wamid.t47.${SUFFIX}.1`;
    expect((await reply(pair.a.phone, 'Where is my order?', id)).status).toBe(200);
    expect((await reply(pair.a.phone, 'Where is my order?', id)).status).toBe(200);
    const mine = await inboxOf(rep().id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'reply', type: 'customer_reply', subjectType: 'conversation', isRead: false });
    for (const u of [owner().id, rep2.id, manager.id, pair.a.users.deliveryAgent.id, pair.b.users.admin.id, pair.b.users.salesRep.id]) {
      expect(await inboxOf(u)).toHaveLength(0);
    }
    const replies = (await feed(rep().token, '?view=replies')).items;
    expect(replies).toHaveLength(1);
    expect((await feed(rep2.token, '?view=replies')).items).toHaveLength(0);
  });

  it('a team note lands only in the inbox of the earlier commenter, once, and not in the author or a stranger', async () => {
    const comment = (token: string, body: string) => request(app).post(`/api/threads/by-subject/order/${orderId}/comments`).set(auth(token)).send({ body });
    expect((await comment(rep().token, 'I called him')).status).toBe(201);
    await prismaBase.notification.deleteMany({ where: { tenantId: pair.a.id } });
    expect((await comment(owner().token, 'Thanks, noted')).status).toBe(201);
    const mine = await inboxOf(rep().id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'note', type: 'team_note', subjectType: 'order', subjectId: orderId });
    for (const u of [owner().id, rep2.id, manager.id, pair.a.users.deliveryAgent.id, pair.b.users.admin.id]) {
      expect(await inboxOf(u)).toHaveLength(0);
    }
    expect((await feed(rep().token, '?view=notes')).items).toHaveLength(1);
    expect((await feed(owner().token, '?view=notes')).items).toHaveLength(0);
  });
});

describe('manager: inbox and reminders are own rows only (only owner and admin see more)', () => {
  it('a manager sees only their own inbox rows and cannot ask for scope=all', async () => {
    const mk = (userId: number, title: string) => prismaBase.notification.create({ data: { tenantId: pair.a.id, userId, kind: 'note', type: 'team_note', title, message: title } });
    const own = await mk(manager.id, 'mgr row');
    await mk(rep().id, 'rep row');
    await mk(owner().id, 'owner row');
    expect((await feed(manager.token)).items.map((i: any) => i.id)).toEqual([own.id]);
    expect((await request(app).get('/api/inbox?scope=all').set(auth(manager.token))).status).toBe(403);
    expect((await feed(owner().token, '?scope=all')).items).toHaveLength(3);
  });

  it('a manager sees only reminders they made or got, never a rep reminder', async () => {
    const due = new Date(Date.now() + 3600_000);
    const mine = await prismaBase.reminder.create({ data: { tenantId: pair.a.id, createdById: manager.id, assignedToId: manager.id, note: 'm', dueAt: due } });
    const reps = await prismaBase.reminder.create({ data: { tenantId: pair.a.id, createdById: rep().id, assignedToId: rep().id, note: 'r', dueAt: due } });
    const ids = (await request(app).get('/api/reminders').set(auth(manager.token))).body.reminders.map((r: any) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(reps.id);
    expect((await request(app).patch(`/api/reminders/${reps.id}`).set(auth(manager.token)).send({ note: 'x' })).status).toBe(403);
    await prismaBase.reminder.deleteMany({ where: { id: { in: [mine.id, reps.id] } } });
  });
});

describe('two tenants: thread reads', () => {
  it('a read by tenant B writes no read row for A, and A unread counts do not move', async () => {
    await prismaBase.thread.deleteMany({ where: { tenantId: pair.a.id } });
    const c = await request(app).post(`/api/threads/by-subject/order/${orderId}/comments`).set(auth(owner().token)).send({ body: 'unread for rep' });
    expect(c.status).toBe(201);
    const unread = async () => (await request(app).get(`/api/threads/by-subject/order/${orderId}`).set(auth(rep().token))).body.thread;
    const threadId = c.body.comment.threadId ?? (await prismaBase.thread.findFirstOrThrow({ where: { tenantId: pair.a.id, subjectId: orderId } })).id;
    // B asks for A's order thread: 404, and no ThreadRead row appears for B's users on it
    expect((await request(app).get(`/api/threads/by-subject/order/${orderId}`).set(auth(pair.b.users.admin.token))).status).toBe(404);
    expect(await prismaBase.threadRead.count({ where: { threadId, userId: { in: [pair.b.users.admin.id, pair.b.users.salesRep.id] } } })).toBe(0);
    // A's read rows are all stamped with tenant A
    const first = await unread();
    expect(first.unreadCount).toBe(1);
    const reads = await prismaBase.threadRead.findMany({ where: { threadId } });
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.tenantId === pair.a.id)).toBe(true);
    expect((await unread()).unreadCount).toBe(0);
  });
});
