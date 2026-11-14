/**
 * M9-T06 (COD-77): inbound WhatsApp opens conversations, links replies, YES/NO stay out of the inbox, STOP/START write opt-out events.
 */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeOrder } from './helpers/kpiOrders';
import whatsappService, { clearWhatsAppConfigCache } from '../../services/whatsappService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

let pair: TwoTenants;
let tenantA: string;
let customerId: number;
let phone: string;
const SUFFIX = Date.now();
const phoneId = `wa-conv-${SUFFIX}`;
const secret = `secret-conv-${SUFFIX}`;
let seq = 0;

const sign = (raw: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

function payload(from: string, text: string, opts: { id?: string; contextId?: string } = {}) {
  const id = opts.id ?? `wamid.conv.${SUFFIX}.${seq++}`;
  const m: any = { from: from.replace(/^\+/, ''), id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } };
  if (opts.contextId) m.context = { id: opts.contextId };
  return { id, body: { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId }, messages: [m] } }] }] } };
}

async function post(from: string, text: string, opts: { id?: string; contextId?: string } = {}) {
  const p = payload(from, text, opts);
  const raw = JSON.stringify(p.body);
  const res = await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw);
  return { res, id: p.id };
}

const convOf = (p: string) => prismaBase.conversation.findFirst({ where: { tenantId: tenantA, channel: 'whatsapp', phone: p } });
const notifications = (convId: number) => prismaBase.notification.count({ where: { tenantId: tenantA, subjectType: 'conversation', subjectId: convId } });
const outbound = (data: Record<string, unknown> = {}) => prismaBase.messageLog.create({
  data: {
    tenantId: tenantA, channel: 'whatsapp', direction: 'outbound', status: 'delivered', messageBody: 'Hello', provider: 'whatsapp_cloud',
    providerMessageId: `wamid.out.${SUFFIX}.${seq++}`, metadata: { to: phone.replace(/^\+/, '') }, customerId, ...data,
  } as any,
});

beforeAll(async () => {
  pair = await createTwoTenants('convin');
  tenantA = pair.a.id;
  customerId = pair.a.ids.customer;
  phone = pair.a.phone;
  await prismaBase.systemConfig.upsert({
    where: { tenantId: tenantA },
    create: { tenantId: tenantA, whatsappProvider: { isEnabled: true, accessToken: 'tok', phoneNumberId: phoneId, appSecret: secret } as any },
    update: { whatsappProvider: { isEnabled: true, accessToken: 'tok', phoneNumberId: phoneId, appSecret: secret } as any },
  });
  clearWhatsAppConfigCache();
}, 60000);

