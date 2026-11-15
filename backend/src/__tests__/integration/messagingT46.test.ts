/**
 * M9-T46 (COD-85): the messaging cases no earlier suite pins down.
 * 1. Status events over separate callbacks: out of order and repeated.
 * 2. Inbound: the local STOP words, one channel only, and a reply to a finished conversation.
 * 3. Message totals: /api/messages figures equal a hand-counted fixture, per channel and for one date range.
 * 4. Two tenants: B's messages, conversations, templates and opt-outs show on no messages endpoint of A, and the other way round.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, createTwoTenants, deleteTenantRows, mkUser, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { clearWhatsAppConfigCache } from '../../services/whatsappService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
const phoneId = `wa-t46-${SUFFIX}`;
const secret = `secret-t46-${SUFFIX}`;
const sign = (raw: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const waitFor = async (check: () => Promise<boolean>, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};
let seq = 0;

let pair: TwoTenants;
let tenantA: string;
let phone: string;
let customerId: number;

const waPost = (body: object) => {
  const raw = JSON.stringify(body);
  return request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw);
};
const statusCallback = (statuses: any[]) =>
  waPost({ entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, statuses } }] }] });
const inboundText = (text: string) => waPost({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId }, messages: [
    { from: phone.replace(/^\+/, ''), id: `wamid.t46.${SUFFIX}.${seq++}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } },
  ] } }] }],
});

beforeAll(async () => {
  pair = await createTwoTenants('t46');
  tenantA = pair.a.id;
  phone = pair.a.phone;
  customerId = pair.a.ids.customer;
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

describe('status events over separate callbacks', () => {
  it('read before delivered, then sent last, then the same read again: status stays read, each event once', async () => {
    const pid = `pid-t46-${SUFFIX}`;
    const log = await prismaBase.messageLog.create({
      data: { tenantId: tenantA, channel: 'whatsapp', direction: 'outbound', messageBody: 'x', status: 'pending', provider: 'whatsapp_cloud', providerMessageId: pid, customerId, metadata: { to: phone.replace(/^\+/, '') } } as any,
    });
    const t = Math.floor(Date.now() / 1000);
    await statusCallback([{ id: pid, status: 'read', timestamp: String(t + 20) }]).expect(200);
    expect(await waitFor(async () => (await prismaBase.messageLog.findUnique({ where: { id: log.id } }))?.status === 'read')).toBe(true);
    await statusCallback([{ id: pid, status: 'delivered', timestamp: String(t + 10) }]).expect(200);
    await statusCallback([{ id: pid, status: 'sent', timestamp: String(t) }]).expect(200);
    await statusCallback([{ id: pid, status: 'read', timestamp: String(t + 20) }]).expect(200);
    expect(await waitFor(async () => (await prismaBase.messageEvent.count({ where: { messageLogId: log.id } })) === 3)).toBe(true);
    await new Promise((r) => setTimeout(r, 300)); // a late duplicate would need a moment to show

    const row = await prismaBase.messageLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(row.status).toBe('read');
    expect(row.sentAt!.getTime()).toBe(t * 1000);
    expect(row.deliveredAt!.getTime()).toBe((t + 10) * 1000);
    expect(row.readAt!.getTime()).toBe((t + 20) * 1000);
    for (const status of ['sent', 'delivered', 'read'] as const) {
      expect(await prismaBase.messageEvent.count({ where: { messageLogId: log.id, status } })).toBe(1);
    }
  });
});

describe('inbound WhatsApp: STOP words and a finished conversation', () => {
  const flags = () => prismaBase.customer.findUniqueOrThrow({ where: { id: customerId }, select: { whatsappOptOut: true, smsOptOut: true, emailOptOut: true } });

  it.each(['stop', 'Unsubscribe', 'STOP ALL', ' Stop! '])('"%s" opts out WhatsApp only, and START brings it back', async (word) => {
    await inboundText(word).expect(200);
    expect(await waitFor(async () => (await flags()).whatsappOptOut === true)).toBe(true);
    expect(await flags()).toEqual({ whatsappOptOut: true, smsOptOut: false, emailOptOut: false });
    expect(await prismaBase.optOutEvent.count({ where: { tenantId: tenantA, customerId, reason: 'stop_reply', optedOut: true, channel: { not: 'whatsapp' } } })).toBe(0);

    await inboundText('start').expect(200);
    expect(await waitFor(async () => (await flags()).whatsappOptOut === false)).toBe(true);
  });

  it('a reply to a conversation marked done reopens that same conversation and sets it unanswered', async () => {
    await inboundText('Hello there').expect(200);
    expect(await waitFor(async () => (await prismaBase.conversation.count({ where: { tenantId: tenantA, phone } })) === 1)).toBe(true);
    await prismaBase.conversation.updateMany({ where: { tenantId: tenantA, phone }, data: { status: 'done', unanswered: false } });

    await inboundText('One more thing').expect(200);
    expect(await waitFor(async () => (await prismaBase.conversation.findFirst({ where: { tenantId: tenantA, phone } }))?.status === 'open')).toBe(true);
    const conv = await prismaBase.conversation.findMany({ where: { tenantId: tenantA, phone } });
    expect(conv).toHaveLength(1);
    expect(conv[0]).toMatchObject({ status: 'open', unanswered: true });
  });
});

describe('totals contract against a hand-counted fixture', () => {
  let t: string;
  let other: string;
  let owner: { id: number; token: string };
  const IN = new Date('2026-03-10T12:00:00Z');
  const BEFORE = new Date('2026-03-09T12:00:00Z');
  const AFTER = new Date('2026-03-11T12:00:00Z');
  const mk = (tenantId: string, channel: string, status: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
    prismaBase.messageLog.create({
      data: { tenantId, channel, status, createdAt, direction: 'outbound', messageBody: 'x', provider: 'x', providerMessageId: `t46fig-${SUFFIX}-${seq++}`, ...extra } as any,
    });
  // Rows inside the range, per channel and status
  const SPEC: Record<string, Record<string, number>> = {
    whatsapp: { pending: 1, sent: 2, delivered: 3, read: 1, failed: 1, replied: 2, skipped: 1 },
    sms: { sent: 1, delivered: 2, failed: 2, skipped: 1 },
    email: { delivered: 1, read: 1 },
  };
  // sent = sent+delivered+read+replied+failed; delivered = delivered+read+replied; read = read+replied
  const EXPECTED: Record<string, Record<string, number>> = {
    whatsapp: { sent: 9, delivered: 6, read: 3, failed: 1, replied: 2, skipped: 1 },
    sms: { sent: 5, delivered: 2, read: 0, failed: 2, replied: 0, skipped: 1 },
    email: { sent: 2, delivered: 2, read: 1, failed: 0, replied: 0, skipped: 0 },
  };
  const TOTAL = { sent: 16, delivered: 10, read: 4, failed: 3, replied: 2, skipped: 2 };

  beforeAll(async () => {
    t = (await createTenant('T46 Fig')).id;
    other = (await createTenant('T46 Fig other')).id;
    owner = await mkUser(t, 'owner', 'super_admin');
    for (const [channel, byStatus] of Object.entries(SPEC)) {
      for (const [status, n] of Object.entries(byStatus)) {
        for (let i = 0; i < n; i++) await mk(t, channel, status, IN);
      }
      // Outside the range: must not count with from/to
      await mk(t, channel, 'replied', BEFORE);
      await mk(t, channel, 'delivered', AFTER);
      // Never counted: an inbound row and another tenant's row
      await mk(t, channel, 'delivered', IN, { direction: 'inbound' });
      await mk(other, channel, 'delivered', IN);
    }
  }, 60000);
  afterAll(async () => { await deleteTenantRows([t, other]); });

  it('with from and to, every channel figure equals the fixture count and the total is their sum', async () => {
    const res = await request(app).get('/api/messages/overview?from=2026-03-10&to=2026-03-10').set(bearer(owner.token));
    expect(res.status).toBe(200);
    for (const channel of Object.keys(EXPECTED)) expect(res.body.channels[channel]).toMatchObject(EXPECTED[channel]);
    expect(res.body.total).toMatchObject(TOTAL);
  });

  it('one channel filter gives the same numbers as that channel in the full overview', async () => {
    for (const channel of Object.keys(EXPECTED)) {
      const res = await request(app).get(`/api/messages/overview?channel=${channel}&from=2026-03-10&to=2026-03-10`).set(bearer(owner.token));
      expect(res.body.channels[channel]).toMatchObject(EXPECTED[channel]);
    }
  });

  it('the log total of each figure equals the fixture number for the same range and channel', async () => {
    for (const channel of Object.keys(EXPECTED)) {
      for (const [figure, n] of Object.entries(EXPECTED[channel])) {
        const res = await request(app).get(`/api/messages/log?limit=1&channel=${channel}&status=${figure}&from=2026-03-10&to=2026-03-10`).set(bearer(owner.token));
        expect({ channel, figure, total: res.body.total }).toEqual({ channel, figure, total: n });
      }
    }
  });

  it('without a range the older and newer rows count too', async () => {
    const res = await request(app).get('/api/messages/overview?channel=sms').set(bearer(owner.token));
    expect(res.body.channels.sms).toMatchObject({ sent: 5 + 2, delivered: 2 + 2, replied: 1 });
  });
});

describe('two tenants on every messages endpoint', () => {
  const seedSide = async (side: 'a' | 'b') => {
    const x = pair[side];
    const convPhone = `+23327${side === 'a' ? '1' : '2'}${String(SUFFIX).slice(-7)}`;
    const conv = await prismaBase.conversation.create({ data: { tenantId: x.id, channel: 'whatsapp', phone: convPhone, customerId: x.ids.customer, lastMessageAt: new Date() } });
    const msg = await prismaBase.messageLog.create({
      data: { tenantId: x.id, channel: 'whatsapp', direction: 'outbound', messageBody: `body ${x.marker}`, status: 'delivered', provider: 'whatsapp_cloud', providerMessageId: `t46sweep-${x.marker}`, customerId: x.ids.customer, conversationId: conv.id, metadata: { to: convPhone.slice(1) } } as any,
    });
    const tpl = await prismaBase.messageTemplate.create({ data: { tenantId: x.id, channel: 'sms', name: `Tpl ${x.marker}`, body: `tpl ${x.marker}` } });
    await prismaBase.customer.update({ where: { id: x.ids.customer }, data: { whatsappOptOut: true } });
    await prismaBase.optOutEvent.create({ data: { tenantId: x.id, customerId: x.ids.customer, phone: x.phone, channel: 'whatsapp', optedOut: true, reason: 'stop_reply' } });
    return { conv, msg, tpl };
  };
  let rows: Record<'a' | 'b', Awaited<ReturnType<typeof seedSide>>>;

  beforeAll(async () => { rows = { a: await seedSide('a'), b: await seedSide('b') }; });

  it.each([['a', 'b'], ['b', 'a']] as const)('tenant %s sees its own rows and none of tenant %s', async (me, them) => {
    const viewer = pair[me];
    const foe = pair[them];
    const tok = bearer(viewer.users.admin.token);
    const lists = {
      log: await request(app).get('/api/messages/log?limit=100').set(tok),
      conversations: await request(app).get('/api/conversations?limit=100').set(tok),
      templates: await request(app).get('/api/message-templates').set(tok),
      optOuts: await request(app).get('/api/messages/opt-outs').set(tok),
      customerMessages: await request(app).get(`/api/customers/${viewer.ids.customer}/messages`).set(tok),
    };
    for (const [name, res] of Object.entries(lists)) {
      expect({ name, status: res.status }).toEqual({ name, status: 200 });
      const text = JSON.stringify(res.body);
      expect({ name, leaks: text.includes(foe.marker) || text.includes(foe.phone) }).toEqual({ name, leaks: false });
    }
    // The scan is real: each list does hold the viewer's own row
    expect(JSON.stringify(lists.log.body)).toContain(rows[me].msg.id.toString());
    expect(JSON.stringify(lists.conversations.body)).toContain(rows[me].conv.phone);
    expect(JSON.stringify(lists.templates.body)).toContain(viewer.marker);
    expect(JSON.stringify(lists.optOuts.body)).toContain(viewer.marker);

    const ov = await request(app).get('/api/messages/overview').set(tok);
    expect(ov.body.channels.whatsapp.sent).toBe(await prismaBase.messageLog.count({ where: { tenantId: viewer.id, direction: 'outbound', channel: 'whatsapp', status: { in: ['sent', 'delivered', 'read', 'replied', 'failed'] } } }));
  });

  it('A cannot read, change or delete B rows by id: all 404, and B rows stay unchanged', async () => {
    const tok = bearer(pair.a.users.admin.token);
    const { conv, msg, tpl } = rows.b;
    expect((await request(app).get(`/api/conversations/${conv.id}/messages`).set(tok)).status).toBe(404);
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(tok).send({ body: 'hi' })).status).toBe(404);
    expect((await request(app).patch(`/api/conversations/${conv.id}`).set(tok).send({ status: 'done' })).status).toBe(404);
    expect((await request(app).put(`/api/message-templates/${tpl.id}`).set(tok).send({ body: 'hacked' })).status).toBe(404);
    expect((await request(app).delete(`/api/message-templates/${tpl.id}`).set(tok)).status).toBe(404);
    expect((await request(app).post(`/api/messages/${msg.id}/retry`).set(tok)).status).toBe(404);
    expect((await request(app).post(`/api/messages/${msg.id}/resend-sms`).set(tok)).status).toBe(404);
    expect((await request(app).get(`/api/customers/${pair.b.ids.customer}/messages`).set(tok)).status).toBe(404);
    expect((await request(app).get(`/api/customers/${pair.b.ids.customer}/opt-outs`).set(tok)).status).toBe(404);
    expect((await request(app).put(`/api/customers/${pair.b.ids.customer}/opt-outs`).set(tok).send({ channel: 'whatsapp', optedOut: false })).status).toBe(404);

    expect((await prismaBase.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe('open');
    expect((await prismaBase.messageTemplate.findUniqueOrThrow({ where: { id: tpl.id } })).body).toBe(`tpl ${pair.b.marker}`);
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: pair.b.ids.customer } })).whatsappOptOut).toBe(true);
  });
});
