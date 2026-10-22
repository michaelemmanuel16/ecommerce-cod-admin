/**
 * M3-T23 (COD-24): signed-in sessions. One UserSession per login, refresh rotation per session,
 * list / sign out / sign out everywhere else, deactivate ends all sessions, and users who only have the
 * old User.refreshToken value keep working (they refresh once and move onto a session).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateRefreshToken, verifyAccessToken } from '../../utils/jwt';
import { hashToken } from '../../services/sessionService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const PASSWORD = 'Passw0rd!sess';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
let pair: TwoTenants;
let seq = 0;

async function mkUser(role: any = 'sales_rep', extra: Record<string, unknown> = {}) {
  return prismaBase.user.create({
    data: {
      email: `sess-${SUFFIX}-${seq++}@codadmin.test`,
      password: await bcrypt.hash(PASSWORD, 4),
      firstName: 'Esi', lastName: 'Owusu', role, tenantId: pair.a.id, ...extra,
    },
  });
}

const login = (email: string, ua = CHROME_MAC) =>
  request(app).post('/api/auth/login').set('User-Agent', ua).send({ email, password: PASSWORD });
const refresh = (refreshToken: string) => request(app).post('/api/auth/refresh').send({ refreshToken });

beforeAll(async () => {
  pair = await createTwoTenants('sessapi');
});

afterAll(async () => {
  await prismaBase.userSession.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.user.deleteMany({ where: { email: { startsWith: 'sess-' }, tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.user.deleteMany({ where: { email: { startsWith: 'sess-platform-' } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('login and list', () => {
  it('login on two devices gives two sessions with device label and IP; the list marks this device', async () => {
    const u = await mkUser();
    const d1 = await login(u.email, CHROME_MAC);
    const d2 = await login(u.email, SAFARI_IPHONE);
    expect(d1.status).toBe(200);
    expect(d2.status).toBe(200);
    expect(d1.body.tokens.refreshToken).not.toBe(d2.body.tokens.refreshToken);

    const rows = await prismaBase.userSession.findMany({ where: { userId: u.id }, orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.deviceLabel)).toEqual(['Chrome on macOS', 'Safari on iOS']);
    expect(rows[0].tokenHash).toBe(hashToken(d1.body.tokens.refreshToken)); // only the hash is stored
    expect(rows[0].ip).toBeTruthy();
    expect(verifyAccessToken(d1.body.tokens.accessToken).sid).toBe(rows[0].id);

    const list = await request(app).get('/api/auth/sessions').set(bearer(d1.body.tokens.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.find((s: any) => s.current).id).toBe(rows[0].id);
    expect(list.body.sessions.filter((s: any) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');
  });

  it('two tenants: the list holds only the caller\'s sessions and another tenant\'s session cannot be ended', async () => {
    const u = await mkUser();
    const l = await login(u.email);
    const bSession = await prismaBase.userSession.findFirstOrThrow({ where: { tenantId: pair.b.id } });

    const list = await request(app).get('/api/auth/sessions').set(bearer(l.body.tokens.accessToken));
    expect(list.body.sessions.map((s: any) => s.id)).not.toContain(bSession.id);

    const del = await request(app).delete(`/api/auth/sessions/${bSession.id}`).set(bearer(l.body.tokens.accessToken));
    expect(del.status).toBe(404);
    expect(await prismaBase.userSession.findUnique({ where: { id: bSession.id } })).not.toBeNull();
  });

  it('a colleague in the same tenant cannot end my session', async () => {
    const me = await mkUser();
    const other = await mkUser();
    const mine = await login(me.email);
    const theirs = await login(other.email);
    const mySession = await prismaBase.userSession.findFirstOrThrow({ where: { userId: me.id } });
    const del = await request(app).delete(`/api/auth/sessions/${mySession.id}`).set(bearer(theirs.body.tokens.accessToken));
    expect(del.status).toBe(404);
    expect((await refresh(mine.body.tokens.refreshToken)).status).toBe(200);
  });
});

describe('refresh rotation', () => {
  it('returns a new refresh token in the same session; the old one fails; the new one works', async () => {
    const u = await mkUser();
    const l = await login(u.email);
    const old = l.body.tokens.refreshToken;

    const r1 = await refresh(old);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    expect(r1.body.refreshToken).toBeTruthy();
    expect(r1.body.refreshToken).not.toBe(old);
    expect(await prismaBase.userSession.count({ where: { userId: u.id } })).toBe(1); // same session
    expect(verifyAccessToken(r1.body.accessToken).sid).toBe(verifyAccessToken(l.body.tokens.accessToken).sid);

    const replay = await refresh(old);
    expect(replay.status).toBe(401);

    const r2 = await refresh(r1.body.refreshToken);
    expect(r2.status).toBe(200);
    // the new access token works on a real route
    expect((await request(app).get('/api/auth/me').set(bearer(r2.body.accessToken))).status).toBe(200);
  });

  it('rotating one session leaves the other session untouched', async () => {
    const u = await mkUser();
    const a = await login(u.email, CHROME_MAC);
    const b = await login(u.email, SAFARI_IPHONE);
    expect((await refresh(a.body.tokens.refreshToken)).status).toBe(200);
    expect((await refresh(b.body.tokens.refreshToken)).status).toBe(200);
  });

  it('two calls with the same token at once: one wins, one gets 401', async () => {
    const u = await mkUser();
    const l = await login(u.email);
    const results = await Promise.all([refresh(l.body.tokens.refreshToken), refresh(l.body.tokens.refreshToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await prismaBase.userSession.count({ where: { userId: u.id } })).toBe(1);
  });

  it('rejects a missing, malformed, forged or unknown token', async () => {
    const u = await mkUser();
    expect((await request(app).post('/api/auth/refresh').send({})).status).toBe(400);
    expect((await refresh('garbage')).status).toBe(401);
    // valid signature, but no session and not the stored legacy value
    const unknown = generateRefreshToken({ id: u.id, email: u.email, role: u.role, tenantId: pair.a.id });
    expect((await refresh(unknown)).status).toBe(401);
  });
});

describe('legacy users (only User.refreshToken)', () => {
  it('still refreshes once, then holds a session with a rotated token', async () => {
    const u = await mkUser();
    const legacy = generateRefreshToken({ id: u.id, email: u.email, role: u.role, tenantId: pair.a.id });
    await prismaBase.user.update({ where: { id: u.id }, data: { refreshToken: legacy } });
    expect(await prismaBase.userSession.count({ where: { userId: u.id } })).toBe(0);

    const r1 = await refresh(legacy);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    expect(r1.body.refreshToken).toBeTruthy();
    expect(verifyAccessToken(r1.body.accessToken).sid).toBeGreaterThan(0);

    // the old value is spent; the session now holds the new token
    expect((await prismaBase.user.findUnique({ where: { id: u.id } }))!.refreshToken).toBeNull();
    expect(await prismaBase.userSession.count({ where: { userId: u.id } })).toBe(1);
    expect((await refresh(legacy)).status).toBe(401);
    expect((await refresh(r1.body.refreshToken)).status).toBe(200);
  });

  it('two legacy refreshes at once make exactly one session', async () => {
    const u = await mkUser();
    const legacy = generateRefreshToken({ id: u.id, email: u.email, role: u.role, tenantId: pair.a.id });
    await prismaBase.user.update({ where: { id: u.id }, data: { refreshToken: legacy } });
    const results = await Promise.all([refresh(legacy), refresh(legacy)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await prismaBase.userSession.count({ where: { userId: u.id } })).toBe(1);
  });

  it('a legacy user with a wrong value, or a deactivated one, gets 401', async () => {
    const u = await mkUser();
    const stored = generateRefreshToken({ id: u.id, email: u.email, role: u.role, tenantId: pair.a.id });
    const other = generateRefreshToken({ id: u.id, email: u.email, role: u.role, tenantId: pair.a.id });
    await prismaBase.user.update({ where: { id: u.id }, data: { refreshToken: stored } });
    expect((await refresh(other)).status).toBe(401);
    await prismaBase.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await refresh(stored)).status).toBe(401);
  });

  it('a platform admin without a tenant keeps the old flow (login, refresh, no rotation)', async () => {
    const u = await prismaBase.user.create({
      data: { email: `sess-platform-${SUFFIX}@codadmin.test`, password: await bcrypt.hash(PASSWORD, 4), firstName: 'Plat', lastName: 'Form', role: 'super_admin', tenantId: null, isPlatformAdmin: true },
    });
    const l = await login(u.email);
    expect(l.status).toBe(200);
    const r = await refresh(l.body.tokens.refreshToken);
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeUndefined();
    expect((await refresh(l.body.tokens.refreshToken)).status).toBe(200); // same token keeps working
  });
});

describe('sign out', () => {
  it('revoke-others keeps the current session and ends the rest', async () => {
    const u = await mkUser();
    const a = await login(u.email, CHROME_MAC);
    const b = await login(u.email, SAFARI_IPHONE);
    const c = await login(u.email, CHROME_MAC);

    const res = await request(app).post('/api/auth/sessions/revoke-others').set(bearer(b.body.tokens.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);

    expect((await refresh(a.body.tokens.refreshToken)).status).toBe(401);
    expect((await refresh(c.body.tokens.refreshToken)).status).toBe(401);
    expect((await refresh(b.body.tokens.refreshToken)).status).toBe(200);
    const list = await request(app).get('/api/auth/sessions').set(bearer(b.body.tokens.accessToken));
    expect(list.body.sessions).toHaveLength(1);
  });

  it('revoke-others from a token without a session id is a 400, and nothing is ended', async () => {
    const u = await mkUser();
    const l = await login(u.email);
    const { generateAccessToken } = await import('../../utils/jwt');
    const noSid = generateAccessToken({ id: u.id, email: u.email, role: u.role, tenantId: pair.a.id });
    const res = await request(app).post('/api/auth/sessions/revoke-others').set(bearer(noSid));
    expect(res.status).toBe(400);
    expect((await refresh(l.body.tokens.refreshToken)).status).toBe(200);
  });

  it('DELETE ends one session; its refresh token stops working', async () => {
    const u = await mkUser();
    const a = await login(u.email, CHROME_MAC);
    const b = await login(u.email, SAFARI_IPHONE);
    const bId = verifyAccessToken(b.body.tokens.accessToken).sid;
    const res = await request(app).delete(`/api/auth/sessions/${bId}`).set(bearer(a.body.tokens.accessToken));
    expect(res.status).toBe(200);
    expect((await refresh(b.body.tokens.refreshToken)).status).toBe(401);
    expect((await refresh(a.body.tokens.refreshToken)).status).toBe(200);
    expect((await request(app).delete(`/api/auth/sessions/${bId}`).set(bearer(a.body.tokens.accessToken))).status).toBe(404);
  });

  it('logout ends this session only', async () => {
    const u = await mkUser();
    const a = await login(u.email, CHROME_MAC);
    const b = await login(u.email, SAFARI_IPHONE);
    expect((await request(app).post('/api/auth/logout').set(bearer(a.body.tokens.accessToken))).status).toBe(200);
    expect((await refresh(a.body.tokens.refreshToken)).status).toBe(401);
    expect((await refresh(b.body.tokens.refreshToken)).status).toBe(200);
  });

  it('deactivating a user ends all their sessions', async () => {
    const target = await mkUser();
    const a = await login(target.email, CHROME_MAC);
    const b = await login(target.email, SAFARI_IPHONE);
    const admin = await mkUser('super_admin');
    const adminLogin = await login(admin.email);

    const res = await request(app).delete(`/api/users/${target.id}`).set(bearer(adminLogin.body.tokens.accessToken));
    expect(res.status).toBe(200);
    expect(await prismaBase.userSession.count({ where: { userId: target.id } })).toBe(0);
    expect((await refresh(a.body.tokens.refreshToken)).status).toBe(401);
    expect((await refresh(b.body.tokens.refreshToken)).status).toBe(401);
    // the admin's own session is untouched
    expect((await refresh(adminLogin.body.tokens.refreshToken)).status).toBe(200);
  });

  it('an admin password reset and the forgot-password reset end all sessions', async () => {
    const u = await mkUser();
    const l = await login(u.email);
    const raw = `raw-sess-reset-${SUFFIX}`;
    await prismaBase.user.update({
      where: { id: u.id },
      data: { passwordResetToken: require('crypto').createHash('sha256').update(raw).digest('hex'), passwordResetExpires: new Date(Date.now() + 600_000) },
    });
    expect((await request(app).post('/api/auth/reset-password').send({ token: raw, password: 'Brandnew1!pw' })).status).toBe(200);
    expect((await refresh(l.body.tokens.refreshToken)).status).toBe(401);
  });
});
