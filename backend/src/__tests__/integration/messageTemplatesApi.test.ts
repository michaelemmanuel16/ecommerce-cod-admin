/** M9-T09 (COD-78): templates API, Meta sync, the send gate, the data move and the settings payload. */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { whatsappCloudProvider } from '../../services/messaging/providers';
import { clearWhatsAppConfigCache } from '../../services/whatsappService';
import { migrateLegacyTemplates } from '../../services/messaging/templateMigration';
import { runInTenant } from '../../utils/tenantContext';
import whatsappService from '../../services/whatsappService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
let tenantA: string;
let tenantB: string;
let owner: { id: number; token: string };
let rep: { id: number; token: string };
let ownerB: { id: number; token: string };
let seq = 0;

beforeAll(async () => {
  tenantA = (await createTenant('Tpl A')).id;
  tenantB = (await createTenant('Tpl B')).id;
  owner = await mkUser(tenantA, 'owner', 'super_admin');
  rep = await mkUser(tenantA, 'rep', 'sales_rep');
  ownerB = await mkUser(tenantB, 'ownerb', 'super_admin');
});
afterAll(async () => {
  await prismaBase.smsTemplate.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});
beforeEach(() => {
  jest.spyOn(whatsappCloudProvider, 'isEnabled').mockResolvedValue(true);
  jest.spyOn(whatsappCloudProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `wa-t-${SUFFIX}-${seq++}` }));
});

