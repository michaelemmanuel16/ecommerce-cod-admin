/**
 * M8-T19 (COD-76): the whole M8 chain for two tenants. Meta HTTP mocked with the fixture. The daily job body
 * (processMetaPull) pulls spend, posts it to the ledger (DR 5080) and the Marketing API reads it back.
 * Re-running changes nothing; a changed day posts one difference entry; tenant B never shows in tenant A.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import '../mocks/socketInstance.mock';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { encryptString } from '../../utils/providerCrypto';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { utcDateOfYmd } from '../../services/kpi/dates';
import fixture from '../fixtures/metaInsights.json';

jest.setTimeout(240_000);

// Run the job for one tenant at a time; other suites may leave tenants in the shared test DB
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

const RANGE = 'from=2026-11-09&to=2026-11-10';
const B_STRINGS = ['MG_tenantB_secret', '424242', '77777.77', '77777', 'B Account Secret', '2002', '9001'];

let a: string;
let b: string;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let accountA: number;
let accountB: number;
let day10Spend = '51000.00';

const rowsB = [{
  account_currency: 'NGN', campaign_id: '9001', campaign_name: 'MG_tenantB_secret', date_start: '2026-11-10', date_stop: '2026-11-10',
  spend: '77777.77', impressions: '424242', inline_link_clicks: '10', actions: [],
}];

const mockMeta = () => {
  (global as any).fetch = jest.fn(async (url: string) => {
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json, headers: { get: () => null } });
    if (url.includes('/act_2002/insights')) return ok({ data: rowsB });
    if (url.includes('/act_1001/insights')) {
      if (url.includes('after=b')) return ok({ data: fixture.page2.data.map((r) => ({ ...r, spend: day10Spend })) });
      return ok(fixture.page1);
    }
    if (url.includes('ids=9001')) return ok({ '9001': { effective_status: 'ACTIVE', id: '9001' } });
    return ok(fixture.statuses);
  });
};

const runJob = async (tenantId: string) => { onlyTenant = tenantId; await processMetaPull(); };
const get = (path: string, token: string) => request(app).get(`/api/${path}${path.includes('?') ? '&' : '?'}${RANGE}`).set(bearer(token));
const ledger = async () => ({
  entries: await prismaBase.journalEntry.count({ where: { tenantId: a, sourceType: 'expense' } }),
  b5080: (await prismaBase.account.findFirstOrThrow({ where: { tenantId: a, code: '5080' } })).currentBalance.toFixed(2),
  b1010: (await prismaBase.account.findFirstOrThrow({ where: { tenantId: a, code: '1010' } })).currentBalance.toFixed(2),
  expenses: (await prismaBase.expense.findMany({ where: { tenantId: a }, orderBy: { expenseDate: 'asc' } })).map((e) => [e.id, e.amount.toFixed(2)]),
});
const spendRows = async () =>
  (await prismaBase.metaSpendDay.findMany({ where: { adAccountId: accountA }, orderBy: [{ campaignId: 'asc' }, { date: 'asc' }] }))
    .map(({ pulledAt, ...rest }) => ({ ...rest, spend: rest.spend.toString() }));

beforeEach(() => mockMeta());

beforeAll(async () => {
  // Fixed clock (Date only): the job pulls the last 3 days, and the fixture days are 2026-11-09 and 2026-11-10
  jest.useFakeTimers({
    now: new Date('2026-11-11T09:00:00Z'),
    doNotFake: ['nextTick', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'hrtime', 'performance', 'queueMicrotask'],
  });
  process.env.PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);
  a = (await createTenant('M8 e2e A', { currency: 'GHS' })).id;
  b = (await createTenant('M8 e2e B', { currency: 'GHS' })).id;
  await Promise.all([seedTenantDefaults(a), seedTenantDefaults(b)]);
  ownerA = await mkUser(a, 'ownerA', 'super_admin');
  ownerB = await mkUser(b, 'ownerB', 'super_admin');
  const mk = (tenantId: string, accountId: string, name: string) => prismaBase.metaAdAccount.create({
    data: {
      tenantId, accountId, name, currency: 'NGN', timezone: 'Africa/Accra',
      accessToken: encryptString('TOKEN_VALUE'), tokenType: 'system_user', scopes: ['ads_read'],
    },
  }).then((r) => r.id);
  accountA = await mk(a, '1001', 'MG Nigeria');
  accountB = await mk(b, '2002', 'B Account Secret');
  // Store GHS, ad accounts NGN: the rate is kept as GHS to NGN 112 and used inverted
  await prismaBase.fxRate.create({ data: { tenantId: a, fromCurrency: 'GHS', toCurrency: 'NGN', rate: 112, date: utcDateOfYmd('2026-10-01'), source: 'manual' } });
  await prismaBase.fxRate.create({ data: { tenantId: b, fromCurrency: 'GHS', toCurrency: 'NGN', rate: 100, date: utcDateOfYmd('2026-10-01'), source: 'manual' } });
}, 120000);

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.expense.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await deleteTenantRows([a, b]);
  await prismaBase.$disconnect();
});

describe('M8 end to end', () => {
  let afterFirst: Awaited<ReturnType<typeof ledger>>;
  let rowsFirst: Awaited<ReturnType<typeof spendRows>>;

  it('tenant B pulls its own spend first', async () => {
    await runJob(b);
    expect(await prismaBase.metaSpendDay.count({ where: { adAccountId: accountB } })).toBe(1);
    expect(await prismaBase.expense.count({ where: { tenantId: b } })).toBe(1);
  });

  it('tenant A: the job writes MetaSpendDay and one expense per (account, day); 5080 equals the converted spend', async () => {
    await runJob(a);
    rowsFirst = await spendRows();
    expect(rowsFirst.map((r) => [r.campaignId, r.date.toISOString().slice(0, 10), r.spend])).toEqual([
      ['6001', '2026-11-09', '43700.55'], ['6001', '2026-11-10', '51000'], ['6002', '2026-11-09', '0.1'],
    ]);
    const exps = await prismaBase.expense.findMany({ where: { tenantId: a }, orderBy: { expenseDate: 'asc' } });
    expect(exps.map((e) => [e.expenseDate.toISOString().slice(0, 10), e.amount.toFixed(2), e.source, e.metaAdAccountId]))
      .toEqual([['2026-11-09', '390.18', 'meta', accountA], ['2026-11-10', '455.36', 'meta', accountA]]);
    afterFirst = await ledger();
    expect(afterFirst.b5080).toBe('845.54'); // 94,700.65 NGN at 112
    expect(afterFirst.b1010).toBe('-845.54');
    expect(afterFirst.entries).toBe(2);
  });

  it('GET /summary spend equals the 5080 total; /campaigns/performance lists the fixture campaigns with spend', async () => {
    const s = await get('marketing/summary', ownerA.token);
    expect(s.status).toBe(200);
    expect(s.body.spend).toMatchObject({ store: '845.54', account: '94700.65', accountCurrency: 'NGN' });
    expect(s.body.spend.store).toBe(afterFirst.b5080);
    const p = await get('marketing/campaigns/performance', ownerA.token);
    expect(p.status).toBe(200);
    const byName = Object.fromEntries(p.body.campaigns.map((c: any) => [c.campaignName, c]));
    expect(Object.keys(byName).sort()).toEqual(['MG_Oct_Mom_POV', 'MG_Oct_Teacher_UGC']);
    expect(byName.MG_Oct_Teacher_UGC.spend).toMatchObject({ store: '845.54', account: '94700.55' });
    expect(byName.MG_Oct_Mom_POV.spend.account).toBe('0.10');
    expect(p.body.totals.spend.store).toBe('845.54');
  });

  it('running the job again changes no row, expense, entry or balance', async () => {
    await runJob(a);
    expect((await spendRows())).toEqual(rowsFirst);
    expect(await ledger()).toEqual(afterFirst);
  });

  it('one day changes in Meta: exactly one new entry with the difference', async () => {
    day10Spend = '61000.00'; // 61,000 / 112 = 544.64; was 455.36
    await runJob(a);
    const now = await ledger();
    expect(now.entries).toBe(afterFirst.entries + 1);
    expect(now.expenses).toHaveLength(2);
    expect(now.b5080).toBe((845.54 + 89.28).toFixed(2));
    expect(now.b1010).toBe((-(845.54 + 89.28)).toFixed(2));
    const s = await get('marketing/summary', ownerA.token);
    expect(s.body.spend.store).toBe(now.b5080);
  });

  it('tenant B data never appears in any tenant A response', async () => {
    const paths = ['marketing/summary', 'marketing/funnel', 'marketing/campaigns/performance', 'marketing/campaigns/unmapped', 'marketing/campaigns', 'meta-ads/accounts'];
    for (const path of paths) {
      const res = await get(path, ownerA.token);
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const s of B_STRINGS) expect({ path, hit: text.includes(s) ? s : null }).toEqual({ path, hit: null });
    }
    // Control: B does see its own data
    const own = await get('marketing/campaigns/performance', ownerB.token);
    expect(own.body.campaigns.map((c: any) => c.campaignName)).toEqual(['MG_tenantB_secret']);
  });
});
