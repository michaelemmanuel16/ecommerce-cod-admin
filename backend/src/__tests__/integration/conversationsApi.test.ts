/** M9-T07 (COD-78): conversations API: list, thread, reply (24 hour window), assign and done, access. */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { whatsappCloudProvider } from '../../services/messaging/providers';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
let tenantA: string;
let tenantB: string;
let owner: { id: number; token: string };
let manager: { id: number; token: string };
let rep: { id: number; token: string };
let otherRep: { id: number; token: string };
let ownerB: { id: number; token: string };
let customerId: number;
let seq = 0;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const mkConv = (data: Record<string, unknown> = {}) => prismaBase.conversation.create({
  data: { tenantId: tenantA, channel: 'whatsapp', phone: `+23324${String(SUFFIX).slice(-5)}${String(seq++).padStart(2, '0')}`, lastMessageAt: new Date(), ...data } as any,
});
const mkMsg = (data: Record<string, unknown>) => prismaBase.messageLog.create({
  data: { tenantId: tenantA, channel: 'whatsapp', messageBody: 'x', status: 'delivered', provider: 'whatsapp_cloud', providerMessageId: `m-${SUFFIX}-${seq++}`, ...data } as any,
});

beforeAll(async () => {
  tenantA = (await createTenant('Conv A')).id;
  tenantB = (await createTenant('Conv B')).id;
  owner = await mkUser(tenantA, 'owner', 'super_admin');
  manager = await mkUser(tenantA, 'mgr', 'manager');
  rep = await mkUser(tenantA, 'rep', 'sales_rep');
  otherRep = await mkUser(tenantA, 'rep2', 'sales_rep');
  ownerB = await mkUser(tenantB, 'ownerb', 'super_admin');
  const customer = await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+23355${String(SUFFIX).slice(-7)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: tenantA },
  });
  customerId = customer.id;
  await prismaBase.order.create({
    data: { customerId, subtotal: 10, shippingCost: 0, totalAmount: 10, deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: tenantA, customerRepId: rep.id } as any,
  });
});

afterAll(async () => {
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});

describe('GET /api/conversations', () => {
  it('lists with filters, preview, window flag, and pages by lastMessageAt desc', async () => {
    const a = await mkConv({ customerId, lastMessageAt: hoursAgo(1), lastInboundAt: hoursAgo(1), unanswered: true, assignedToId: manager.id });
    const b = await mkConv({ lastMessageAt: hoursAgo(30), lastInboundAt: hoursAgo(30), status: 'done' });
    await mkMsg({ conversationId: a.id, direction: 'inbound', messageBody: 'Where is my order' });

    const all = await request(app).get('/api/conversations').set(bearer(owner.token));
    expect(all.status).toBe(200);
    const ids = all.body.items.map((i: any) => i.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    const row = all.body.items.find((i: any) => i.id === a.id);
    expect(row).toMatchObject({ customerName: 'Ama Mensah', lastMessagePreview: 'Where is my order', unanswered: true, windowOpen: true, assignedTo: { id: manager.id } });
    expect(all.body.items.find((i: any) => i.id === b.id)).toMatchObject({ windowOpen: false, displayName: b.phone });

    const done = await request(app).get('/api/conversations?status=done').set(bearer(owner.token));
    expect(done.body.items.map((i: any) => i.id)).toEqual([b.id]);
    expect((await request(app).get('/api/conversations?unanswered=true').set(bearer(owner.token))).body.items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await request(app).get('/api/conversations?assignedTo=none').set(bearer(owner.token))).body.items.map((i: any) => i.id)).toEqual([b.id]);
    expect((await request(app).get(`/api/conversations?assignedTo=${manager.id}`).set(bearer(owner.token))).body.items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await request(app).get('/api/conversations?assignedTo=me').set(bearer(manager.token))).body.items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await request(app).get('/api/conversations?q=mensah').set(bearer(owner.token))).body.items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await request(app).get('/api/conversations?channel=sms').set(bearer(owner.token))).body.items).toEqual([]);

    const p1 = await request(app).get('/api/conversations?limit=1').set(bearer(owner.token));
    expect(p1.body.items).toHaveLength(1);
    const p2 = await request(app).get(`/api/conversations?limit=1&cursor=${p1.body.nextCursor}`).set(bearer(owner.token));
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
  });

  it('a rep sees only conversations of their customers or assigned to them; the manager sees all', async () => {
    const mine = await mkConv({ customerId });
    const assigned = await mkConv({ assignedToId: otherRep.id });
    const repIds = (await request(app).get('/api/conversations?limit=100').set(bearer(rep.token))).body.items.map((i: any) => i.id);
    expect(repIds).toContain(mine.id);
    expect(repIds).not.toContain(assigned.id);
    const other = (await request(app).get('/api/conversations?limit=100').set(bearer(otherRep.token))).body.items.map((i: any) => i.id);
    expect(other).toContain(assigned.id);
    expect(other).not.toContain(mine.id);
    const mgr = (await request(app).get('/api/conversations?limit=100').set(bearer(manager.token))).body.items.map((i: any) => i.id);
    expect(mgr).toEqual(expect.arrayContaining([mine.id, assigned.id]));
  });

  it('another tenant sees nothing', async () => {
    expect((await request(app).get('/api/conversations').set(bearer(ownerB.token))).body.items).toEqual([]);
  });
});