describe('CRUD', () => {
  it('creates, lists, updates and deletes templates of all three channels; email body is sanitized', async () => {
    const sms = await request(app).post('/api/message-templates').set(bearer(owner.token)).send({ channel: 'sms', name: 'Dispatch', body: 'Hi {{1}}, sent.' });
    expect(sms.status).toBe(201);
    expect(sms.body).toMatchObject({ channel: 'sms', name: 'Dispatch', variables: ['1'], sendable: true });
    const email = await request(app).post('/api/message-templates').set(bearer(owner.token)).send({ channel: 'email', name: 'Hello', subject: 'Hi', body: '<p>x</p><script>alert(1)</script>' });
    expect(email.status).toBe(201);
    expect(email.body.body).not.toContain('<script');
    const wa = await request(app).post('/api/message-templates').set(bearer(owner.token)).send({ channel: 'whatsapp', name: 'order_x', body: 'Hi {{1}}', language: 'en_US', category: 'UTILITY', quickReplies: ['Yes'] });
    expect(wa.status).toBe(201);
    expect(wa.body).toMatchObject({ status: 'pending', sendable: false, metaTemplateName: 'order_x', quickReplies: ['Yes'] });

    const list = await request(app).get('/api/message-templates').set(bearer(rep.token));
    expect(list.body.items.map((i: any) => i.id)).toEqual(expect.arrayContaining([sms.body.id, email.body.id, wa.body.id]));
    expect((await request(app).get('/api/message-templates?channel=whatsapp').set(bearer(owner.token))).body.items.every((i: any) => i.channel === 'whatsapp')).toBe(true);

    expect((await request(app).put(`/api/message-templates/${sms.body.id}`).set(bearer(owner.token)).send({ body: 'New {{1}} {{2}}' })).body).toMatchObject({ body: 'New {{1}} {{2}}', variables: ['1', '2'] });
    expect((await request(app).post('/api/message-templates').set(bearer(owner.token)).send({ channel: 'sms', name: 'Dispatch', body: 'dup' })).status).toBe(409);
    expect((await request(app).delete(`/api/message-templates/${sms.body.id}`).set(bearer(owner.token))).status).toBe(204);
    expect((await request(app).put(`/api/message-templates/${sms.body.id}`).set(bearer(owner.token)).send({ body: 'x' })).status).toBe(404);
  });

  it('a rep cannot change templates; another tenant sees and touches nothing', async () => {
    expect((await request(app).post('/api/message-templates').set(bearer(rep.token)).send({ channel: 'sms', name: 'R', body: 'b' })).status).toBe(403);
    const t = await prismaBase.messageTemplate.create({ data: { tenantId: tenantA, channel: 'sms', name: 'Private', body: 'b' } });
    expect((await request(app).get('/api/message-templates').set(bearer(ownerB.token))).body.items.map((i: any) => i.id)).not.toContain(t.id);
    expect((await request(app).put(`/api/message-templates/${t.id}`).set(bearer(ownerB.token)).send({ body: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/message-templates/${t.id}`).set(bearer(ownerB.token))).status).toBe(404);
  });
});

describe('sync from Meta', () => {
  const setWhatsapp = async (tenantId: string) => {
    await prismaBase.systemConfig.upsert({
      where: { tenantId },
      update: { whatsappProvider: { accessToken: 'tok', phoneNumberId: '111', wabaId: '222', isEnabled: true } },
      create: { tenantId, whatsappProvider: { accessToken: 'tok', phoneNumberId: '111', wabaId: '222', isEnabled: true } },
    });
    clearWhatsAppConfigCache();
  };

  it('upserts by name and language, reads status, body and quick replies; a second sync updates', async () => {
    await setWhatsapp(tenantA);
    const meta = (status: string) => ({
      data: [
        { name: 'order_ok', language: 'en_US', category: 'UTILITY', status, components: [{ type: 'BODY', text: 'Hi {{1}}' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }, { type: 'URL', text: 'Site' }] }] },
        { name: 'order_ok', language: 'fr', category: 'UTILITY', status: 'PENDING', components: [{ type: 'BODY', text: 'Salut {{1}}' }] },
        { name: 'order_bad', language: 'en_US', category: 'MARKETING', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT', components: [{ type: 'BODY', text: 'x' }] },
      ],
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async () => ({ ok: true, status: 200, json: async () => meta('APPROVED') })) as any);
    const first = await request(app).post('/api/message-templates/sync').set(bearer(owner.token));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: 3, updated: 0, total: 3 });
    expect(String((fetchSpy.mock.calls[0] as any)[0])).toContain('/222/message_templates');
    const rows = await prismaBase.messageTemplate.findMany({ where: { tenantId: tenantA, channel: 'whatsapp', metaTemplateName: { in: ['order_ok', 'order_bad'] } } });
    const ok = rows.find((r) => r.metaTemplateName === 'order_ok' && r.language === 'en_US')!;
    expect(ok).toMatchObject({ metaStatus: 'APPROVED', body: 'Hi {{1}}', quickReplies: ['Yes'] });
    expect(rows.find((r) => r.metaTemplateName === 'order_bad')).toMatchObject({ metaStatus: 'REJECTED', metaRejectReason: 'INVALID_FORMAT' });
    expect(new Set(rows.map((r) => r.name)).size).toBe(3);

    fetchSpy.mockImplementation((async () => ({ ok: true, status: 200, json: async () => meta('PAUSED') })) as any);
    expect((await request(app).post('/api/message-templates/sync').set(bearer(owner.token))).body).toMatchObject({ created: 0, updated: 3 });
    expect((await prismaBase.messageTemplate.findUniqueOrThrow({ where: { id: ok.id } })).metaStatus).toBe('PAUSED');
  });

  it("a Meta failure comes back as 400 with Meta's own text", async () => {
    await setWhatsapp(tenantA);
    jest.spyOn(global, 'fetch').mockImplementation((async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid OAuth access token - Cannot parse access token', code: 190 } }) })) as any);
    const res = await request(app).post('/api/message-templates/sync').set(bearer(owner.token));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Invalid OAuth access token - Cannot parse access token');
  });

  it('a tenant with no WhatsApp set up gets 400', async () => {
    const res = await request(app).post('/api/message-templates/sync').set(bearer(ownerB.token));
    expect(res.status).toBe(400);
  });
});

describe('a template that is not approved cannot be sent', () => {
  it('the conversation reply refuses pending and rejected with 409 and sends nothing; approved goes', async () => {
    const conv = await prismaBase.conversation.create({ data: { tenantId: tenantA, channel: 'whatsapp', phone: `+23328${String(SUFFIX).slice(-7)}`, lastMessageAt: new Date() } as any });
    const mk = (name: string, metaStatus: string) => prismaBase.messageTemplate.create({ data: { tenantId: tenantA, channel: 'whatsapp', name, body: 'b', language: 'en_US', metaTemplateName: name, metaStatus } });
    const pending = await mk('t_pending', 'PENDING');
    const rejected = await mk('t_rejected', 'REJECTED');
    const approved = await mk('t_approved', 'APPROVED');
    const calls = (whatsappCloudProvider.send as any).mock.calls.length;
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ templateId: pending.id })).status).toBe(409);
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ templateId: rejected.id })).status).toBe(409);
    expect((whatsappCloudProvider.send as any).mock.calls.length).toBe(calls);
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ templateId: approved.id })).status).toBe(201);
    // another tenant's template id is not found
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ templateId: 999999999 })).status).toBe(404);
    // the raw Meta name path is gone
    expect((await request(app).post(`/api/conversations/${conv.id}/reply`).set(bearer(owner.token)).send({ templateName: 'order_auto_confirm' })).status).toBe(400);
  });

  it('messageSender refuses a stored pending template by its Meta name; an unknown name is left to Meta', async () => {
    await prismaBase.messageTemplate.create({ data: { tenantId: tenantA, channel: 'whatsapp', name: 'order_created', body: 'b', language: 'en_US', metaTemplateName: 'order_created', metaStatus: 'PENDING' } });
    await expect(runInTenant(tenantA, () => whatsappService.sendTemplate({ to: '+233241230000', templateName: 'order_created', bodyParams: ['A', '1'] })))
      .rejects.toMatchObject({ statusCode: 409 });
    const ok = await runInTenant(tenantA, () => whatsappService.sendTemplate({ to: '+233241230000', templateName: 'order_never_stored', bodyParams: ['A'] }));
    expect(ok.sent).toBe(true);
  });
});

describe('data move from the old places', () => {
  it('count before = count after, a name clash gets (2), a second run changes nothing', async () => {
    const t = (await createTenant('Tpl Move')).id;
    try {
      await prismaBase.smsTemplate.createMany({ data: [{ tenantId: t, name: 'Promo', body: 'S1 {{1}}' }, { tenantId: t, name: 'Reminder', body: 'S2' }] });
      await prismaBase.emailTemplate.createMany({ data: [{ tenantId: t, name: 'Promo', subject: 'Sub', body: '<p>E1</p>' }, { tenantId: t, name: 'Welcome', subject: 'W', body: '<p>E2</p>' }] });
      // a template the tenant already made in the new list with the same name as an old one
      await prismaBase.messageTemplate.create({ data: { tenantId: t, channel: 'sms', name: 'Promo', body: 'already here' } });
      await prismaBase.systemConfig.upsert({
        where: { tenantId: t }, update: {},
        create: { tenantId: t, notificationTemplates: { orderConfirmation: { sms: 'Order {{1}} confirmed', email: 'Dear customer' }, delivered: { sms: 'Delivered', email: '' } } },
      });
      await prismaBase.systemConfig.update({ where: { tenantId: t }, data: { notificationTemplates: { orderConfirmation: { sms: 'Order {{1}} confirmed', email: 'Dear customer' }, delivered: { sms: 'Delivered', email: '' } } } });

      const before = { sms: await prismaBase.smsTemplate.count({ where: { tenantId: t } }), email: await prismaBase.emailTemplate.count({ where: { tenantId: t } }) };
      const first = await migrateLegacyTemplates();
      expect(first.sms).toBeGreaterThanOrEqual(2);
      const after = {
        sms: await prismaBase.messageTemplate.count({ where: { tenantId: t, legacySource: 'sms_templates' } }),
        email: await prismaBase.messageTemplate.count({ where: { tenantId: t, legacySource: 'email_templates' } }),
      };
      expect(after).toEqual(before);
      const names = (await prismaBase.messageTemplate.findMany({ where: { tenantId: t, channel: 'sms' }, select: { name: true } })).map((r) => r.name);
      expect(names).toEqual(expect.arrayContaining(['Promo', 'Promo (2)', 'Reminder']));
      expect(await prismaBase.messageTemplate.findMany({ where: { tenantId: t, legacySource: 'notification_templates' }, select: { channel: true, purpose: true, body: true }, orderBy: { id: 'asc' } }))
        .toEqual(expect.arrayContaining([
          { channel: 'sms', purpose: 'order_confirmation', body: 'Order {{1}} confirmed' },
          { channel: 'email', purpose: 'order_confirmation', body: 'Dear customer' },
          { channel: 'sms', purpose: 'delivered', body: 'Delivered' },
        ]));
      const total = await prismaBase.messageTemplate.count({ where: { tenantId: t } });
      const second = await migrateLegacyTemplates();
      expect(second).toMatchObject({ sms: 0, email: 0, notification: 0 });
      expect(await prismaBase.messageTemplate.count({ where: { tenantId: t } })).toBe(total);
    } finally {
      await prismaBase.smsTemplate.deleteMany({ where: { tenantId: t } });
      await deleteTenantRows([t]);
    }
  });
});

describe('settings payload', () => {
  it('notificationTemplates is gone from the response and a client that still sends it changes nothing', async () => {
    const t = (await createTenant('Tpl Settings')).id;
    try {
      const u = await mkUser(t, 'owner', 'super_admin');
      await prismaBase.systemConfig.upsert({ where: { tenantId: t }, update: {}, create: { tenantId: t, businessName: 'Shop' } });
      const get = await request(app).get('/api/admin/settings').set(bearer(u.token));
      expect(get.status).toBe(200);
      expect(get.body).not.toHaveProperty('notificationTemplates');
      const put = await request(app).put('/api/admin/settings').set(bearer(u.token)).send({ businessName: 'Shop 2', notificationTemplates: { delivered: { sms: 'x', email: 'y' } } });
      expect(put.status).toBe(200);
      expect(put.body).not.toHaveProperty('notificationTemplates');
      expect((await prismaBase.systemConfig.findUniqueOrThrow({ where: { tenantId: t } })).notificationTemplates).toBeNull();
    } finally {
      await deleteTenantRows([t]);
    }
  });
});
