/**
 * M8-T06 (COD-71): the daily job twice changes no row; Refresh now: pulls, 429 on the second call, 403 for a call rep,
 * 404 for another tenant. Meta HTTP is mocked.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import '../mocks/socketInstance.mock';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { encryptString } from '../../utils/providerCrypto';
import { runInTenant } from '../../utils/tenantContext';
import { bearer } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import fixture from '../fixtures/metaInsights.json';

let pair: TwoTenants;
let adAccountId: number;

// Run the job for tenant A only; other suites may leave tenants in the shared test DB
let onlyTenant = '';
jest.mock('../../utils/tenantLoop', () => ({
  forEachTenant: async (_name: string, fn: (id: string) => Promise<void>) => {
    const { runInTenant: run } = jest.requireActual('../../utils/tenantContext') as any;
    await run(onlyTenant, () => fn(onlyTenant));
  },
}));
// Token health calls debug_token at Meta; the mocked fetch below only knows insights
jest.mock('../../services/metaTokenHealthService', () => ({
  ...(jest.requireActual('../../services/metaTokenHealthService') as object),
  checkAdsTokens: async () => undefined,
}));

import { processMetaPull } from '../../queues/metaPullQueue';

beforeAll(async () => {
  process.env.PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);
  pair = await createTwoTenants('metapulljob');
  onlyTenant = pair.a.id;
  const acc = await prismaBase.metaAdAccount.create({
    data: {
      tenantId: pair.a.id, accountId: '1001', name: 'MG Nigeria', currency: 'NGN', timezone: 'Africa/Accra',
      accessToken: encryptString('TOKEN_VALUE'), tokenType: 'system_user', scopes: ['ads_read'],
    },
  });
  adAccountId = acc.id;
}, 60000);

beforeEach(() => {
  (global as any).fetch = jest.fn(async (url: string) => {
    const body = url.includes('/insights') ? { data: [...fixture.page1.data, ...fixture.page2.data] } : fixture.statuses;
    return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
  });
});

afterAll(async () => {
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const snapshot = async () =>
  (await prismaBase.metaSpendDay.findMany({ where: { adAccountId }, orderBy: [{ campaignId: 'asc' }, { date: 'asc' }] }))
    .map(({ pulledAt, ...rest }) => ({ ...rest, spend: rest.spend.toString() }));

describe('daily Meta pull job', () => {
  it('running it twice changes no row', async () => {
    await processMetaPull();
    const first = await snapshot();
    expect(first.length).toBe(3);
    await processMetaPull();
    expect(await snapshot()).toEqual(first);
  });
});

describe('POST /api/meta-ads/accounts/:id/refresh', () => {
  const url = () => `/api/meta-ads/accounts/${adAccountId}/refresh`;

  it('a call rep gets 403 and does not use up the window', async () => {
    expect((await request(app).post(url()).set(bearer(pair.a.users.salesRep.token))).status).toBe(403);
  });

  it('tenant B gets 404 for tenant A account', async () => {
    expect((await request(app).post(url()).set(bearer(pair.b.users.admin.token))).status).toBe(404);
  });

  it('refreshes once, then 429 on the second call within 5 minutes', async () => {
    const h = bearer(pair.a.users.admin.token);
    const res = await request(app).post(url()).set(h);
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(3);
    expect(res.body.lastPullError).toBeNull();
    expect(res.body.lastPulledAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('TOKEN_VALUE');

    const again = await request(app).post(url()).set(h);
    expect(again.status).toBe(429);
    expect(again.body.error).toBe('Refresh again in a few minutes.');
  });
});
