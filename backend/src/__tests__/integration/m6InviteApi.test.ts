/**
 * M6-T06 (COD-56): the invite flow. Invite, accept with an own password, sign in, /me; expiry; one use; email taken; rank;
 * resend and revoke; the old create-with-password route; the link never stored.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { bearer } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { hashInviteToken } from '../../utils/inviteToken';
import { superAdminToken } from './helpers/superAdminToken';
import { smsService } from '../../services/smsService';

jest.mock('../../services/emailService', () => ({
  ...jest.requireActual('../../services/emailService'),
  sendInviteEmail: jest.fn(),
}));
import { sendInviteEmail } from '../../services/emailService';
const sendInviteEmailMock = sendInviteEmail as jest.MockedFunction<typeof sendInviteEmail>;

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const PASSWORD = 'Passw0rd!invite';
let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let seq = 0;
const mail = (label: string) => `${label}${SUFFIX}x${seq++}@codadmin.test`;
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

const api = {
  post: (token: string, url: string, body: object = {}) => request(app).post(url).set(bearer(token)).send(body),
  get: (token: string, url: string) => request(app).get(url).set(bearer(token)),
};
const accept = (token: string, password = PASSWORD) => request(app).post('/api/auth/accept-invite').send({ token, password });
const invite = (body: Record<string, unknown> = {}, token = ownerA) =>
  api.post(token, '/api/staff/invite', { name: 'Ama Mensah', email: mail('ama'), role: 'sales_rep', ...body });
const dbUser = (id: number) => prismaBase.user.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  pair = await createTwoTenants('m6invite');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'inv-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'inv-owner');
}, 90_000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('invite -> accept -> login -> me', () => {
  it('stores only the token hash, never a password; accept sets the password, activates and signs in', async () => {
    sendInviteEmailMock.mockClear();
    const email = mail('flow');
    const res = await invite({ email, phoneNumber: '0244000111', payMethod: 'per_order', city: 'Kumasi' });
    expect(res.status).toBe(201);
    expect(res.body.delivery).toEqual({ channel: 'email', sent: true });
    expect(res.body.staff.status).toBe('invited');
    expect(res.body.staff.positions.map((p: { name: string }) => p.name)).toEqual(['Call rep']);
    const raw = tokenOf(res.body.link);
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(sendInviteEmailMock).toHaveBeenCalledWith(email, 'Ama', expect.any(String), res.body.link);

    const row = await dbUser(res.body.staff.id);
    expect(row.inviteTokenHash).toBe(hashInviteToken(raw));
    expect(row.inviteTokenHash).not.toBe(raw);
    expect(JSON.stringify(row)).not.toContain(raw);
    expect(row.isActive).toBe(false);
    expect(row.password).toBe('!'); // no password in an invite
    expect(row.commissionAmount?.toString()).toBe('8');
    expect(row.location).toBe('Kumasi');
    const days = (row.inviteExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    // before accepting there is no login
    expect((await request(app).post('/api/auth/login').send({ email, password: PASSWORD })).status).toBeGreaterThanOrEqual(401);

    const done = await accept(raw);
    expect(done.status).toBe(200);
    expect(done.body.user).toMatchObject({ email, role: 'sales_rep' });
    expect(done.body.tokens.accessToken).toBeTruthy();
    const after = await dbUser(res.body.staff.id);
    expect(after).toMatchObject({ isActive: true, inviteTokenHash: null, inviteExpiresAt: null, invitedAt: null });
    expect(after.lastLogin).toBeInstanceOf(Date);
    expect(await prismaBase.userSession.count({ where: { userId: after.id } })).toBe(1);

    const me = await api.get(done.body.tokens.accessToken, '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    const again = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(again.status).toBe(200);
    expect((await api.get(ownerA, `/api/staff?q=${encodeURIComponent('Ama')}&status=active`)).body.staff.some((s: { email: string }) => s.email === email)).toBe(true);
  });

  it('a used token is refused with the same 400 as an unknown one', async () => {
    const res = await invite();
    const raw = tokenOf(res.body.link);
    expect((await accept(raw)).status).toBe(200);
    const reused = await accept(raw, 'Another1!password');
    const unknown = await accept('f'.repeat(64));
    expect(reused.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(reused.body.message).toBe(unknown.body.message);
    // the second password did not replace the first
    expect((await request(app).post('/api/auth/login').send({ email: res.body.staff.email, password: PASSWORD })).status).toBe(200);
  });

  it('two accepts at once: one wins', async () => {
    const raw = tokenOf((await invite()).body.link);
    const [a, b] = await Promise.all([accept(raw), accept(raw)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it('an expired token gives 410 "Ask for a new invite" and the person stays Invited', async () => {
    const res = await invite();
    await prismaBase.user.update({ where: { id: res.body.staff.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    const out = await accept(tokenOf(res.body.link));
    expect(out.status).toBe(410);
    expect(out.body.message).toContain('Ask for a new invite');
    expect(await dbUser(res.body.staff.id)).toMatchObject({ isActive: false });
  });

  it('applies the reset-password rules to the new password', async () => {
    const raw = tokenOf((await invite()).body.link);
    expect((await accept(raw, 'weak')).status).toBe(400);
    expect((await accept(raw, 'nouppercase1!')).status).toBe(400);
    expect((await accept(raw)).status).toBe(200); // the failed tries did not spend the token
  });
});

describe('check-invite (the accept page asks on load)', () => {
  const check = (token: string) => request(app).post('/api/auth/check-invite').send({ token });

  it('a good link is 200 and nothing changes; unknown and used are the same 400; expired is 410; no token is 400', async () => {
    const res = await invite();
    const raw = tokenOf(res.body.link);
    const before = await dbUser(res.body.staff.id);
    expect((await check(raw)).body).toEqual({ valid: true });
    expect(await dbUser(res.body.staff.id)).toEqual(before);
    expect((await accept(raw)).status).toBe(200);
    const used = await check(raw);
    const unknown = await check('f'.repeat(64));
    expect([used.status, unknown.status]).toEqual([400, 400]);
    expect(used.body.message).toBe(unknown.body.message);
    const late = await invite();
    await prismaBase.user.update({ where: { id: late.body.staff.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    const expired = await check(tokenOf(late.body.link));
    expect(expired.status).toBe(410);
    expect(expired.body.message).toContain('Ask for a new invite');
    expect((await request(app).post('/api/auth/check-invite').send({})).status).toBe(400);
  });

  it('a revoked or deactivated person link is 400', async () => {
    const res = await invite();
    await api.post(ownerA, `/api/staff/${res.body.staff.id}/revoke-invite`);
    expect((await check(tokenOf(res.body.link))).status).toBe(400);
  });
});

describe('who may invite what', () => {
  it('email already used is 409 EMAIL_EXISTS; a rep cannot invite; needs a login', async () => {
    const taken = await invite({ email: pair.a.users.admin.email });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('EMAIL_EXISTS');
    expect(await prismaBase.user.count({ where: { email: pair.a.users.admin.email } })).toBe(1);
    expect((await invite({}, pair.a.users.salesRep.token)).status).toBe(403);
    expect((await request(app).post('/api/staff/invite').send({})).status).toBe(401);
  });

  it('an admin cannot invite an Owner-level role, by role or by role id; an admin may invite a rep', async () => {
    const admin = pair.a.users.admin.token;
    const ownerRole = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, presetRole: 'super_admin' } });
    for (const body of [{ role: 'super_admin' }, { role: 'admin' }, { role: undefined, roleId: ownerRole.id }]) {
      const email = mail('rank');
      const res = await invite({ email, ...body }, admin);
      expect(res.status).toBe(403);
      expect(await prismaBase.user.count({ where: { email } })).toBe(0);
    }
    expect((await invite({}, admin)).status).toBe(201);
  });

  it('role id of another tenant is 404; a delivery partner gets vehicle, city and the fee rule, not an amount', async () => {
    const foreign = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.b.id } });
    expect((await invite({ role: undefined, roleId: foreign.id })).status).toBe(404);
    const rep = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Delivery' } });
    const ok = await invite({ role: undefined, roleId: rep.id, vehicleType: 'motorcycle', vehicleId: 'GR-123-24', city: 'Tema' });
    expect(ok.status).toBe(201);
    expect(await dbUser(ok.body.staff.id)).toMatchObject({ role: 'delivery_agent', vehicleType: 'Motorbike', vehicleId: 'GR-123-24', location: 'Tema', preferences: { payMethod: 'fee_rule' } });
    expect(ok.body.staff.feeRule.editable).toBe(false);
    expect((await invite({ role: 'delivery_agent', payMethod: 'per_order', amount: 8 })).status).toBe(400);
    expect((await invite({ role: 'delivery_agent', vehicleType: 'Rocket' })).status).toBe(400);
  });

  it('body needs a name, an email, and roleId or role', async () => {
    expect((await api.post(ownerA, '/api/staff/invite', { email: mail('x'), role: 'sales_rep' })).status).toBe(400);
    expect((await api.post(ownerA, '/api/staff/invite', { name: 'No Role', email: mail('x') })).status).toBe(400);
    expect((await invite({ email: 'not-an-email' })).status).toBe(400);
    expect((await invite({ password: PASSWORD })).status).toBe(400); // a password is not part of an invite
  });
});

describe('channels', () => {
  it('SMS or WhatsApp with no provider set up still creates the invite and returns the link; the link is not kept in the message log', async () => {
    for (const channel of ['sms', 'whatsapp']) {
      const res = await invite({ channel, phoneNumber: '0244000222' });
      expect(res.status).toBe(201);
      expect(res.body.delivery).toMatchObject({ channel, sent: false });
      const raw = tokenOf(res.body.link);
      expect(await accept(raw)).toMatchObject({ status: 200 });
    }
    const logged = await prismaBase.messageLog.findMany({ where: { tenantId: pair.a.id, channel: { in: ['sms', 'whatsapp'] } }, select: { messageBody: true } });
    expect(logged.length).toBeGreaterThanOrEqual(2);
    for (const l of logged) {
      expect(l.messageBody).not.toContain('accept-invite');
      expect(l.messageBody).toContain('[invite link]');
    }
  });

  it('with a provider, the provider gets the real link and the message log never holds the token', async () => {
    const dispatch = jest.spyOn(smsService as unknown as { dispatch: (...a: unknown[]) => Promise<string> }, 'dispatch').mockResolvedValue('provider-msg-1');
    try {
      const res = await invite({ channel: 'sms', phoneNumber: '0244000333' });
      expect(res.body.delivery).toEqual({ channel: 'sms', sent: true });
      const raw = tokenOf(res.body.link);
      expect(dispatch).toHaveBeenCalledWith(expect.any(Number), expect.any(String), expect.stringContaining(raw));
      expect(await prismaBase.messageLog.count({ where: { messageBody: { contains: raw } } })).toBe(0);
      const row = await prismaBase.messageLog.findFirstOrThrow({ where: { tenantId: pair.a.id, channel: 'sms' }, orderBy: { id: 'desc' } });
      expect(row.messageBody).toContain('[invite link]');
    } finally {
      dispatch.mockRestore();
    }
  });

  it('an email that fails to send still keeps the invite and returns the link; SMS needs a phone', async () => {
    sendInviteEmailMock.mockRejectedValueOnce(new Error('Email provider not configured'));
    const res = await invite();
    expect(res.status).toBe(201);
    expect(res.body.delivery).toMatchObject({ channel: 'email', sent: false, reason: 'Email provider not configured' });
    expect(res.body.link).toContain('/accept-invite?token=');
    const email = mail('nophone');
    const bad = await invite({ email, channel: 'sms' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('PHONE_REQUIRED');
    expect(await prismaBase.user.count({ where: { email } })).toBe(0);
  });
});

describe('resend and revoke', () => {
  it('resend makes a new link and kills the old one; only an Invited person; another tenant is 404', async () => {
    const first = await invite();
    const id = first.body.staff.id;
    const oldRaw = tokenOf(first.body.link);
    const again = await api.post(ownerA, `/api/staff/${id}/resend-invite`, {});
    expect(again.status).toBe(200);
    const newRaw = tokenOf(again.body.link);
    expect(newRaw).not.toBe(oldRaw);
    expect((await dbUser(id)).inviteTokenHash).toBe(hashInviteToken(newRaw));
    expect((await accept(oldRaw)).status).toBe(400);
    expect((await api.post(ownerB, `/api/staff/${id}/resend-invite`, {})).status).toBe(404);
    expect((await api.post(pair.a.users.salesRep.token, `/api/staff/${id}/resend-invite`, {})).status).toBe(403);
    // an expired invite can be sent again
    await prismaBase.user.update({ where: { id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    const fresh = await api.post(ownerA, `/api/staff/${id}/resend-invite`, { channel: 'email' });
    expect((await accept(tokenOf(fresh.body.link))).status).toBe(200);
    // accepted: nothing to resend
    const done = await api.post(ownerA, `/api/staff/${id}/resend-invite`, {});
    expect(done.status).toBe(409);
    expect(done.body.code).toBe('NOT_INVITED');
  });

  it('revoke kills the link and moves the person to the Deleted tab; a restore brings them back as Invited, to be sent a new invite', async () => {
    const res = await invite();
    const id = res.body.staff.id;
    const raw = tokenOf(res.body.link);
    const revoked = await api.post(ownerA, `/api/staff/${id}/revoke-invite`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.staff.status).toBe('deleted');
    expect(await dbUser(id)).toMatchObject({ isActive: false, inviteTokenHash: null, inviteExpiresAt: null });
    expect((await accept(raw)).status).toBe(400);
    expect((await api.post(ownerA, `/api/staff/${id}/revoke-invite`)).status).toBe(409);
    const back = await api.post(ownerA, `/api/staff/${id}/reactivate`);
    expect(back.body.staff.status).toBe('invited');
    const sent = await api.post(ownerA, `/api/staff/${id}/resend-invite`, {});
    expect((await accept(tokenOf(sent.body.link))).status).toBe(200);
  });
});

describe('a link dies when the person is deactivated, deleted or no longer Invited', () => {
  it('deactivating or deleting an invited person through any route kills the link; the person stays inactive', async () => {
    const routes: Array<[string, (id: number) => Promise<{ status: number }>]> = [
      ['admin PUT isActive false', (id) => request(app).put(`/api/admin/users/${id}`).set(bearer(ownerA)).send({ isActive: false })],
      ['staff DELETE', (id) => request(app).delete(`/api/staff/${id}`).set(bearer(ownerA))],
    ];
    for (const [label, run] of routes) {
      const res = await invite();
      const id = res.body.staff.id;
      expect([label, (await run(id)).status]).toEqual([label, 200]);
      const row = await dbUser(id);
      expect([label, row.inviteTokenHash, row.inviteExpiresAt]).toEqual([label, null, null]);
      const out = await accept(tokenOf(res.body.link));
      expect([label, out.status, out.body.code]).toEqual([label, 400, 'INVITE_INVALID']);
      expect((await dbUser(id)).isActive).toBe(false);
    }
  });

  it('even a token that survived somehow cannot be spent by a deleted person or one with no invite date', async () => {
    const [a, b] = [await invite(), await invite()];
    await prismaBase.user.update({ where: { id: a.body.staff.id }, data: { deletedAt: new Date() } });
    await prismaBase.user.update({ where: { id: b.body.staff.id }, data: { invitedAt: null } });
    for (const res of [a, b]) {
      const out = await accept(tokenOf(res.body.link));
      expect(out.status).toBe(400);
      expect(out.body.code).toBe('INVITE_INVALID');
      expect((await dbUser(res.body.staff.id)).isActive).toBe(false);
    }
  });
});

describe('the old create with a password', () => {
  it('POST /api/users is refused too', async () => {
    const email = mail('old2');
    const res = await api.post(ownerA, '/api/users', { email, password: PASSWORD, firstName: 'Old', lastName: 'Way', role: 'sales_rep' });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('USE_INVITE');
    expect(await prismaBase.user.count({ where: { email } })).toBe(0);
  });

  it('POST /api/admin/users is refused, with or without a password, and creates nobody', async () => {
    const email = mail('old');
    for (const body of [{ email, password: PASSWORD, firstName: 'Old', lastName: 'Way', role: 'sales_rep' }, { email, firstName: 'Old', lastName: 'Way', role: 'sales_rep' }]) {
      const res = await api.post(ownerA, '/api/admin/users', body);
      expect(res.status).toBe(410);
      expect(res.body.code).toBe('USE_INVITE');
    }
    expect(await prismaBase.user.count({ where: { email } })).toBe(0);
  });
});
