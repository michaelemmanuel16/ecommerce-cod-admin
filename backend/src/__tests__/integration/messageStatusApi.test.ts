/**
 * M9-T05 (COD-77): status callbacks write MessageEvent rows and move the log forward only;
 * early events are held; POST /api/messages/:id/retry and /resend-sms; tenant isolation.
 */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { arkeselSmsProvider, whatsappCloudProvider } from '../../services/messaging/providers';
import { messageStatus } from '../../services/messaging/messageStatus';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();
const secret = `secret-${SUFFIX}`;
const phoneId = `9${SUFFIX}`;
const sign = (raw: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const waitFor = async (check: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

let tenantA: string;
let tenantB: string;
let customerId: number;
let orderId: number;
let owner: { id: number; token: string };
let manager: { id: number; token: string };
let rep: { id: number; token: string };
let otherRep: { id: number; token: string };
let ownerB: { id: number; token: string };
let seq = 0;

const mkLog = (data: Record<string, unknown> = {}) =>
  prismaBase.messageLog.create({
    data: {
      tenantId: tenantA, channel: 'whatsapp', messageBody: 'Your order is out', status: 'failed', errorMessage: 'boom',
      customerId, orderId, direction: 'outbound', provider: 'whatsapp_cloud', metadata: { to: '233241110000' },
      providerMessageId: `pid-${SUFFIX}-${seq++}`, ...data,
    } as any,
  });

beforeAll(async () => {
  const a = await createTenant('Msg A');
  const b = await createTenant('Msg B');
  tenantA = a.id;
  tenantB = b.id;
  owner = await mkUser(tenantA, 'owner', 'super_admin');
  manager = await mkUser(tenantA, 'mgr', 'manager');
  rep = await mkUser(tenantA, 'rep', 'sales_rep');
  otherRep = await mkUser(tenantA, 'rep2', 'sales_rep');
  ownerB = await mkUser(tenantB, 'ownerb', 'super_admin');
  const customer = await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'T', phoneNumber: `+23355${String(SUFFIX).slice(-7)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: tenantA },
  });
  customerId = customer.id;
  const order = await prismaBase.order.create({
    data: {
      customerId, subtotal: 10, shippingCost: 0, totalAmount: 10, deliveryAddress: '1 St', deliveryState: 'Greater Accra',
      deliveryArea: 'Accra', tenantId: tenantA, customerRepId: rep.id,
    } as any,
  });
  orderId = order.id;
  await prismaBase.systemConfig.create({
    data: { tenantId: tenantA, whatsappProvider: { isEnabled: true, accessToken: 'tok', phoneNumberId: phoneId, appSecret: secret } as any },
  });
});

afterAll(async () => {
  await prismaBase.pendingMessageEvent.deleteMany({ where: { providerMessageId: { contains: String(SUFFIX) } } });
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});

describe('callback authentication and provider match', () => {
  it('a WhatsApp callback cannot change a row of another provider', async () => {
    const log = await mkLog({ channel: 'sms', status: 'sent', errorMessage: null, provider: 'arkesel' });
    const raw = JSON.stringify({ entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, statuses: [{ id: log.providerMessageId, status: 'read' }] } }] }] });
    await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect((await prismaBase.messageLog.findUnique({ where: { id: log.id } }))!.status).toBe('sent');
    expect(await prismaBase.messageEvent.count({ where: { messageLogId: log.id } })).toBe(0);
  });

  it('with ARKESEL_CALLBACK_TOKEN set, a wrong or missing token is 401 and the right one is accepted', async () => {
    process.env.ARKESEL_CALLBACK_TOKEN = `tok-${SUFFIX}`;
    try {
      const log = await mkLog({ channel: 'sms', status: 'sent', errorMessage: null, provider: 'arkesel' });
      const body = { messageId: log.providerMessageId, status: 'delivered' };
      await request(app).post('/api/sms/webhook?token=wrong').send(body).expect(401);
      await request(app).post('/api/sms/webhook').send(body).expect(401);
      await new Promise((r) => setTimeout(r, 200));
      expect((await prismaBase.messageLog.findUnique({ where: { id: log.id } }))!.status).toBe('sent');
      await request(app).post(`/api/sms/webhook?token=tok-${SUFFIX}`).send(body).expect(200);
      expect(await waitFor(async () => (await prismaBase.messageLog.findUnique({ where: { id: log.id } }))?.status === 'delivered')).toBe(true);
    } finally {
      delete process.env.ARKESEL_CALLBACK_TOKEN;
    }
  });

  it('an Arkesel callback cannot change a WhatsApp row', async () => {
    const log = await mkLog({ status: 'sent', errorMessage: null });
    await request(app).post('/api/sms/webhook').send({ messageId: log.providerMessageId, status: 'delivered' }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect((await prismaBase.messageLog.findUnique({ where: { id: log.id } }))!.status).toBe('sent');
  });

  it('a held event of another provider is not applied to a row with that id', async () => {
    const pid = `xprov-${SUFFIX}`;
    await prismaBase.pendingMessageEvent.create({
      data: { provider: 'arkesel', providerMessageId: pid, status: 'delivered', payload: { occurredAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const log = await mkLog({ status: 'sent', errorMessage: null, providerMessageId: pid });
    expect(await messageStatus.applyPending(pid, 'whatsapp_cloud')).toBe(0);
    expect((await prismaBase.messageLog.findUnique({ where: { id: log.id } }))!.status).toBe('sent');
    expect(await prismaBase.pendingMessageEvent.count({ where: { providerMessageId: pid } })).toBe(1);
  });
});

describe('Arkesel callback', () => {
  it('writes an event, moves the status forward and never back', async () => {
    const log = await mkLog({ channel: 'sms', status: 'sent', errorMessage: null, provider: 'arkesel' });
    await request(app).post('/api/sms/webhook').send({ messageId: log.providerMessageId, status: 'delivered' }).expect(200);
    expect(await waitFor(async () => (await prismaBase.messageLog.findUnique({ where: { id: log.id } }))?.status === 'delivered')).toBe(true);
    const row = await prismaBase.messageLog.findUnique({ where: { id: log.id } });
    expect(row!.deliveredAt).not.toBeNull();
    expect(await prismaBase.messageEvent.count({ where: { messageLogId: log.id, status: 'delivered', tenantId: tenantA } })).toBe(1);

    // A late "failed" after delivered: event kept, status stays delivered
    await request(app).post('/api/sms/webhook').send({ messageId: log.providerMessageId, status: 'failed' }).expect(200);
    expect(await waitFor(async () => (await prismaBase.messageEvent.count({ where: { messageLogId: log.id, status: 'failed' } })) === 1)).toBe(true);
    expect((await prismaBase.messageLog.findUnique({ where: { id: log.id } }))!.status).toBe('delivered');
  });
});

describe('WhatsApp callback', () => {
  const post = (statuses: any[]) => {
    const raw = JSON.stringify({ entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, statuses } }] }] });
    return request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', sign(raw)).send(raw);
  };

  it('records sent, delivered and read events with times, once each', async () => {
    const log = await mkLog({ status: 'pending', errorMessage: null });
    const t = Math.floor(Date.now() / 1000);
    await post([
      { id: log.providerMessageId, status: 'read', timestamp: String(t + 20) },
      { id: log.providerMessageId, status: 'sent', timestamp: String(t) },
      { id: log.providerMessageId, status: 'delivered', timestamp: String(t + 10) },
      { id: log.providerMessageId, status: 'delivered', timestamp: String(t + 11) },
    ]).expect(200);
    expect(await waitFor(async () => (await prismaBase.messageEvent.count({ where: { messageLogId: log.id } })) === 3)).toBe(true);
    const row = await prismaBase.messageLog.findUnique({ where: { id: log.id } });
    expect(row!.status).toBe('read');
    expect(row!.sentAt!.getTime()).toBe(t * 1000);
    expect(row!.deliveredAt!.getTime()).toBe((t + 10) * 1000);
    expect(row!.readAt!.getTime()).toBe((t + 20) * 1000);
  });

  it('maps a failure code to readable text', async () => {
    const log = await mkLog({ status: 'sent', errorMessage: null });
    await post([{ id: log.providerMessageId, status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] }]).expect(200);
    expect(await waitFor(async () => (await prismaBase.messageLog.findUnique({ where: { id: log.id } }))?.status === 'failed')).toBe(true);
    const ev = await prismaBase.messageEvent.findFirstOrThrow({ where: { messageLogId: log.id, status: 'failed' } });
    expect(ev.failureReason).toMatch(/24 hours/);
    expect((await prismaBase.messageLog.findUnique({ where: { id: log.id } }))!.errorMessage).toMatch(/24 hours/);
  });

  it('holds an event that arrives before its row, then applies it when the id is stored', async () => {
    const pid = `early-${SUFFIX}`;
    await post([{ id: pid, status: 'delivered' }]).expect(200);
    expect(await waitFor(async () => (await prismaBase.pendingMessageEvent.count({ where: { providerMessageId: pid } })) === 1)).toBe(true);
    const held = await prismaBase.pendingMessageEvent.findFirstOrThrow({ where: { providerMessageId: pid } });
    expect(held.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);

    const log = await mkLog({ status: 'sent', errorMessage: null, providerMessageId: pid });
    expect(await messageStatus.applyPending(pid, 'whatsapp_cloud')).toBe(1);
    expect((await prismaBase.messageLog.findUnique({ where: { id: log.id } }))!.status).toBe('delivered');
    expect(await prismaBase.pendingMessageEvent.count({ where: { providerMessageId: pid } })).toBe(0);
  });
});

describe('retry and resend as SMS', () => {
  beforeEach(() => {
    jest.spyOn(whatsappCloudProvider, 'isEnabled').mockResolvedValue(true);
    jest.spyOn(whatsappCloudProvider, 'send').mockResolvedValue({ accepted: true, providerMessageId: `wa-new-${SUFFIX}-${seq++}` });
    jest.spyOn(arkeselSmsProvider, 'isEnabled').mockResolvedValue(true);
    jest.spyOn(arkeselSmsProvider, 'send').mockResolvedValue({ accepted: true, providerMessageId: `sms-new-${SUFFIX}-${seq++}` });
  });

  it('retry sends again on the same channel and links the new row with retryOfId', async () => {
    const log = await mkLog();
    const res = await request(app).post(`/api/messages/${log.id}/retry`).set(bearer(owner.token));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'sent', sent: true });
    const row = await prismaBase.messageLog.findUniqueOrThrow({ where: { id: res.body.messageLogId } });
    expect(row).toMatchObject({ retryOfId: log.id, channel: 'whatsapp', tenantId: tenantA, orderId, customerId });
  });

  it('retry of a message that did not fail is 409', async () => {
    const log = await mkLog({ status: 'delivered', errorMessage: null });
    const res = await request(app).post(`/api/messages/${log.id}/retry`).set(bearer(owner.token));
    expect(res.status).toBe(409);
  });

  it('resend-sms sends the body as SMS and links the new row with fallbackOfId', async () => {
    const log = await mkLog();
    const res = await request(app).post(`/api/messages/${log.id}/resend-sms`).set(bearer(manager.token));
    expect(res.status).toBe(201);
    const row = await prismaBase.messageLog.findUniqueOrThrow({ where: { id: res.body.messageLogId } });
    expect(row).toMatchObject({ fallbackOfId: log.id, channel: 'sms', messageBody: 'Your order is out' });
    expect(arkeselSmsProvider.send).toHaveBeenCalledWith(expect.objectContaining({ to: '233241110000', body: 'Your order is out' }));
  });

  it("the order's rep may act; another rep is 403", async () => {
    const log = await mkLog();
    expect((await request(app).post(`/api/messages/${log.id}/retry`).set(bearer(rep.token))).status).toBe(201);
    expect((await request(app).post(`/api/messages/${log.id}/retry`).set(bearer(otherRep.token))).status).toBe(403);
    expect((await request(app).post(`/api/messages/${log.id}/resend-sms`).set(bearer(otherRep.token))).status).toBe(403);
  });

  it('a message of another tenant is 404 on both routes, and nothing is sent', async () => {
    const log = await mkLog();
    const calls = (whatsappCloudProvider.send as jest.Mock).mock.calls.length;
    expect((await request(app).post(`/api/messages/${log.id}/retry`).set(bearer(ownerB.token))).status).toBe(404);
    expect((await request(app).post(`/api/messages/${log.id}/resend-sms`).set(bearer(ownerB.token))).status).toBe(404);
    expect((await request(app).post('/api/messages/99999999/retry').set(bearer(owner.token))).status).toBe(404);
    expect((whatsappCloudProvider.send as jest.Mock).mock.calls.length).toBe(calls);
  });

  it('needs a login', async () => {
    expect((await request(app).post('/api/messages/1/retry')).status).toBe(401);
  });
});

describe('M9 wave 3 gates', () => {
  beforeEach(() => {
    jest.spyOn(whatsappCloudProvider, 'isEnabled').mockResolvedValue(true);
    jest.spyOn(whatsappCloudProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `wa-g-${SUFFIX}-${seq++}` }));
    jest.spyOn(arkeselSmsProvider, 'isEnabled').mockResolvedValue(true);
    jest.spyOn(arkeselSmsProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `sms-g-${SUFFIX}-${seq++}` }));
  });

  it('in production a missing ARKESEL_CALLBACK_TOKEN refuses the callback with 401', async () => {
    const env = process.env.NODE_ENV;
    delete process.env.ARKESEL_CALLBACK_TOKEN;
    process.env.NODE_ENV = 'production';
    try {
      await request(app).post('/api/sms/webhook').send({ messageId: 'x', status: 'delivered' }).expect(401);
    } finally {
      process.env.NODE_ENV = env;
    }
  });

  it('two parallel retries make one row', async () => {
    const log = await mkLog();
    const [a, b] = await Promise.all([
      request(app).post(`/api/messages/${log.id}/retry`).set(bearer(owner.token)),
      request(app).post(`/api/messages/${log.id}/retry`).set(bearer(manager.token)),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prismaBase.messageLog.count({ where: { retryOfId: log.id } })).toBe(1);
  });

  it('a retry is refused while a live retry exists, and after 3 retries in the chain', async () => {
    const log = await mkLog();
    await mkLog({ retryOfId: log.id, status: 'sent', errorMessage: null });
    expect((await request(app).post(`/api/messages/${log.id}/retry`).set(bearer(owner.token))).status).toBe(409);

    const root = await mkLog();
    const r1 = await mkLog({ retryOfId: root.id });
    const r2 = await mkLog({ retryOfId: r1.id });
    await mkLog({ retryOfId: r2.id });
    const res = await request(app).post(`/api/messages/${root.id}/retry`).set(bearer(owner.token));
    expect(res.status).toBe(409);
    expect(res.body.code ?? res.body.error?.code ?? JSON.stringify(res.body)).toContain('MESSAGE_RETRY_LIMIT');
  });

  it('two parallel resends as SMS make one row', async () => {
    const log = await mkLog();
    const [a, b] = await Promise.all([
      request(app).post(`/api/messages/${log.id}/resend-sms`).set(bearer(owner.token)),
      request(app).post(`/api/messages/${log.id}/resend-sms`).set(bearer(manager.token)),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prismaBase.messageLog.count({ where: { fallbackOfId: log.id } })).toBe(1);
  });

  it('resend as SMS: a fresh sent or a delivered message is 409; sent for 10 minutes, or skipped, is allowed; a failed fallback does not block', async () => {
    const fresh = await mkLog({ status: 'sent', errorMessage: null, sentAt: new Date() });
    expect((await request(app).post(`/api/messages/${fresh.id}/resend-sms`).set(bearer(owner.token))).status).toBe(409);
    const delivered = await mkLog({ status: 'delivered', errorMessage: null, deliveredAt: new Date() });
    expect((await request(app).post(`/api/messages/${delivered.id}/resend-sms`).set(bearer(owner.token))).status).toBe(409);
    const stuck = await mkLog({ status: 'sent', errorMessage: null, sentAt: new Date(Date.now() - 11 * 60_000) });
    expect((await request(app).post(`/api/messages/${stuck.id}/resend-sms`).set(bearer(owner.token))).status).toBe(201);
    const skipped = await mkLog({ status: 'skipped', errorMessage: 'provider_disabled' });
    expect((await request(app).post(`/api/messages/${skipped.id}/resend-sms`).set(bearer(owner.token))).status).toBe(201);
    const again = await mkLog();
    await mkLog({ fallbackOfId: again.id, channel: 'sms', status: 'failed' });
    expect((await request(app).post(`/api/messages/${again.id}/resend-sms`).set(bearer(owner.token))).status).toBe(201);
  });

  it('retries and resends share one limit of 3 across the lineage; an SMS or an SMS fallback cannot be resent as SMS', async () => {
    const root = await mkLog();
    const fb = await mkLog({ fallbackOfId: root.id, channel: 'sms', status: 'failed', provider: 'arkesel' });
    // resending the fallback itself, or any SMS, is refused
    expect((await request(app).post(`/api/messages/${fb.id}/resend-sms`).set(bearer(owner.token))).status).toBe(409);
    const sms = await mkLog({ channel: 'sms', provider: 'arkesel' });
    expect((await request(app).post(`/api/messages/${sms.id}/resend-sms`).set(bearer(owner.token))).status).toBe(409);
    // fallback + 2 retries in the lineage = 3 extra sends: the next retry (of the fallback) and resend (of root) are refused
    const r1 = await mkLog({ retryOfId: root.id });
    await mkLog({ retryOfId: r1.id });
    const retry = await request(app).post(`/api/messages/${fb.id}/retry`).set(bearer(owner.token));
    expect(retry.status).toBe(409);
    expect(JSON.stringify(retry.body)).toContain('MESSAGE_RETRY_LIMIT');
    const resend = await request(app).post(`/api/messages/${root.id}/resend-sms`).set(bearer(owner.token));
    expect(resend.status).toBe(409);
    expect(JSON.stringify(resend.body)).toContain('MESSAGE_RETRY_LIMIT');
  });

  it('the provider backfill sets provider by channel, leaves email NULL and keeps the row count', async () => {
    const sms = await mkLog({ channel: 'sms', provider: null });
    const wa = await mkLog({ channel: 'whatsapp', provider: null });
    const em = await mkLog({ channel: 'email', provider: null });
    const before = await prismaBase.messageLog.count();
    const sql = require('fs').readFileSync(require('path').join(__dirname, '../../../prisma/migrations/20261114200000_m9_message_provider_backfill/migration.sql'), 'utf8');
    for (const stmt of sql.split(';').map((x: string) => x.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
      await prismaBase.$executeRawUnsafe(stmt);
    }
    expect(await prismaBase.messageLog.count()).toBe(before);
    expect((await prismaBase.messageLog.findUniqueOrThrow({ where: { id: sms.id } })).provider).toBe('arkesel');
    expect((await prismaBase.messageLog.findUniqueOrThrow({ where: { id: wa.id } })).provider).toBe('whatsapp_cloud');
    expect((await prismaBase.messageLog.findUniqueOrThrow({ where: { id: em.id } })).provider).toBeNull();
  });
});
