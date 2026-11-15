/**
 * COD-86: the SMS, WhatsApp and Email connections are saved by the Owner and Admins (like Paystack); managers and reps get 403.
 * An admin may change only those three settings through PUT /api/admin/settings.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
jest.mock('../../utils/smtpHost', () => ({ resolveSmtpHost: async (h: string) => ({ address: h }) }));
import { encryptProviderSecrets } from '../../utils/providerCrypto';
import { clearEmailConfigCache } from '../../services/emailService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let manager: string;
let owner: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tokenOf = (u: { id: number; email: string }, role: 'manager' | 'super_admin') => generateAccessToken({ id: u.id, email: u.email, role, tenantId: pair.a.id });

beforeAll(async () => {
  pair = await createTwoTenants('connroles');
  const m = await prismaBase.user.create({ data: { email: `mgr-${Date.now()}@codadmin.test`, password: 'x', firstName: 'M', lastName: 'G', role: 'manager', tenantId: pair.a.id } });
  manager = tokenOf(m, 'manager');
  owner = tokenOf(await prismaBase.user.findFirstOrThrow({ where: { tenantId: pair.a.id, role: 'super_admin' } }), 'super_admin');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const SMS = { smsProvider: { provider: 'arkesel', authToken: 'k-test', senderId: 'Shop', isEnabled: true } };
const routes: Array<{ name: string; call: (t: string) => request.Test }> = [
  { name: 'GET /api/admin/settings', call: (t) => request(app).get('/api/admin/settings').set(auth(t)) },
  { name: 'PUT /api/admin/settings (sms)', call: (t) => request(app).put('/api/admin/settings').set(auth(t)).send(SMS) },
  { name: 'POST /api/whatsapp/oauth/initiate', call: (t) => request(app).post('/api/whatsapp/oauth/initiate').set(auth(t)) },
  { name: 'GET /api/whatsapp/oauth/phones', call: (t) => request(app).get('/api/whatsapp/oauth/phones').set(auth(t)) },
  { name: 'POST /api/whatsapp/oauth/select', call: (t) => request(app).post('/api/whatsapp/oauth/select').set(auth(t)).send({}) },
  { name: 'POST /api/settings/smtp/test', call: (t) => request(app).post('/api/settings/smtp/test').set(auth(t)).send({}) },
  { name: 'GET /api/settings/sms/report-url', call: (t) => request(app).get('/api/settings/sms/report-url').set(auth(t)) },
];

describe('Connections routes: admin yes, manager and rep 403', () => {
  for (const r of routes) {
    it(r.name, async () => {
      expect((await r.call(manager)).status).toBe(403);
      expect((await r.call(pair.a.users.salesRep.token)).status).toBe(403);
      // The admin gets past the role check (the call itself may answer 400 when nothing is set up, never 403)
      expect((await r.call(pair.a.users.admin.token)).status).not.toBe(403);
    });
  }

  it('an admin saves the SMS connection and the owner reads it back', async () => {
    const res = await request(app).put('/api/admin/settings').set(auth(pair.a.users.admin.token)).send(SMS);
    expect(res.status).toBe(200);
    const read = await request(app).get('/api/admin/settings').set(auth(owner));
    expect(read.body.smsProvider).toMatchObject({ senderId: 'Shop' });
  });

  it('an admin still cannot change business settings; the owner can', async () => {
    expect((await request(app).put('/api/admin/settings').set(auth(pair.a.users.admin.token)).send({ businessName: 'Hijacked' })).status).toBe(403);
    expect((await request(app).put('/api/admin/settings').set(auth(pair.a.users.admin.token)).send({ ...SMS, businessName: 'Hijacked' })).status).toBe(403);
    expect((await request(app).put('/api/admin/settings').set(auth(owner)).send({ businessName: 'Owner Co' })).status).toBe(200);
  });
});

describe('a secret never follows a changed server', () => {
  const MASK = '••••••••';
  const admin = () => pair.a.users.admin.token;
  const put = (body: object) => request(app).put('/api/admin/settings').set(auth(admin())).send(body);
  const stored = async () => (await prismaBase.systemConfig.findFirstOrThrow({ where: { tenantId: pair.a.id } }));
  const SMTP = { provider: 'smtp', apiKey: 'real-password', fromEmail: 'shop@example.com', smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'shop@example.com' };

  beforeAll(async () => {
    await request(app).get('/api/admin/settings').set(auth(owner)); // makes sure the tenant has its config row
    await prismaBase.systemConfig.update({
      where: { tenantId: pair.a.id },
      data: {
        emailProvider: encryptProviderSecrets('emailProvider', SMTP),
        whatsappProvider: encryptProviderSecrets('whatsappProvider', { accessToken: 'wa-token', phoneNumberId: '111', isEnabled: true }),
      },
    });
    clearEmailConfigCache();
  });

  it('a changed SMTP host with the masked password is 400 and nothing is stored', async () => {
    const before = JSON.stringify((await stored()).emailProvider);
    const res = await put({ emailProvider: { ...SMTP, apiKey: MASK, smtpHost: 'mail.attacker.example' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Type the password again when you change the server.');
    expect(JSON.stringify((await stored()).emailProvider)).toBe(before);
  });

  it('a changed user or port with the masked password is 400 too', async () => {
    expect((await put({ emailProvider: { ...SMTP, apiKey: MASK, smtpUser: 'other@example.com' } })).status).toBe(400);
    expect((await put({ emailProvider: { ...SMTP, apiKey: MASK, smtpPort: 25 } })).status).toBe(400);
  });

  it('a changed host with a new password saves (200)', async () => {
    const res = await put({ emailProvider: { ...SMTP, apiKey: 'new-password', smtpHost: 'smtp.example.org' } });
    expect(res.status).toBe(200);
    expect((await stored() as any).emailProvider.smtpHost).toBe('smtp.example.org');
    // put it back for the next cases
    await prismaBase.systemConfig.update({ where: { tenantId: pair.a.id }, data: { emailProvider: encryptProviderSecrets('emailProvider', SMTP) } });
    clearEmailConfigCache();
  });

  it('an edit that keeps the same server keeps the masked password (200)', async () => {
    const res = await put({ emailProvider: { ...SMTP, apiKey: MASK, fromName: 'Shop' } });
    expect(res.status).toBe(200);
  });

  it('an SMTP test to a different host with no password is 400; the saved password is not used', async () => {
    const res = await request(app).post('/api/settings/smtp/test').set(auth(admin())).send({ smtpHost: 'mail.attacker.example', password: MASK });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Type the password again when you change the server.');
    const port = await request(app).post('/api/settings/smtp/test').set(auth(admin())).send({ smtpPort: 25 });
    expect(port.status).toBe(400);
    expect(port.body.error).toBe('Type the password again when you change the server.');
  });

  it('a changed WhatsApp phone number ID with the masked token is 400; with a new token it saves', async () => {
    const bad = await put({ whatsappProvider: { accessToken: MASK, phoneNumberId: '999', isEnabled: true } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Type the access token again when you change the connection details.');
    expect((await stored() as any).whatsappProvider.phoneNumberId).toBe('111');
    expect((await put({ whatsappProvider: { accessToken: 'new-token', phoneNumberId: '999', isEnabled: true } })).status).toBe(200);
  });

  it('turning WhatsApp off without touching the number keeps the masked token (200)', async () => {
    expect((await put({ whatsappProvider: { accessToken: MASK, phoneNumberId: '999', isEnabled: false } })).status).toBe(200);
  });
});
