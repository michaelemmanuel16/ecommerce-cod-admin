/** M9 wave 4 (COD-78): assignee roles and opt-out by phone, on the real API. */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { whatsappCloudProvider } from '../../services/messaging/providers';
import whatsappService from '../../services/whatsappService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
let tenantA: string;
let owner: { id: number; token: string };
let agent: { id: number; token: string };
let rep: { id: number; token: string };
let otherRep: { id: number; token: string };
let seq = 0;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const mkConv = (data: Record<string, unknown> = {}) => prismaBase.conversation.create({
  data: { tenantId: tenantA, channel: 'whatsapp', phone: `+23326${String(SUFFIX).slice(-5)}${String(seq++).padStart(2, '0')}`, lastMessageAt: new Date(), ...data } as any,
});

beforeAll(async () => {
  tenantA = (await createTenant('Conv Sec')).id;
  owner = await mkUser(tenantA, 'owner', 'super_admin');
  agent = await mkUser(tenantA, 'agent', 'delivery_agent');
  rep = await mkUser(tenantA, 'rep', 'sales_rep');
  otherRep = await mkUser(tenantA, 'rep2', 'sales_rep');
});
afterAll(async () => {
  await deleteTenantRows([tenantA]);
  await prismaBase.$disconnect();
});
beforeEach(() => {
  jest.spyOn(whatsappCloudProvider, 'isEnabled').mockResolvedValue(true);
  jest.spyOn(whatsappCloudProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `wa-s-${SUFFIX}-${seq++}` }));
});

describe('assignee rules', () => {
  it('assigning to an agent is 400 with the plain text', async () => {
    const conv = await mkConv();
    const res = await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(owner.token)).send({ assignedToId: agent.id });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('This person cannot see conversations');
    expect((await prismaBase.conversation.findUniqueOrThrow({ where: { id: conv.id } })).assignedToId).toBeNull();
  });

  it('a rep assigning to another rep is 403; to themselves or none is fine', async () => {
    const conv = await mkConv({ assignedToId: rep.id });
    expect((await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(rep.token)).send({ assignedToId: otherRep.id })).status).toBe(403);
    expect((await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(rep.token)).send({ assignedToId: rep.id })).status).toBe(200);
    expect((await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(rep.token)).send({ assignedToId: null })).status).toBe(200);
  });

  it('the assign notice is a conversation_assigned event', async () => {
    const conv = await mkConv();
    await request(app).patch(`/api/conversations/${conv.id}`).set(bearer(owner.token)).send({ assignedToId: otherRep.id }).expect(200);
    const n = await prismaBase.notification.findMany({ where: { tenantId: tenantA, subjectType: 'conversation', subjectId: conv.id, userId: otherRep.id } });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ type: 'conversation_assigned', kind: 'reply' });
  });
});

describe('opt-out by phone', () => {
  it('a reply to an opted-out unknown number (no customer) outside 24 hours is 409; inside 24 hours it is sent', async () => {
    const stale = await mkConv({ lastInboundAt: hoursAgo(48) });
    await prismaBase.optOutEvent.create({ data: { tenantId: tenantA, phone: stale.phone, channel: 'whatsapp', optedOut: true, reason: 'stop_reply' } });
    const res = await request(app).post(`/api/conversations/${stale.id}/reply`).set(bearer(owner.token)).send({ templateName: 'order_auto_confirm' });
    expect(res.status).toBe(409);
    const fresh = await mkConv({ lastInboundAt: hoursAgo(1) });
    await prismaBase.optOutEvent.create({ data: { tenantId: tenantA, phone: fresh.phone, channel: 'whatsapp', optedOut: true, reason: 'stop_reply' } });
    expect((await request(app).post(`/api/conversations/${fresh.id}/reply`).set(bearer(owner.token)).send({ body: 'ok' })).status).toBe(201);
  });

  it('a later resubscribe lifts the block', async () => {
    const conv = await mkConv({ lastInboundAt: hoursAgo(48) });
    await prismaBase.optOutEvent.create({ data: { tenantId: tenantA, phone: conv.phone, channel: 'whatsapp', optedOut: true, reason: 'stop_reply', createdAt: hoursAgo(5) } });
    await prismaBase.optOutEvent.create({ data: { tenantId: tenantA, phone: conv.phone, channel: 'whatsapp', optedOut: false, reason: 'resubscribe', createdAt: hoursAgo(1) } });
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ templateName: 'order_auto_confirm' })).status).toBe(201);
  });

  it('messageSender skips every non-reply send to an opted-out phone: sendTemplate writes a skipped row and sends nothing', async () => {
    const phone = `+23327${String(SUFFIX).slice(-7)}`;
    await prismaBase.optOutEvent.create({ data: { tenantId: tenantA, phone, channel: 'whatsapp', optedOut: true, reason: 'stop_reply' } });
    const { runInTenant } = await import('../../utils/tenantContext');
    const calls = (whatsappCloudProvider.send as any).mock.calls.length;
    const out = await runInTenant(tenantA, () => whatsappService.sendTemplate({ to: phone, templateName: 'order_created', bodyParams: ['A', '1'] }));
    expect(out.sent).toBe(false);
    expect((whatsappCloudProvider.send as any).mock.calls.length).toBe(calls);
    const row = await prismaBase.messageLog.findUniqueOrThrow({ where: { id: out.messageLogId } });
    expect(row).toMatchObject({ status: 'skipped', errorMessage: 'opted_out' });
  });
});

describe('retry and resend run the opt-out check again', () => {
  it('a retry of a failed conversation message after the customer sent STOP is 409 CUSTOMER_OPTED_OUT, with no customer row', async () => {
    const conv = await mkConv({ lastInboundAt: hoursAgo(1) });
    const failed = await prismaBase.messageLog.create({
      data: {
        tenantId: tenantA, channel: 'whatsapp', direction: 'outbound', status: 'failed', provider: 'whatsapp_cloud', messageBody: 'hello',
        conversationId: conv.id, metadata: { to: conv.phone.replace(/^\+/, '') },
      } as any,
    });
    await prismaBase.optOutEvent.create({ data: { tenantId: tenantA, phone: conv.phone, channel: 'whatsapp', optedOut: true, reason: 'stop_reply' } });
    const calls = (whatsappCloudProvider.send as any).mock.calls.length;
    const res = await request(app).post(`/api/messages/${failed.id}/retry`).set(bearer(owner.token));
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('CUSTOMER_OPTED_OUT');
    expect((whatsappCloudProvider.send as any).mock.calls.length).toBe(calls);
  });

  it('messageSender without optOutCheckedByCaller skips a send that carries a conversationId', async () => {
    const conv = await mkConv();
    await prismaBase.optOutEvent.create({ data: { tenantId: tenantA, phone: conv.phone, channel: 'whatsapp', optedOut: true, reason: 'stop_reply' } });
    const { messageSender } = await import('../../services/messaging/messageSender');
    const out = await messageSender.send({ tenantId: tenantA, channel: 'whatsapp' as any, to: conv.phone.replace(/^\+/, ''), body: 'x', conversationId: conv.id });
    expect(out).toMatchObject({ skipped: true, error: 'opted_out' });
  });
});
