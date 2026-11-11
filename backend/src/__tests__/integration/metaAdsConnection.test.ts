/**
 * M8-T04 (COD-71): Meta Ads connection. initiate -> callback -> pick -> save -> list, missing scope, toggle, delete,
 * reconnect, two-tenant isolation, role check, and the token never in a response or a log line. Meta HTTP is mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import '../mocks/socketInstance.mock';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import logger from '../../utils/logger';
import { prismaBase } from '../../utils/prisma';
import { decryptString } from '../../utils/providerCrypto';
import { bearer } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
const bodies: unknown[] = [];

// What the mocked Meta returns
let debugData: Record<string, unknown>;
let tokenCounter = 0;
const ACCOUNTS = [
  { account_id: '1001', name: 'MG Nigeria', currency: 'NGN', timezone_name: 'Africa/Lagos', account_status: 1 },
  { account_id: '1002', name: 'MG Ghana', currency: 'GHS', timezone_name: 'Africa/Accra', account_status: 1 },
];
const calls: string[] = [];

function mockMeta() {
  (global as any).fetch = jest.fn(async (url: string, opts: any = {}) => {
    calls.push(`${opts.method || 'GET'} ${url.split('?')[0]}`);
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });
    if (url.includes('/oauth/access_token')) {
      return ok({ access_token: url.includes('fb_exchange_token') ? `LONGTOKEN_${tokenCounter}` : `SHORTTOKEN_${tokenCounter}`, expires_in: 5184000 });
    }
    if (url.includes('/debug_token')) return ok({ data: debugData });
    if (url.includes('/me/adaccounts')) return ok({ data: ACCOUNTS, paging: { cursors: { after: 'x' } } });
    if (url.includes('/me/permissions')) return ok({ success: true });
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
}

async function connect(token: string, accountIds: string[], scopes = ['ads_read', 'business_management']) {
  debugData = { is_valid: true, type: 'USER', expires_at: Math.floor(Date.now() / 1000) + 50 * 86400, scopes };
  tokenCounter++;
  const init = await request(app).post('/api/meta-ads/oauth/initiate').set(bearer(token));
  expect(init.status).toBe(200);
  bodies.push(init.body);
  const state = new URL(init.body.authUrl).searchParams.get('state')!;
  const cb = await request(app).get('/api/meta-ads/oauth/callback').query({ code: 'abc', state });
  expect(cb.status).toBe(302);
  return { init, cb, location: cb.headers.location as string };
}

const pickIdOf = (location: string) => new URL(location).searchParams.get('pick')!;

beforeAll(async () => {
  process.env.META_APP_ID = '123';
  process.env.META_APP_SECRET = 'sekret';
  process.env.BACKEND_URL = 'http://localhost:3000';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);
  delete process.env.META_ADS_CONFIG_ID;
  pair = await createTwoTenants('metaads');
}, 60000);

afterAll(async () => {
  const ids = [pair.a.id, pair.b.id];
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: { in: ids } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

beforeEach(() => mockMeta());

describe('Meta Ads connection (T04)', () => {
  let accountDbId: number;

  it('initiate -> callback -> pick list -> save -> list', async () => {
    const { a } = pair;
    const { init, location } = await connect(a.users.admin.token, []);
    const url = new URL(init.body.authUrl);
    expect(url.pathname).toBe('/v25.0/dialog/oauth');
    expect(url.searchParams.get('scope')).toBe('ads_read,business_management');
    expect(location).toContain('/settings?tab=integrations&section=meta-ads&metaAds=pick&pick=');
    expect(location).not.toContain('TOKEN');

    const pick = pickIdOf(location);
    const list = await request(app).get(`/api/meta-ads/oauth/pick/${pick}`).set(bearer(a.users.admin.token));
    bodies.push(list.body);
    expect(list.status).toBe(200);
    expect(list.body.accounts).toEqual([
      { id: '1001', name: 'MG Nigeria', currency: 'NGN', timezone: 'Africa/Lagos', alreadyConnected: false },
      { id: '1002', name: 'MG Ghana', currency: 'GHS', timezone: 'Africa/Accra', alreadyConnected: false },
    ]);

    const save = await request(app).post(`/api/meta-ads/oauth/pick/${pick}`).set(bearer(a.users.admin.token)).send({ accountIds: ['1001'] });
    bodies.push(save.body);
    expect(save.status).toBe(200);
    expect(save.body).toEqual({ connected: 1 });

    // the pick is consumed
    const again = await request(app).get(`/api/meta-ads/oauth/pick/${pick}`).set(bearer(a.users.admin.token));
    expect(again.status).toBe(404);

    const accounts = await request(app).get('/api/meta-ads/accounts').set(bearer(a.users.admin.token));
    bodies.push(accounts.body);
    expect(accounts.status).toBe(200);
    expect(accounts.body.accounts).toHaveLength(1);
    const row = accounts.body.accounts[0];
    accountDbId = row.id;
    expect(row).toMatchObject({
      accountId: '1001', name: 'MG Nigeria', currency: 'NGN', timezone: 'Africa/Lagos', enabled: true,
      status: 'connected', statusReason: null, tokenType: 'user', lastPulledAt: null, lastPullError: null,
    });
    expect(row.tokenExpiresAt).toBeTruthy();
    expect(row).not.toHaveProperty('accessToken');

    const stored = await prismaBase.metaAdAccount.findFirstOrThrow({ where: { tenantId: a.id, accountId: '1001' } });
    expect(stored.accessToken.startsWith('enc:v1:')).toBe(true);
    expect(decryptString(stored.accessToken)).toBe('LONGTOKEN_1');
    expect(stored.scopes).toEqual(['ads_read', 'business_management']);
    expect(stored.connectedById).toBe(a.users.admin.id);
  });

  it('a missing ads_read scope redirects with the scope named and stores nothing', async () => {
    const { location } = await connect(pair.a.users.admin.token, [], ['business_management']);
    const u = new URL(location);
    expect(u.searchParams.get('metaAds')).toBe('error');
    expect(u.searchParams.get('message')).toContain('ads_read');
    expect(u.searchParams.get('pick')).toBeNull();
  });

  it('a reused or unknown state is rejected', async () => {
    const cb = await request(app).get('/api/meta-ads/oauth/callback').query({ code: 'abc', state: 'nope' });
    expect(new URL(cb.headers.location).searchParams.get('metaAds')).toBe('error');
  });

  it('PATCH toggles an account', async () => {
    const h = bearer(pair.a.users.admin.token);
    const off = await request(app).patch(`/api/meta-ads/accounts/${accountDbId}`).set(h).send({ enabled: false });
    expect(off.status).toBe(200);
    expect((await prismaBase.metaAdAccount.findUniqueOrThrow({ where: { id: accountDbId } })).enabled).toBe(false);
    const bad = await request(app).patch(`/api/meta-ads/accounts/${accountDbId}`).set(h).send({ enabled: 'yes' });
    expect(bad.status).toBe(400);
  });

  it('reconnect replaces the token and clears the disconnected state', async () => {
    const { a } = pair;
    await prismaBase.metaAdAccount.updateMany({
      where: { tenantId: a.id, accountId: '1001' },
      data: { status: 'disconnected', statusReason: 'Meta access was removed. Reconnect Meta Ads.' },
    });
    const { location } = await connect(a.users.admin.token, []);
    const pick = pickIdOf(location);
    const list = await request(app).get(`/api/meta-ads/oauth/pick/${pick}`).set(bearer(a.users.admin.token));
    expect(list.body.accounts.find((x: any) => x.id === '1001').alreadyConnected).toBe(true);
    const save = await request(app).post(`/api/meta-ads/oauth/pick/${pick}`).set(bearer(a.users.admin.token)).send({ accountIds: ['1001'] });
    expect(save.status).toBe(200);

    const rows = await prismaBase.metaAdAccount.findMany({ where: { tenantId: a.id, accountId: '1001' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(accountDbId);
    expect(decryptString(rows[0].accessToken)).toBe(`LONGTOKEN_${tokenCounter}`);
    expect(rows[0]).toMatchObject({ status: 'connected', statusReason: null });
  });

  it('tenant B cannot see, change, delete or pick tenant A accounts', async () => {
    const { a, b } = pair;
    const hb = bearer(b.users.admin.token);
    const list = await request(app).get('/api/meta-ads/accounts').set(hb);
    expect(list.body.accounts).toEqual([]);
    expect((await request(app).patch(`/api/meta-ads/accounts/${accountDbId}`).set(hb).send({ enabled: true })).status).toBe(404);
    expect((await request(app).delete(`/api/meta-ads/accounts/${accountDbId}`).set(hb)).status).toBe(404);

    // A's pick session is not reachable by B
    const { location } = await connect(a.users.admin.token, []);
    const pick = pickIdOf(location);
    expect((await request(app).get(`/api/meta-ads/oauth/pick/${pick}`).set(hb)).status).toBe(404);
    expect((await request(app).post(`/api/meta-ads/oauth/pick/${pick}`).set(hb).send({ accountIds: ['1002'] })).status).toBe(404);
    expect(await prismaBase.metaAdAccount.count({ where: { tenantId: b.id } })).toBe(0);
    // and A's account is untouched
    expect((await prismaBase.metaAdAccount.findUniqueOrThrow({ where: { id: accountDbId } })).enabled).toBe(false);
  });

  it('a call rep gets 403 on every route', async () => {
    const h = bearer(pair.a.users.salesRep.token);
    expect((await request(app).get('/api/meta-ads/accounts').set(h)).status).toBe(403);
    expect((await request(app).post('/api/meta-ads/oauth/initiate').set(h)).status).toBe(403);
    expect((await request(app).patch(`/api/meta-ads/accounts/${accountDbId}`).set(h).send({ enabled: true })).status).toBe(403);
    expect((await request(app).delete(`/api/meta-ads/accounts/${accountDbId}`).set(h)).status).toBe(403);
  });

  it('DELETE removes the row and does not revoke at Meta (would drop the WhatsApp grant)', async () => {
    calls.length = 0;
    const res = await request(app).delete(`/api/meta-ads/accounts/${accountDbId}`).set(bearer(pair.a.users.admin.token));
    expect(res.status).toBe(200);
    expect(await prismaBase.metaAdAccount.count({ where: { id: accountDbId } })).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((c) => c.startsWith('DELETE') && c.includes('/me/permissions'))).toBe(false);
  });

  it('no response body and no log line contains a token', () => {
    const everything = JSON.stringify(bodies);
    expect(everything).not.toMatch(/TOKEN_\d/);
    expect(everything).not.toContain('enc:v1:');
    const logged = JSON.stringify([
      ...(logger.info as jest.Mock).mock.calls,
      ...(logger.warn as jest.Mock).mock.calls,
      ...(logger.error as jest.Mock).mock.calls,
      ...(logger.debug as jest.Mock).mock.calls,
    ]);
    expect(logged).not.toMatch(/TOKEN_\d/);
    expect(logged).not.toContain('enc:v1:');
  });
});
