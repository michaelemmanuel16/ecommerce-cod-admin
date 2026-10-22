/**
 * M3-T22 (COD-24): self-service account API. PATCH /api/users/me, photo upload, POST /api/auth/change-password.
 * Storage (R2) and the email service are mocked.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

// Plain functions, not jest.fn: resetMocks would wipe a jest.fn implementation.
const sentNotices: Array<{ to: string; newEmail: string }> = [];
let uploadFails = false;
jest.mock('../../services/emailService', () => ({
  ...jest.requireActual<any>('../../services/emailService'),
  sendEmailChangedNotice: async (to: string, _first: string, newEmail: string) => { sentNotices.push({ to, newEmail }); },
}));
jest.mock('../../config/r2', () => ({
  ...jest.requireActual<any>('../../config/r2'),
  isR2Configured: () => true,
  uploadToR2: async (_buf: Buffer, key: string) => {
    if (uploadFails) throw new Error('R2 down');
    return `https://img.test/${key}`;
  },
}));

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const OLD_PASSWORD = 'Passw0rd!old';
const NEW_PASSWORD = 'Newpass1!new';
let pair: TwoTenants;
let seq = 0;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

/** A user in tenant A with a known password, plus an access token (optionally carrying a session id). */
async function mkUser(role: any, tenantId = pair.a.id) {
  const u = await prismaBase.user.create({
    data: {
      email: `acct-${role}-${SUFFIX}-${seq++}@codadmin.test`,
      password: await bcrypt.hash(OLD_PASSWORD, 4),
      firstName: 'Ama', lastName: 'Mensah', role, tenantId,
    },
  });
  const token = (sid?: number) => generateAccessToken({ id: u.id, email: u.email, role, tenantId, ...(sid && { sid }) });
  return { ...u, token };
}

beforeAll(async () => {
  pair = await createTwoTenants('acctapi');
});