afterAll(async () => {
  clearWhatsAppConfigCache();
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('inbound WhatsApp conversations', () => {
  let spy: any;
  beforeEach(() => { spy = jest.spyOn(whatsappService, 'sendText').mockImplementation(async () => ({ messageLogId: 999, sent: true })); });
  afterEach(() => spy?.mockRestore());

  it('opens a conversation for a customer, writes the log row, sets unanswered and notifies the rep of the open order', async () => {
    const order = await makeOrder({ tenantId: tenantA, customerId, status: 'confirmed', paymentMethod: 'cod', orderType: 'physical' } as any);
    await prismaBase.order.update({ where: { id: order.id }, data: { customerRepId: pair.a.users.salesRep.id } });
    const { res, id } = await post(phone, 'Where is my order?');
    expect(res.status).toBe(200);
    const conv = (await convOf(phone))!;
    expect(conv).toMatchObject({ customerId, status: 'open', unanswered: true });
    expect(conv.lastInboundAt).not.toBeNull();
    const log = await prismaBase.messageLog.findFirstOrThrow({ where: { providerMessageId: id } });
    expect(log).toMatchObject({ conversationId: conv.id, direction: 'inbound', provider: 'whatsapp_cloud', tenantId: tenantA });
    const n = await prismaBase.notification.findMany({ where: { tenantId: tenantA, subjectType: 'conversation', subjectId: conv.id } });
    expect(n.map((x) => x.userId)).toEqual([pair.a.users.salesRep.id]);
    expect(n[0].kind).toBe('reply');
  });

  it('a repeat webhook for the same message id writes nothing new', async () => {
    const first = await post(phone, 'Hello again');
    const conv = (await convOf(phone))!;
    const before = { logs: await prismaBase.messageLog.count({ where: { conversationId: conv.id } }), n: await notifications(conv.id) };
    await post(phone, 'Hello again', { id: first.id });
    expect(await prismaBase.messageLog.count({ where: { conversationId: conv.id } })).toBe(before.logs);
    expect(await notifications(conv.id)).toBe(before.n);
  });

  it('an unknown number opens a conversation with no customer, and the owner is told', async () => {
    const unknown = `+23324${String(SUFFIX).slice(-7)}`;
    await post(unknown, 'Hi, price?');
    const conv = (await convOf(unknown))!;
    expect(conv.customerId).toBeNull();
    const n = await prismaBase.notification.findMany({ where: { tenantId: tenantA, subjectType: 'conversation', subjectId: conv.id } });
    expect(n.map((x) => x.userId)).toContain(pair.a.users.admin.id);
  });

  it('links the reply to the outbound message by context id and sets it replied', async () => {
    const out = await outbound();
    const { id } = await post(phone, 'Thanks', { contextId: out.providerMessageId! });
    const log = await prismaBase.messageLog.findFirstOrThrow({ where: { providerMessageId: id } });
    expect(log.inReplyToId).toBe(out.id);
    const after = await prismaBase.messageLog.findUniqueOrThrow({ where: { id: out.id } });
    expect(after.status).toBe('replied');
    expect(after.repliedAt).not.toBeNull();
  });

  it('without a context id, links to the latest outbound to that number in the last 7 days', async () => {
    await outbound({ createdAt: new Date(Date.now() - 10 * 86400_000) });
    const latest = await outbound();
    const { id } = await post(phone, 'ok noted');
    expect((await prismaBase.messageLog.findFirstOrThrow({ where: { providerMessageId: id } })).inReplyToId).toBe(latest.id);
  });

  it('an assigned conversation notifies the assignee, not the order rep', async () => {
    const conv = (await convOf(phone))!;
    await prismaBase.conversation.update({ where: { id: conv.id }, data: { assignedToId: pair.a.users.admin.id } });
    const before = await prismaBase.notification.count({ where: { tenantId: tenantA, subjectType: 'conversation', subjectId: conv.id, userId: pair.a.users.admin.id } });
    await post(phone, 'Another question');
    expect(await prismaBase.notification.count({ where: { tenantId: tenantA, subjectType: 'conversation', subjectId: conv.id, userId: pair.a.users.admin.id } })).toBe(before + 1);
    await prismaBase.conversation.update({ where: { id: conv.id }, data: { assignedToId: null } });
  });

  it('YES confirms the order through M7, is stored in the thread, makes no notification and does not set unanswered', async () => {
    const conv = (await convOf(phone))!;
    await prismaBase.conversation.update({ where: { id: conv.id }, data: { unanswered: false, status: 'done' } });
    const order = await makeOrder({ tenantId: tenantA, customerId, status: 'pending_confirmation', paymentMethod: 'cod', orderType: 'physical' } as any);
    await prismaBase.order.update({ where: { id: order.id }, data: { autoConfirmSentAt: new Date() } });
    await prismaBase.confirmToken.create({ data: { tenantId: tenantA, orderId: order.id, token: `tok-${SUFFIX}`, channel: 'whatsapp', expiresAt: new Date(Date.now() + 86400000) } });
    const before = await notifications(conv.id);
    const { id } = await post(phone, ' YES. ');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } })).customerResponse).toBe('yes');
    const log = await prismaBase.messageLog.findFirstOrThrow({ where: { providerMessageId: id } });
    expect(log).toMatchObject({ conversationId: conv.id, orderId: order.id });
    const after = await convOf(phone);
    expect(after).toMatchObject({ unanswered: false, status: 'open' });
    expect(await notifications(conv.id)).toBe(before);
  });

  it('STOP sets the opt-out and writes an OptOutEvent; no reply, no notification; START re-subscribes', async () => {
    const conv = (await convOf(phone))!;
    const before = await notifications(conv.id);
    spy.mockClear();
    await post(phone, 'stop');
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: customerId } })).whatsappOptOut).toBe(true);
    expect(await prismaBase.optOutEvent.findFirst({ where: { tenantId: tenantA, customerId, reason: 'stop_reply', channel: 'whatsapp', optedOut: true } })).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
    const { id } = await post(phone, 'START');
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: customerId } })).whatsappOptOut).toBe(false);
    expect(await prismaBase.optOutEvent.findFirst({ where: { tenantId: tenantA, customerId, reason: 'resubscribe', optedOut: false } })).not.toBeNull();
    expect((await prismaBase.messageLog.findFirstOrThrow({ where: { providerMessageId: id } })).conversationId).toBe(conv.id);
    expect(await notifications(conv.id)).toBe(before);
  });

  it('a bad signature is 401 and writes nothing', async () => {
    const p = payload(phone, 'forged');
    const res = await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', 'sha256=bad').send(JSON.stringify(p.body));
    expect(res.status).toBe(401);
    expect(await prismaBase.messageLog.findFirst({ where: { providerMessageId: p.id } })).toBeNull();
  });
});
