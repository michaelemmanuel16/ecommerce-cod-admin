/**
 * M8-T19 (COD-76): the Meta token never leaves the server. Every GET/POST of /api/meta-ads and /api/marketing is
 * scanned for the plain token, `enc:v1:` and `access_token`. Every pull failure path (error 190, rate limit to
 * exhaustion, a network error whose message holds a URL with the token) is scanned in the logger, the console,
 * lastPullError, notifications and Findings. Meta HTTP is mocked.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import '../mocks/socketInstance.mock';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import logger from '../../utils/logger';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { encryptString } from '../../utils/providerCrypto';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { pullAccount } from '../../services/marketing/metaInsightsService';
import { mkProduct } from './helpers/marketingFixtures';
import fixture from '../fixtures/metaInsights.json';

jest.setTimeout(120_000);

const SECRET = 'EAAtestSECRET123';
const FORBIDDEN = [SECRET, 'enc:v1:', 'access_token'];
const RANGE = 'from=2026-11-01&to=2026-11-10';

let tenantId: string;
let owner: { id: number; token: string };
let accountId: number;
const extraAccounts: number[] = [];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json, headers: { get: () => null } });
const fail = (status: number, json: unknown) => ({ ok: false, status, json: async () => json, headers: { get: () => null } });
const useFetch = (fn: (url: string) => unknown) => { (global as any).fetch = jest.fn(async (url: string) => fn(url)); };

/** Meta as the daily pull sees it: the fixture. For OAuth, every token Meta hands out is the secret. */
const mockMeta = () => useFetch((url) => {
  if (url.includes('/oauth/access_token')) return ok({ access_token: SECRET, expires_in: 5184000 });
  if (url.includes('/debug_token')) return ok({ data: { is_valid: true, type: 'USER', expires_at: Math.floor(Date.now() / 1000) + 50 * 86400, scopes: ['ads_read', 'business_management'] } });
  if (url.includes('/me/adaccounts')) return ok({ data: [{ account_id: '4004', name: 'MG Picked', currency: 'NGN', timezone_name: 'Africa/Lagos', account_status: 1 }], paging: { cursors: { after: 'x' } } });
  if (url.includes('/insights')) return ok({ data: [...fixture.page1.data, ...fixture.page2.data] });
  return ok(fixture.statuses);
});

const mkAccount = async (accountIdStr: string) => {
  const row = await prismaBase.metaAdAccount.create({
    data: {
      tenantId, accountId: accountIdStr, name: `Acct ${accountIdStr}`, currency: 'NGN', timezone: 'Africa/Accra',
      accessToken: encryptString(SECRET), tokenType: 'system_user', scopes: ['ads_read'],
    },
  });
  extraAccounts.push(row.id);
  return row.id;
};

/** Everything logged so far (all logger levels and console), flattened to text. Errors include message and stack. */
const logged = (spies: jest.SpiedFunction<any>[]): string => {
  const flat = (a: unknown): string => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a, (_k, v) => (v instanceof Error ? `${v.message}\n${v.stack}` : v)));
  const calls = [
    ...(['info', 'warn', 'error', 'debug'] as const).flatMap((l) => (logger[l] as any).mock.calls),
    ...spies.flatMap((s) => s.mock.calls),
  ];
  return calls.map((c: unknown[]) => c.map(flat).join(' ')).join('\n');
};

const expectClean = (what: string, text: string) => {
  for (const f of FORBIDDEN) expect({ what, leaks: text.includes(f) ? f : null }).toEqual({ what, leaks: null });
};
const scanRes = (what: string, res: request.Response) => expectClean(what, JSON.stringify([res.body, res.text, res.headers]));

/** What the failed pulls left in the database for this tenant. */
const storedText = async () => {
  const [accounts, notes, findings] = await Promise.all([
    prismaBase.metaAdAccount.findMany({ where: { tenantId }, select: { lastPullError: true, statusReason: true } }),
    prismaBase.notification.findMany({ where: { tenantId } }),
    prismaBase.finding.findMany({ where: { tenantId } }),
  ]);
  return JSON.stringify([accounts, notes, findings]);
};

let spies: jest.SpiedFunction<any>[] = [];

beforeAll(async () => {
  process.env.META_APP_ID = '123';
  process.env.META_APP_SECRET = 'sekret';
  process.env.BACKEND_URL = 'http://localhost:3000';
  process.env.FRONTEND_URL = 'http://localhost:5173';
  process.env.PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);
  delete process.env.META_ADS_CONFIG_ID;
  tenantId = (await createTenant('M8 secrecy', { currency: 'GHS' })).id;
  await seedTenantDefaults(tenantId);
  owner = await mkUser(tenantId, 'owner', 'super_admin');
  accountId = await mkAccount('3003');
  await prismaBase.fxRate.create({ data: { tenantId, fromCurrency: 'GHS', toCurrency: 'NGN', rate: 112, date: new Date('2026-10-01T00:00:00Z'), source: 'manual' } });
}, 120000);

beforeEach(() => {
  mockMeta();
  spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
});

