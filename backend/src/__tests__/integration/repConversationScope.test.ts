/** A call rep reads and answers only (A) conversations of a customer with their order and (B) conversations assigned to them; starts a chat from their own order. */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, mkUser, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { whatsappCloudProvider } from '../../services/messaging/providers';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

let pair: TwoTenants;
let rep2: { id: number; token: string };
let templateId: number;
let seq = 0;
const SUFFIX = Date.now();
const rep = () => pair.a.users.salesRep;
const owner = () => pair.a.users.admin;
const get = (token: string, path: string) => request(app).get(path).set(bearer(token));
const mkConv = (data: Record<string, unknown> = {}) => prismaBase.conversation.create({
  data: { tenantId: pair.a.id, channel: 'whatsapp', phone: `+23327${String(SUFFIX).slice(-5)}${String(seq++).padStart(2, '0')}`, lastMessageAt: new Date(), ...data } as any,
});

beforeAll(async () => {
  pair = await createTwoTenants('repconv');
  rep2 = await mkUser(pair.a.id, 'rep2', 'sales_rep');
  templateId = (await prismaBase.messageTemplate.create({
    data: { tenantId: pair.a.id, channel: 'whatsapp', name: 'Hi', body: 'Hello', language: 'en_US', metaTemplateName: 'hi_there', metaStatus: 'APPROVED' },
  })).id;
}, 30000);
afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});
beforeEach(async () => {
  await prismaBase.conversation.deleteMany({ where: { tenantId: pair.a.id } });
  await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { customerRepId: rep().id, deletedAt: null } });
  jest.spyOn(whatsappCloudProvider, 'isEnabled').mockResolvedValue(true);
  jest.spyOn(whatsappCloudProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `wa-r-${SUFFIX}-${seq++}` }));
});

describe('rep scope on the conversation API', () => {
  it('the list holds A (customer has the rep order) and B (assigned), nothing else', async () => {
    const a = await mkConv({ customerId: pair.a.ids.customer });
    const b = await mkConv({ assignedToId: rep().id });
    const other = await mkConv({ assignedToId: rep2.id });
    const stranger = await mkConv();
    const ids = (await get(rep().token, '/api/conversations')).body.items.map((i: any) => i.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
    const ownerIds = (await get(owner().token, '/api/conversations')).body.items.map((i: any) => i.id);
    expect(ownerIds).toEqual(expect.arrayContaining([a.id, b.id, other.id, stranger.id]));
  });

  it('a conversation that is not theirs is 404 to open, reply and mark done', async () => {
    const other = await mkConv({ assignedToId: rep2.id });
    expect((await get(rep().token, `/api/conversations/${other.id}/messages`)).status).toBe(404);
    expect((await request(app).post(`/api/conversations/${other.id}/reply`).set(bearer(rep().token)).send({ templateId })).status).toBe(404);
    expect((await request(app).patch(`/api/conversations/${other.id}`).set(bearer(rep().token)).send({ status: 'done' })).status).toBe(404);
  });

  it('the customer order moves to another rep: the conversation leaves the first rep', async () => {
    const a = await mkConv({ customerId: pair.a.ids.customer });
    expect((await get(rep().token, `/api/conversations/${a.id}/messages`)).status).toBe(200);
    await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { customerRepId: rep2.id } });
    expect((await get(rep().token, `/api/conversations/${a.id}/messages`)).status).toBe(404);
  });

  it('a rep reply inside 24 hours sends free text; outside it needs a template (422)', async () => {
    const open = await mkConv({ assignedToId: rep().id, lastInboundAt: new Date() });
    const closed = await mkConv({ assignedToId: rep().id, lastInboundAt: new Date(Date.now() - 30 * 3600_000) });
    expect((await request(app).post(`/api/conversations/${open.id}/reply`).set(bearer(rep().token)).send({ body: 'Hi' })).status).toBe(201);
    expect((await request(app).post(`/api/conversations/${closed.id}/reply`).set(bearer(rep().token)).send({ body: 'Hi' })).status).toBe(422);
    expect((await request(app).post(`/api/conversations/${closed.id}/reply`).set(bearer(rep().token)).send({ templateId })).status).toBe(201);
  });
});

describe('GET /api/conversations/:id', () => {
  it('gives the list row of a conversation that is theirs and 404 for another rep one', async () => {
    const mine = await mkConv({ assignedToId: rep().id });
    const other = await mkConv({ assignedToId: rep2.id });
    expect((await get(rep().token, `/api/conversations/${mine.id}`)).body).toMatchObject({ id: mine.id, displayName: mine.phone });
    expect((await get(rep().token, `/api/conversations/${other.id}`)).status).toBe(404);
  });
});

describe('open a chat from an order (the rep WhatsApp button)', () => {
  it('for-order says there is no conversation yet, and start creates it on the first send (template)', async () => {
    const before = await get(rep().token, `/api/conversations/for-order/${pair.a.ids.order}`);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ conversationId: null, windowOpen: false });
    const sent = await request(app).post('/api/conversations/start').set(bearer(rep().token)).send({ orderId: pair.a.ids.order, templateId });
    expect(sent.status).toBe(201);
    const after = await get(rep().token, `/api/conversations/for-order/${pair.a.ids.order}`);
    expect(after.body.conversationId).toBe(sent.body.conversationId);
    expect((await get(rep().token, `/api/conversations/${sent.body.conversationId}/messages`)).status).toBe(200);
  });

  it('free text on a new thread is refused (no 24 hour window)', async () => {
    const res = await request(app).post('/api/conversations/start').set(bearer(rep().token)).send({ orderId: pair.a.ids.order, body: 'Hi' });
    expect(res.status).toBe(422);
  });

  it('for-order finds an existing conversation under the same phone and links its customer', async () => {
    const customer = await prismaBase.customer.findUniqueOrThrow({ where: { id: pair.a.ids.customer } });
    const existing = await mkConv({ phone: customer.phoneNumber.startsWith('+') ? customer.phoneNumber : `+${customer.phoneNumber.replace(/\D/g, '')}`, lastInboundAt: new Date() });
    const res = await get(rep().token, `/api/conversations/for-order/${pair.a.ids.order}`);
    expect(res.body).toMatchObject({ conversationId: existing.id, windowOpen: true });
    expect((await get(rep().token, `/api/conversations/${existing.id}/messages`)).status).toBe(200);
  });

  it('an order that is not theirs is 404 for for-order and start; a manager may open any', async () => {
    await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { customerRepId: rep2.id } });
    expect((await get(rep().token, `/api/conversations/for-order/${pair.a.ids.order}`)).status).toBe(404);
    expect((await request(app).post('/api/conversations/start').set(bearer(rep().token)).send({ orderId: pair.a.ids.order, templateId })).status).toBe(404);
    expect((await get(owner().token, `/api/conversations/for-order/${pair.a.ids.order}`)).status).toBe(200);
  });

  it('whatsapp-status reports the connection', async () => {
    expect((await get(rep().token, '/api/conversations/whatsapp-status')).body).toEqual({ connected: true });
    (whatsappCloudProvider.isEnabled as any).mockResolvedValue(false);
    expect((await get(rep().token, '/api/conversations/whatsapp-status')).body).toEqual({ connected: false });
  });
});