afterAll(async () => {
  await prismaBase.userSession.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.user.deleteMany({ where: { email: { startsWith: 'acct-' }, tenantId: { in: [pair.a.id, pair.b.id] } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('POST /api/auth/change-password', () => {
  const roles = ['super_admin', 'admin', 'manager', 'sales_rep', 'inventory_manager', 'delivery_agent', 'accountant'];
  it.each(roles)('%s can change its password and sign in with the new one', async (role) => {
    const u = await mkUser(role);
    const res = await request(app).post('/api/auth/change-password').set(bearer(u.token()))
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const oldLogin = await request(app).post('/api/auth/login').send({ email: u.email, password: OLD_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ email: u.email, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
  });

  it('wrong current password gives 400 five times, then the 6th try gives 429; another user is not blocked', async () => {
    const u = await mkUser('sales_rep');
    const other = await mkUser('sales_rep');
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/change-password').set(bearer(u.token()))
        .send({ currentPassword: 'wrong-Pass1!', newPassword: NEW_PASSWORD });
      expect(res.status).toBe(400);
    }
    const sixth = await request(app).post('/api/auth/change-password').set(bearer(u.token()))
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(sixth.status).toBe(429);

    const fresh = await request(app).post('/api/auth/change-password').set(bearer(other.token()))
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(fresh.status).toBe(200);
  });

  it('rejects a weak new password, the same password, a password over 72 characters and missing fields', async () => {
    const u = await mkUser('admin');
    const post = (body: object) => request(app).post('/api/auth/change-password').set(bearer(u.token())).send(body);
    expect((await post({ currentPassword: OLD_PASSWORD, newPassword: 'short' })).status).toBe(400);
    expect((await post({ currentPassword: OLD_PASSWORD, newPassword: 'alllowercase1!' })).status).toBe(400);
    expect((await post({ currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD })).status).toBe(400);
    expect((await post({ currentPassword: OLD_PASSWORD, newPassword: 'Aa1!' + 'x'.repeat(70) })).status).toBe(400);
    expect((await post({ currentPassword: OLD_PASSWORD })).status).toBe(400);
    // nothing changed
    const row = await prismaBase.user.findUnique({ where: { id: u.id } });
    expect(await bcrypt.compare(OLD_PASSWORD, row!.password)).toBe(true);
  });

  it('ends the other sessions, keeps the one in the token, writes an audit row', async () => {
    const u = await mkUser('manager');
    const mk = (n: string) => prismaBase.userSession.create({ data: { tenantId: pair.a.id, userId: u.id, tokenHash: `acct-${SUFFIX}-${n}-${u.id}` } });
    const [keep, drop1, drop2] = [await mk('keep'), await mk('d1'), await mk('d2')];
    // a session of the same-named user in tenant B must be untouched
    const bSession = await prismaBase.userSession.findFirstOrThrow({ where: { tenantId: pair.b.id } });

    const res = await request(app).post('/api/auth/change-password').set(bearer(u.token(keep.id)))
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const left = await prismaBase.userSession.findMany({ where: { userId: u.id } });
    expect(left.map((s) => s.id)).toEqual([keep.id]);
    expect(left.map((s) => s.id)).not.toContain(drop1.id);
    expect(drop2.id).toBeGreaterThan(0);
    expect(await prismaBase.userSession.findUnique({ where: { id: bSession.id } })).not.toBeNull();

    const audit = await prismaBase.auditLog.findFirst({ where: { userId: u.id, action: 'change_password' } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
  });

  it('a reset token issued before the change no longer works', async () => {
    const u = await mkUser('admin');
    const raw = `raw-reset-${SUFFIX}-${u.id}`;
    const hashed = require('crypto').createHash('sha256').update(raw).digest('hex');
    await prismaBase.user.update({ where: { id: u.id }, data: { passwordResetToken: hashed, passwordResetExpires: new Date(Date.now() + 600_000) } });
    const res = await request(app).post('/api/auth/change-password').set(bearer(u.token()))
      .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    const reset = await request(app).post('/api/auth/reset-password').send({ token: raw, password: 'Another1!pass' });
    expect(reset.status).toBe(400);
  });

  it('requires a signed-in user', async () => {
    const res = await request(app).post('/api/auth/change-password').send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/users/me', () => {
  it('updates name (split on the last space), display name and phone; ignores role, tenant and other fields', async () => {
    const u = await mkUser('sales_rep');
    const res = await request(app).patch('/api/users/me').set(bearer(u.token()))
      .send({ name: 'Kofi Asante Boateng', displayName: 'Kofi B', phone: '024 555 0103', role: 'super_admin', tenantId: pair.b.id, isActive: false, commissionAmount: 999 });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ firstName: 'Kofi Asante', lastName: 'Boateng', displayName: 'Kofi B', phoneNumber: '+233245550103', role: 'sales_rep' });

    const row = await prismaBase.user.findUnique({ where: { id: u.id } });
    expect(row).toMatchObject({ role: 'sales_rep', tenantId: pair.a.id, isActive: true });
    expect(Number(row!.commissionAmount ?? 0)).not.toBe(999);
  });

  it('a one-word name goes to the first name; an empty name or an invalid phone is rejected', async () => {
    const u = await mkUser('manager');
    const patch = (body: object) => request(app).patch('/api/users/me').set(bearer(u.token())).send(body);
    const ok = await patch({ name: 'Efua' });
    expect(ok.body.user).toMatchObject({ firstName: 'Efua', lastName: '' });
    expect((await patch({ name: '   ' })).status).toBe(400);
    expect((await patch({ phone: '12345' })).status).toBe(400);
    expect((await patch({ role: 'admin' })).status).toBe(400); // nothing allowed in the body
  });

  it('changes the email at once and tells the old address; a taken email is rejected', async () => {
    const u = await mkUser('accountant');
    const taken = await mkUser('admin', pair.b.id); // other tenant: email is unique system-wide
    sentNotices.length = 0;

    const newEmail = `acct-new-${SUFFIX}-${u.id}@codadmin.test`.toUpperCase();
    const res = await request(app).patch('/api/users/me').set(bearer(u.token())).send({ email: newEmail, currentPassword: OLD_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(newEmail.toLowerCase());
    await new Promise((r) => setImmediate(r));
    expect(sentNotices).toEqual([{ to: u.email, newEmail: newEmail.toLowerCase() }]);

    // an old reset token no longer works after an email change
    const raw = `raw-em-${SUFFIX}-${u.id}`;
    const hashed = require('crypto').createHash('sha256').update(raw).digest('hex');
    const row0 = await prismaBase.user.findUnique({ where: { id: u.id } });
    expect(row0!.passwordResetToken).toBeNull();
    expect((await request(app).post('/api/auth/reset-password').send({ token: raw, password: 'Another1!pass' })).status).toBe(400);
    expect(hashed).toHaveLength(64);

    const dup = await request(app).patch('/api/users/me').set(bearer(u.token())).send({ email: taken.email, currentPassword: OLD_PASSWORD });
    expect(dup.status).toBe(400);
    expect((await request(app).patch('/api/users/me').set(bearer(u.token())).send({ email: 'not-an-email', currentPassword: OLD_PASSWORD })).status).toBe(400);
  });

  it('an email change without the current password, or with a wrong one, gives 400 and changes nothing', async () => {
    const u = await mkUser('manager');
    const patch = (body: object) => request(app).patch('/api/users/me').set(bearer(u.token())).send(body);
    const email = `acct-nopw-${SUFFIX}-${u.id}@codadmin.test`;
    expect((await patch({ email })).status).toBe(400);
    expect((await patch({ email, currentPassword: 'wrong-Pass1!' })).status).toBe(400);
    expect((await prismaBase.user.findUnique({ where: { id: u.id } }))!.email).toBe(u.email);
  });

  it('wrong passwords on email change use the change-password try limit: the 6th gives 429', async () => {
    const u = await mkUser('manager');
    const patch = (body: object) => request(app).patch('/api/users/me').set(bearer(u.token())).send(body);
    const email = `acct-rl-${SUFFIX}-${u.id}@codadmin.test`;
    for (let i = 0; i < 3; i++) expect((await patch({ email, currentPassword: 'wrong-Pass1!' })).status).toBe(400);
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post('/api/auth/change-password').set(bearer(u.token())).send({ currentPassword: 'wrong-Pass1!', newPassword: NEW_PASSWORD });
      expect(res.status).toBe(400);
    }
    expect((await patch({ email, currentPassword: OLD_PASSWORD })).status).toBe(429);
  });

  it('an email change ends the other sessions, keeps the current one and clears the reset token', async () => {
    const u = await mkUser('sales_rep');
    await prismaBase.user.update({ where: { id: u.id }, data: { passwordResetToken: 'hashed-reset', passwordResetExpires: new Date(Date.now() + 600_000) } });
    const mk = (n: string) => prismaBase.userSession.create({ data: { tenantId: pair.a.id, userId: u.id, tokenHash: `acct-em-${SUFFIX}-${n}-${u.id}` } });
    const keep = await mk('keep');
    await mk('other');

    const res = await request(app).patch('/api/users/me').set(bearer(u.token(keep.id)))
      .send({ email: `acct-em-${SUFFIX}-${u.id}@codadmin.test`, currentPassword: OLD_PASSWORD });
    expect(res.status).toBe(200);
    expect((await prismaBase.userSession.findMany({ where: { userId: u.id } })).map((x) => x.id)).toEqual([keep.id]);
    const row = await prismaBase.user.findUnique({ where: { id: u.id } });
    expect(row).toMatchObject({ passwordResetToken: null, passwordResetExpires: null });
  });

  it('two tenants: an update changes only the caller\'s own row', async () => {
    const before = await prismaBase.user.findUnique({ where: { id: pair.b.users.admin.id } });
    const res = await request(app).patch('/api/users/me').set(bearer(pair.a.users.admin.token)).send({ displayName: `Only A ${SUFFIX}` });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(pair.a.users.admin.id);
    const after = await prismaBase.user.findUnique({ where: { id: pair.b.users.admin.id } });
    expect(after!.displayName).toBe(before!.displayName);
    expect((await prismaBase.user.findUnique({ where: { id: pair.a.users.admin.id } }))!.displayName).toBe(`Only A ${SUFFIX}`);
  });

  it('GET /api/auth/me returns displayName and photoUrl', async () => {
    const res = await request(app).get('/api/auth/me').set(bearer(pair.a.users.admin.token));
    expect(res.body.user).toHaveProperty('displayName');
    expect(res.body.user).toHaveProperty('photoUrl');
  });
});

describe('profile photo', () => {
  const upload = (token: string, buf: Buffer, type: string, name = 'me.png') =>
    request(app).post('/api/users/me/photo').set(bearer(token)).attach('photo', buf, { filename: name, contentType: type });

  it('stores a png under the tenant and sets photoUrl; remove clears it', async () => {
    const u = await mkUser('sales_rep');
    const res = await upload(u.token(), PNG, 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.user.photoUrl).toMatch(new RegExp(`^https://img.test/avatars/${pair.a.id}/user-${u.id}-\\d+\\.png$`));

    const gone = await request(app).delete('/api/users/me/photo').set(bearer(u.token()));
    expect(gone.status).toBe(200);
    expect(gone.body.user.photoUrl).toBeNull();
  });

  it('accepts jpeg and webp', async () => {
    const u = await mkUser('manager');
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
    expect((await upload(u.token(), jpeg, 'image/jpeg', 'a.jpg')).status).toBe(200);
    expect((await upload(u.token(), webp, 'image/webp', 'a.webp')).status).toBe(200);
  });

  it('a photo over 5 MB gives 413', async () => {
    const u = await mkUser('sales_rep');
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(u.token(), big, 'image/png');
    expect(res.status).toBe(413);
    expect((await prismaBase.user.findUnique({ where: { id: u.id } }))!.photoUrl).toBeNull();
  });

  it('rejects a gif, a file whose bytes are not an image, and a missing file', async () => {
    const u = await mkUser('sales_rep');
    expect((await upload(u.token(), PNG, 'image/gif', 'a.gif')).status).toBe(400);
    expect((await upload(u.token(), Buffer.from('<script>alert(1)</script>'.repeat(3)), 'image/png')).status).toBe(400);
    const none = await request(app).post('/api/users/me/photo').set(bearer(u.token()));
    expect(none.status).toBe(400);
  });

  it('a failed upload keeps the old photo', async () => {
    const u = await mkUser('sales_rep');
    const first = await upload(u.token(), PNG, 'image/png');
    expect(first.status).toBe(200);
    uploadFails = true;
    try {
      const res = await upload(u.token(), PNG, 'image/png');
      expect(res.status).toBe(500);
    } finally {
      uploadFails = false;
    }
    expect((await prismaBase.user.findUnique({ where: { id: u.id } }))!.photoUrl).toBe(first.body.user.photoUrl);
  });
});