afterAll(async () => {
  spies.forEach((s) => s.mockRestore());
  await prismaBase.expense.deleteMany({ where: { tenantId } });
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId } });
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('API output', () => {
  it('no GET or POST under /api/meta-ads or /api/marketing carries the token', async () => {
    const h = bearer(owner.token);
    const productId = await mkProduct(tenantId, 'SECRECY', 10);
    const seen: [string, request.Response][] = [];
    const hit = async (what: string, req: request.Test) => { const res = await req; seen.push([what, res]); return res; };

    // OAuth: the token Meta returns is the secret, so a leak in initiate, callback or pick would show here
    const init = await hit('POST /meta-ads/oauth/initiate', request(app).post('/api/meta-ads/oauth/initiate').set(h));
    expect(init.status).toBe(200);
    const state = new URL(init.body.authUrl).searchParams.get('state')!;
    const cb = await hit('GET /meta-ads/oauth/callback', request(app).get('/api/meta-ads/oauth/callback').query({ code: 'abc', state }));
    expect(cb.status).toBe(302);
    const pick = new URL(cb.headers.location).searchParams.get('pick')!;
    expect((await hit('GET /meta-ads/oauth/pick', request(app).get(`/api/meta-ads/oauth/pick/${pick}`).set(h))).status).toBe(200);
    expect((await hit('POST /meta-ads/oauth/pick', request(app).post(`/api/meta-ads/oauth/pick/${pick}`).set(h).send({ accountIds: ['4004'] }))).status).toBe(200);
    expect((await hit('GET /meta-ads/oauth/pick (gone)', request(app).get(`/api/meta-ads/oauth/pick/${pick}`).set(h))).status).toBe(404);

    expect((await hit('GET /meta-ads/accounts', request(app).get('/api/meta-ads/accounts').set(h))).body.accounts.length).toBeGreaterThanOrEqual(2);
    expect((await hit('POST /meta-ads/accounts/:id/refresh', request(app).post(`/api/meta-ads/accounts/${accountId}/refresh`).set(h))).status).toBe(200);
    expect((await hit('PATCH /meta-ads/accounts/:id', request(app).patch(`/api/meta-ads/accounts/${accountId}`).set(h).send({ enabled: true }))).status).toBe(200);

    const rule = await hit('POST /marketing/mappings/rules', request(app).post('/api/marketing/mappings/rules').set(h).send({ prefix: 'MG_Oct', productId }));
    expect(rule.status).toBe(201);
    for (const path of ['mappings', `campaigns?${RANGE}`, `campaigns/unmapped?${RANGE}`, `summary?${RANGE}`, `funnel?${RANGE}`, `campaigns/performance?${RANGE}`]) {
      const res = await hit(`GET /marketing/${path.split('?')[0]}`, request(app).get(`/api/marketing/${path}`).set(h));
      expect(res.status).toBe(200);
    }
    // Error replies too
    await hit('POST refresh (404)', request(app).post('/api/meta-ads/accounts/99999999/refresh').set(h));
    await hit('POST pick (400)', request(app).post(`/api/meta-ads/oauth/pick/${pick}`).set(h).send({ accountIds: [] }));

    expect(seen.length).toBeGreaterThanOrEqual(15);
    for (const [what, res] of seen) scanRes(what, res);
    // Nothing the app logged on the way carries it either
    expectClean('logs', logged(spies));
  });
});

describe('pull failure paths', () => {
  const pull = (id: number) => runInTenant(tenantId, () => pullAccount(id, 3, { sleep: async () => undefined }));

  it('error 190: token revoked', async () => {
    const id = await mkAccount('5001');
    useFetch(() => fail(400, fixture.tokenError));
    expect(await pull(id)).toEqual([]);
    expect((await prismaBase.metaAdAccount.findUniqueOrThrow({ where: { id } })).lastPullError).toBe('Meta access was removed. Reconnect Meta Ads.');
    expectClean('190 logs', logged(spies));
    expectClean('190 stored', await storedText());
  });

  it('rate limit to exhaustion, twice (second failure alerts)', async () => {
    const id = await mkAccount('5002');
    useFetch(() => fail(400, fixture.rateLimitError));
    expect(await pull(id)).toEqual([]);
    expect(await pull(id)).toEqual([]);
    const row = await prismaBase.metaAdAccount.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ failedPullCount: 2, lastPullError: 'Meta is limiting requests. The next pull will try again.' });
    expect(await prismaBase.notification.count({ where: { tenantId, type: 'meta_ads_pull' } })).toBeGreaterThanOrEqual(1);
    expectClean('rate limit logs', logged(spies));
    expectClean('rate limit stored', await storedText());
  });

  it('a network error whose message holds a URL with access_token=<token>', async () => {
    const id = await mkAccount('5003');
    useFetch(() => { throw new Error(`request to https://graph.facebook.com/v25.0/act_5003/insights?access_token=${SECRET}&level=campaign failed, reason: socket hang up`); });
    expect(await pull(id)).toEqual([]);
    await pull(id); // second failure: the notification path
    expect(await prismaBase.metaAdAccount.findUniqueOrThrow({ where: { id } })).toMatchObject({ failedPullCount: 2 });
    expectClean('network logs', logged(spies));
    expectClean('network stored', await storedText());
  });
});