describe('GET /api/conversations/:id/messages', () => {
  it('returns the thread in time order with outbound messages sent before the conversation existed', async () => {
    const conv = await mkConv({ customerId });
    const to = conv.phone.replace(/^\+/, '');
    const early = await mkMsg({ direction: 'outbound', messageBody: 'auto confirm', metadata: { to }, createdAt: hoursAgo(5), status: 'read' });
    const inbound = await mkMsg({ conversationId: conv.id, direction: 'inbound', messageBody: 'YES', inReplyToId: early.id, createdAt: hoursAgo(4) });
    const elsewhere = await mkMsg({ direction: 'outbound', messageBody: 'other number', metadata: { to: '233200000000' }, createdAt: hoursAgo(3) });
    const res = await request(app).get(`/api/conversations/${conv.id}/messages`).set(bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: any) => m.id)).toEqual([early.id, inbound.id]);
    expect(res.body.messages[0]).toMatchObject({ status: 'read', direction: 'outbound' });
    expect(res.body.messages[1]).toMatchObject({ inReplyToId: early.id });
    expect(res.body.messages.map((m: any) => m.id)).not.toContain(elsewhere.id);
  });
});

describe('POST /api/conversations/:id/reply', () => {
  let sendSpy: any;
  beforeEach(() => {
    jest.spyOn(whatsappCloudProvider, 'isEnabled').mockResolvedValue(true);
    sendSpy = jest.spyOn(whatsappCloudProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `wa-r-${SUFFIX}-${seq++}` }));
  });

  it('inside the window sends free text, links the conversation and clears unanswered', async () => {
    const conv = await mkConv({ customerId, lastInboundAt: hoursAgo(2), unanswered: true });
    const inbound = await mkMsg({ conversationId: conv.id, direction: 'inbound', messageBody: 'hi' });
    const res = await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ body: 'Hello Ama' });
    expect(res.status).toBe(201);
    const row = await prismaBase.messageLog.findUniqueOrThrow({ where: { id: res.body.messageLogId } });
    expect(row).toMatchObject({ conversationId: conv.id, direction: 'outbound', messageBody: 'Hello Ama', inReplyToId: inbound.id, status: 'sent' });
    expect((await prismaBase.conversation.findUniqueOrThrow({ where: { id: conv.id } })).unanswered).toBe(false);
  });

  it('outside the window free text is 422 and nothing is sent; a template is allowed', async () => {
    const conv = await mkConv({ customerId, lastInboundAt: hoursAgo(30) });
    const calls = sendSpy.mock.calls.length;
    const refused = await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ body: 'late' });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('The 24 hour window is closed. Send an approved template.');
    expect(sendSpy.mock.calls.length).toBe(calls);
    const ok = await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ templateName: 'order_auto_confirm', variables: ['Ama', 'Pack', '1', '10'] });
    expect(ok.status).toBe(201);
    expect(sendSpy.mock.calls.length).toBe(calls + 1);
  });

  it('opt-out: a customer who wrote in the last 24 hours can be answered; otherwise an opted-out customer is 409', async () => {
    await prismaBase.customer.update({ where: { id: customerId }, data: { whatsappOptOut: true } });
    try {
      const fresh = await mkConv({ customerId, lastInboundAt: hoursAgo(1) });
      expect((await request(app).post(`/api/conversations/${fresh.id}/reply`).set(bearer(owner.token)).send({ body: 'ok' })).status).toBe(201);
      const stale = await mkConv({ customerId, lastInboundAt: hoursAgo(48) });
      expect((await request(app).post(`/api/conversations/${stale.id}/reply`).set(bearer(owner.token)).send({ templateName: 'order_auto_confirm' })).status).toBe(409);
    } finally {
      await prismaBase.customer.update({ where: { id: customerId }, data: { whatsappOptOut: false } });
    }
  });

  it('needs body or a template, not both; a rep outside their customers gets 404', async () => {
    const conv = await mkConv({ customerId, lastInboundAt: hoursAgo(1) });
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({})).status).toBe(400);
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ body: 'a', templateName: 'b' })).status).toBe(400);
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(otherRep.token)).send({ body: 'hi' })).status).toBe(404);
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(rep.token)).send({ body: 'hi' })).status).toBe(201);
  });
});

describe('PATCH /api/conversations/:id', () => {
  it('assigns and marks done, and notifies the new assignee once', async () => {
    const conv = await mkConv({ customerId });
    const res = await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(owner.token)).send({ assignedToId: manager.id, status: 'done' });
    expect(res.status).toBe(200);
    expect(await prismaBase.conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({ assignedToId: manager.id, status: 'done' });
    const n = await prismaBase.notification.findMany({ where: { tenantId: tenantA, subjectType: 'conversation', subjectId: conv.id, userId: manager.id } });
    expect(n).toHaveLength(1);
    await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(owner.token)).send({ assignedToId: manager.id }).expect(200);
    expect(await prismaBase.notification.count({ where: { tenantId: tenantA, subjectType: 'conversation', subjectId: conv.id, userId: manager.id } })).toBe(1);
    await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(owner.token)).send({ assignedToId: null }).expect(200);
  });

  it('a user of another tenant cannot be assigned (400); another tenant conversation is 404', async () => {
    const conv = await mkConv();
    expect((await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(owner.token)).send({ assignedToId: ownerB.id })).status).toBe(400);
    expect((await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(ownerB.token)).send({ status: 'done' })).status).toBe(404);
    expect((await request(app).get(`/api/conversations/${conv.id}/messages`).set(bearer(ownerB.token))).status).toBe(404);
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(ownerB.token)).send({ body: 'x' })).status).toBe(404);
  });

  it('needs a login', async () => {
    expect((await request(app).get('/api/conversations')).status).toBe(401);
  });
});
