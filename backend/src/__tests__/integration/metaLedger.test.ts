/**
 * M8-T07 (COD-72): Meta spend to the ledger with FX. One expense per (account, day), DR 5080 / CR 1010, only the
 * difference on a re-pull, fx_missing Finding while the rate is missing, Meta expenses locked in the API.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { postMetaSpend } from '../../services/marketing/metaLedgerService';
import { utcDateOfYmd } from '../../services/kpi/dates';

const tenantIds: string[] = [];
let tenantId: string;
let otherTenantId: string;
let ownerToken: string;
let ngn: number; // NGN account of tenant A
let ghs: number; // GHS account of tenant A
let other: number; // account of tenant B

const D1 = '2026-11-10';
const D2 = '2026-11-09';
const run = (accountId: number, dates: string[], tid = tenantId) => runInTenant(tid, () => postMetaSpend(accountId, dates));
const balance = async (code: string, tid = tenantId) =>
  (await prismaBase.account.findFirstOrThrow({ where: { tenantId: tid, code } })).currentBalance.toFixed(2);
const entryCount = (tid = tenantId) => prismaBase.journalEntry.count({ where: { tenantId: tid, sourceType: 'expense' } });
const expensesOf = (accountId: number) => prismaBase.expense.findMany({ where: { metaAdAccountId: accountId }, orderBy: { expenseDate: 'asc' } });
const setSpend = async (accountId: number, tid: string, ymd: string, spend: number, campaign = 'c1', currency = 'NGN') => {
  await prismaBase.metaSpendDay.upsert({
    where: { adAccountId_campaignId_date: { adAccountId: accountId, campaignId: campaign, date: utcDateOfYmd(ymd) } },
    create: { adAccountId: accountId, campaignId: campaign, campaignName: campaign, date: utcDateOfYmd(ymd), currency, spend, pulledAt: new Date(), tenantId: tid },
    update: { spend },
  });
};
const mkAccount = (tid: string, currency: string, accountId: string) => prismaBase.metaAdAccount.create({
  data: { accountId, name: `Acct ${accountId}`, currency, timezone: 'UTC', accessToken: 'x', tenantId: tid },
}).then((a) => a.id);
const mkRate = (tid: string, rate: string) => prismaBase.fxRate.create({
  data: { tenantId: tid, fromCurrency: 'NGN', toCurrency: 'GHS', rate, date: utcDateOfYmd('2026-11-01'), source: 'manual' },
});
const fxFindings = (status?: 'open' | 'closed') => prismaBase.finding.findMany({ where: { tenantId, type: 'fx_missing', ...(status ? { status } : {}) } });

beforeAll(async () => {
  tenantId = (await createTenant('Meta ledger', { currency: 'GHS' })).id;
  otherTenantId = (await createTenant('Meta ledger b', { currency: 'GHS' })).id;
  tenantIds.push(tenantId, otherTenantId);
  await Promise.all([seedTenantDefaults(tenantId), seedTenantDefaults(otherTenantId)]);
  ownerToken = (await mkUser(tenantId, 'owner', 'super_admin')).token;
  ngn = await mkAccount(tenantId, 'NGN', 'act_1');
  ghs = await mkAccount(tenantId, 'GHS', 'act_2');
  other = await mkAccount(otherTenantId, 'NGN', 'act_3');
});

afterAll(async () => {
  await prismaBase.expense.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('missing rate', () => {
  it('posts nothing, opens one fx_missing, opens no second one, then posts and resolves when the rate arrives', async () => {
    await setSpend(ngn, tenantId, D1, 100000);
    expect(await run(ngn, [D1])).toEqual({ posted: 0, adjusted: 0, unchanged: 0, waitingForRate: 1 });
    expect(await run(ngn, [D1])).toMatchObject({ waitingForRate: 1 });
    expect(await expensesOf(ngn)).toHaveLength(0);
    expect(await entryCount()).toBe(0);
    const open = await fxFindings('open');
    expect(open).toHaveLength(1);
    expect(open[0].note).toBe(`No NGN to GHS rate for ${D1}. Meta spend for that day is not in the ledger yet. Add the rate in Settings, FX.`);

    await mkRate(tenantId, '0.0089');
    expect(await run(ngn, [D1])).toEqual({ posted: 1, adjusted: 0, unchanged: 0, waitingForRate: 0 });
    expect(await fxFindings('open')).toHaveLength(0);
    expect(await fxFindings('closed')).toHaveLength(1);
  });
});

describe('posting', () => {
  it('the first post made one expense with one entry DR 5080 / CR 1010 at the day rate', async () => {
    const [exp] = await expensesOf(ngn);
    expect(exp).toMatchObject({ source: 'meta', category: 'Marketing', description: 'Meta ads: Acct act_1', originalCurrency: 'NGN' });
    expect(exp.amount.toFixed(2)).toBe('890.00');
    expect(exp.originalAmount?.toFixed(2)).toBe('100000.00');
    expect(exp.fxRate?.toFixed(4)).toBe('0.0089');
    expect(exp.expenseDate.toISOString()).toBe(`${D1}T00:00:00.000Z`);
    const lines = await prismaBase.accountTransaction.findMany({ where: { journalEntryId: exp.journalEntryId as number }, include: { account: true } });
    expect(lines.map((l) => [l.account.code, l.debitAmount.toFixed(2), l.creditAmount.toFixed(2)]).sort())
      .toEqual([['1010', '0.00', '890.00'], ['5080', '890.00', '0.00']]);
    expect(await entryCount()).toBe(1);
  });

  it('a re-run changes nothing', async () => {
    const before = [await entryCount(), await balance('5080'), await balance('1010')];
    expect(await run(ngn, [D1])).toEqual({ posted: 0, adjusted: 0, unchanged: 1, waitingForRate: 0 });
    expect([await entryCount(), await balance('5080'), await balance('1010')]).toEqual(before);
  });

  it('spend raised by 10,000 posts exactly GHS 89.00; lowered posts the reverse', async () => {
    await setSpend(ngn, tenantId, D1, 10000, 'c2');
    expect(await run(ngn, [D1])).toMatchObject({ adjusted: 1 });
    expect(await balance('5080')).toBe('979.00');
    expect(await entryCount()).toBe(2);
    await setSpend(ngn, tenantId, D1, 0, 'c2');
    expect(await run(ngn, [D1])).toMatchObject({ adjusted: 1 });
    expect(await balance('5080')).toBe('890.00');
    expect(await balance('1010')).toBe('-890.00');
    expect(await entryCount()).toBe(3);
    const [exp] = await expensesOf(ngn);
    expect(exp.amount.toFixed(2)).toBe('890.00');
    expect(await expensesOf(ngn)).toHaveLength(1);
  });

  it('a same-currency account uses rate 1', async () => {
    await setSpend(ghs, tenantId, D2, 55.5, 'c1', 'GHS');
    expect(await run(ghs, [D2])).toMatchObject({ posted: 1 });
    const [exp] = await expensesOf(ghs);
    expect(exp.amount.toFixed(2)).toBe('55.50');
    expect(exp.fxRate?.toFixed(2)).toBe('1.00');
  });

  it('the 5080 total equals the converted sum of MetaSpendDay after a mix of changes', async () => {
    await setSpend(ngn, tenantId, D2, 40000);
    await setSpend(ngn, tenantId, D1, 120000, 'c3');
    await run(ngn, [D1, D2]);
    await setSpend(ngn, tenantId, D2, 25000);
    await setSpend(ngn, tenantId, D1, 20000, 'c3');
    await run(ngn, [D1, D2]);
    const days = await prismaBase.metaSpendDay.aggregate({ where: { adAccountId: ngn }, _sum: { spend: true } });
    // Per day: D1 = 100,000 + 20,000 -> 1,068.00; D2 = 25,000 -> 222.50; the GHS account adds 55.50.
    expect(days._sum.spend?.toFixed(2)).toBe('145000.00');
    expect(await balance('5080')).toBe((1068 + 222.5 + 55.5).toFixed(2));
  });
});

describe('tenants and locking', () => {
  it('tenant B posts its own spend and never touches tenant A expenses', async () => {
    const before = await expensesOf(ngn);
    await mkRate(otherTenantId, '0.01');
    await setSpend(other, otherTenantId, D1, 5000);
    expect(await run(other, [D1], otherTenantId)).toMatchObject({ posted: 1 });
    expect(await balance('5080', otherTenantId)).toBe('50.00');
    expect(await expensesOf(ngn)).toEqual(before);
    // Tenant A cannot reach tenant B's account.
    await expect(run(other, [D1])).rejects.toThrow('Ad account not found');
  });

  it('updating or deleting a Meta expense through the API gives 409', async () => {
    const [exp] = await expensesOf(ngn);
    const put = await request(app).put(`/api/financial/expenses/${exp.id}`).set(bearer(ownerToken)).send({ amount: 1 });
    expect(put.status).toBe(409);
    expect(put.body.message ?? put.body.error).toContain('Meta ad spend is posted by CodAdmin. Change it in Meta.');
    expect((await request(app).delete(`/api/financial/expenses/${exp.id}`).set(bearer(ownerToken))).status).toBe(409);
    expect(await prismaBase.expense.findUnique({ where: { id: exp.id } })).not.toBeNull();
  });
});
