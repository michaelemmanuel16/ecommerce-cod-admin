/**
 * COD-86: the SMS, WhatsApp and Email connections are saved by the Owner and Admins (like Paystack); managers and reps get 403.
 * An admin may change only those three settings through PUT /api/admin/settings.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
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
