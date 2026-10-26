/**
 * M5-T29 (COD-52): manual journal permission (owner and finance clerk post and void), inactive-account block,
 * ledger browse, the four exports (CSV and Excel, headers only on an empty range), a ledger over the line limit
 * as a background job, and the finance health check with its job fallback.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';

const tenantIds: string[] = [];
let tenantId: string;
let owner: { id: number; token: string };
let clerk: { id: number; token: string };
let admin: { id: number; token: string };
let rep: { id: number; token: string };
const ids: Record<string, number> = {};

const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
const today = () => new Date().toISOString().slice(0, 10);
const entry = (debit: string, credit: string, amount: number | string, over: Record<string, unknown> = {}) => ({
  entryDate: today(), description: 'Owner top-up', sourceType: 'manual',
  transactions: [
    { accountId: ids[debit], debitAmount: amount, creditAmount: 0 },
    { accountId: ids[credit], debitAmount: 0, creditAmount: amount },
  ], ...over,
});
const post = (body: unknown, who = owner) => request(app).post('/api/gl/journal-entries').set(auth(who)).send(body as object);
const get = (url: string, who = owner) => request(app).get(url).set(auth(who));
const csvOf = (res: request.Response) => (res.text ?? res.body.toString()).replace(/^﻿/, '').trim().split(/\r?\n/);
const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const poll = async (url: string, who = owner) => {
  for (let i = 0; i < 100; i++) {
    const res = await get(url, who);
    if (res.body.status === 'done' || res.body.status === 'failed') return res;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('job did not finish');
};

beforeAll(async () => {
  tenantId = (await createTenant('Journal exports')).id;
  tenantIds.push(tenantId);
  await seedTenantDefaults(tenantId);
  for (const a of await prismaBase.account.findMany({ where: { tenantId } })) ids[a.code] = a.id;
  [owner, clerk, admin, rep] = await Promise.all([
    mkUser(tenantId, 'owner', 'super_admin'), mkUser(tenantId, 'clerk', 'accountant'),
    mkUser(tenantId, 'admin', 'admin'), mkUser(tenantId, 'rep', 'sales_rep'),
  ]);
});

afterAll(async () => {
  delete process.env.LEDGER_EXPORT_JOB_LINES;
  delete process.env.FINANCE_HEALTH_INLINE_MS;
  await prismaBase.expense.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('manual journal permission', () => {
  it('owner and finance clerk post and void; admin and sales rep are refused', async () => {
    const byOwner = await post(entry('1010', '3010', 500));
    expect(byOwner.status).toBe(201);
    const byClerk = await post(entry('1010', '3010', 250));
    expect(byClerk.status).toBe(201);
    expect((await post(entry('1010', '3010', 1), admin)).status).toBe(403);
    expect((await post(entry('1010', '3010', 1), rep)).status).toBe(403);

    const voidBody = { voidReason: 'Posted twice' };
    const voidByClerk = await request(app).post(`/api/gl/journal-entries/${byOwner.body.entry.id}/void`).set(auth(clerk)).send(voidBody);
    expect(voidByClerk.status).toBe(200);
    expect(voidByClerk.body.entry.isVoided).toBe(true);
    expect((await request(app).post(`/api/gl/journal-entries/${byClerk.body.entry.id}/void`).set(auth(admin)).send(voidBody)).status).toBe(403);
    expect((await request(app).post(`/api/gl/journal-entries/${byClerk.body.entry.id}/void`).set(auth(owner)).send(voidBody)).status).toBe(200);
  });

  it('a hand-made entry is always source manual, whatever the body says', async () => {
    const res = await post(entry('1010', '3010', 5, { sourceType: 'expense', sourceId: 99999 }), clerk);
    expect(res.status).toBe(201);
    expect(res.body.entry.sourceType).toBe('manual');
    expect(res.body.entry.sourceId).toBeNull();
  });

  it('is blocked on the inactive account 1020, and for an unbalanced entry', async () => {
    const res = await post(entry('1020', '3010', 10), clerk);
    expect(res.status).toBe(400);
    expect(res.body.message ?? res.body.error).toMatch(/1020.*inactive/);
    expect(await prismaBase.accountTransaction.count({ where: { tenantId, accountId: ids['1020'] } })).toBe(0);
    const unbalanced = entry('1010', '3010', 10);
    unbalanced.transactions[1].creditAmount = 9 as never;
    expect((await post(unbalanced)).status).toBe(400);
  });
});

describe('POST /api/gl/journal-entries without a source type', () => {
  it('posts as manual when the screen sends no sourceType', async () => {
    const body = entry('1010', '3010', 4);
    delete (body as Record<string, unknown>).sourceType;
    const res = await post(body, clerk);
    expect(res.status).toBe(201);
    expect(res.body.entry.sourceType).toBe('manual');
  });
});

describe('the void route reverses hand-made entries only', () => {
  it('the clerk and the owner both get 400 on an expense entry, and it stays posted', async () => {
    const exp = await request(app).post('/api/financial/expenses').set(auth(owner))
      .send({ category: 'Transport', amount: 33, description: 'Taxi', expenseDate: today(), paidFrom: 'cash' });
    const row = await prismaBase.expense.findUniqueOrThrow({ where: { id: exp.body.expense.id } });
    for (const who of [clerk, owner]) {
      const res = await request(app).post(`/api/gl/journal-entries/${row.journalEntryId}/void`).set(auth(who)).send({ voidReason: 'Trying' });
      expect(res.status).toBe(400);
      expect(res.body.message ?? res.body.error).toBe('This entry was posted by an expense. Edit or delete the expense instead.');
    }
    const after = await prismaBase.journalEntry.findUniqueOrThrow({ where: { id: row.journalEntryId! } });
    expect(after.isVoided).toBe(false);
    // Deleting the expense is the way to undo it
    expect((await request(app).delete(`/api/financial/expenses/${row.id}`).set(auth(clerk))).status).toBe(200);
  });

  it.each(['commission_accrual', 'delivery_fee'] as const)('a %s entry is refused, and the ledger line says it is not voidable by hand', async (sourceType) => {
    const je = await prismaBase.journalEntry.create({
      data: { tenantId, entryNumber: `JE-AUTO-${sourceType}`, entryDate: new Date(), description: 'auto', sourceType, createdBy: owner.id },
    });
    await prismaBase.accountTransaction.createMany({ data: [
      { tenantId, journalEntryId: je.id, accountId: ids['5100'], debitAmount: 1, creditAmount: 0, runningBalance: 0 },
      { tenantId, journalEntryId: je.id, accountId: ids['3010'], debitAmount: 0, creditAmount: 1, runningBalance: 0 },
    ] });
    const res = await request(app).post(`/api/gl/journal-entries/${je.id}/void`).set(auth(owner)).send({ voidReason: 'Trying' });
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.errorCode).toBe('GL_ENTRY_NOT_MANUAL');
    expect((await prismaBase.journalEntry.findUniqueOrThrow({ where: { id: je.id } })).isVoided).toBe(false);
    const ledger = await get(`/api/gl/accounts/${ids['5100']}/ledger?limit=100`);
    expect(ledger.body.transactions.find((t: any) => t.journalEntry.id === je.id).journalEntry.voidableByHand).toBe(false);
    // The lines were written without moving the account balances: remove them so later tests see a clean ledger
    await prismaBase.accountTransaction.deleteMany({ where: { journalEntryId: je.id } });
    await prismaBase.journalEntry.delete({ where: { id: je.id } });
  });

  it('a reversal entry cannot be voided either', async () => {
    const made = await post(entry('1010', '3010', 9), clerk);
    const voided = await request(app).post(`/api/gl/journal-entries/${made.body.entry.id}/void`).set(auth(clerk)).send({ voidReason: 'Oops' });
    const reversal = await prismaBase.journalEntry.findUniqueOrThrow({ where: { id: voided.body.entry.reversingEntryId } });
    const res = await request(app).post(`/api/gl/journal-entries/${reversal.id}/void`).set(auth(owner)).send({ voidReason: 'Again' });
    expect(res.status).toBe(400);
  });
});

describe('journal entry reads carry voidableByHand', () => {
  it('the list and the single entry say whether an entry may be voided by hand', async () => {
    const made = await post(entry('1010', '3010', 3), clerk);
    const one = await get(`/api/gl/journal-entries/${made.body.entry.id}`);
    expect(one.body.entry.voidableByHand).toBe(true);
    const list = await get('/api/gl/journal-entries?limit=100');
    expect(list.body.entries.length).toBeGreaterThan(0);
    for (const e of list.body.entries) expect(e.voidableByHand).toBe(e.sourceType === 'manual' || e.sourceType === 'paystack_payout');
  });
});

describe('ledger browse', () => {
  it('searches the chart by code or name, marks 1020 inactive and shows the trial balance', async () => {
    const byCode = await get('/api/gl/accounts?search=1020');
    expect(byCode.body.accounts.map((a: any) => a.code)).toEqual(['1020']);
    expect(byCode.body.accounts[0].isActive).toBe(false);
    const byName = await get('/api/gl/accounts?search=cash at bank');
    expect(byName.body.accounts.map((a: any) => a.code)).toEqual(['1010']);
    const tb = await get('/api/gl/trial-balance');
    expect(tb.status).toBe(200);
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.totalDebits).toBe(tb.body.totalCredits);
    expect(Number(tb.body.totalDebits)).toBeGreaterThan(0);
  });

  it('the newest ledger line shows the account balance, and the account says whether it is active', async () => {
    const res = await get(`/api/gl/accounts/${ids['1010']}/ledger?limit=20`);
    expect(res.status).toBe(200);
    expect(res.body.account.isActive).toBe(true);
    expect(Number(res.body.transactions[0].runningBalance)).toBe(Number(res.body.account.currentBalance));
    expect((await get(`/api/gl/accounts/${ids['1020']}/ledger`)).body.account.isActive).toBe(false);
    // Each line says whether its entry may be voided here, so the screen keeps no list of its own
    const bySource = Object.fromEntries(res.body.transactions.map((t: any) => [t.journalEntry.sourceType, t.journalEntry.voidableByHand]));
    expect(bySource.manual).toBe(true);
    if ('expense' in bySource) expect(bySource.expense).toBe(false);
    expect(bySource.reversal === undefined || bySource.reversal === false).toBe(true);
  });
});

describe('ledger order and running balance with back-dated entries', () => {
  let t: string;
  let who: { id: number; token: string };
  const acc: Record<string, number> = {};

  beforeAll(async () => {
    t = (await createTenant('Ledger order')).id;
    tenantIds.push(t);
    await seedTenantDefaults(t);
    for (const a of await prismaBase.account.findMany({ where: { tenantId: t } })) acc[a.code] = a.id;
    who = await mkUser(t, 'ledgerowner', 'super_admin');
    // Posted in this order, dated out of order: Oct 15 +100, Oct 1 +1000, Oct 25 -50 (cash out), Oct 3 +20
    const dated = (entryDate: string, dr: string, cr: string, amount: number) => request(app).post('/api/gl/journal-entries').set(auth(who))
      .send({ entryDate, description: `Entry ${entryDate}`, transactions: [{ accountId: acc[dr], debitAmount: amount, creditAmount: 0 }, { accountId: acc[cr], debitAmount: 0, creditAmount: amount }] });
    for (const [d, dr, cr, n] of [['2026-10-15', '1010', '3010', 100], ['2026-10-01', '1010', '3010', 1000], ['2026-10-25', '5100', '1010', 50], ['2026-10-03', '1010', '3010', 20]] as const) {
      expect((await dated(d, dr, cr, n)).status).toBe(201);
    }
  });

  it('lists the lines by entry date, newest first, with the balance after each line in date order', async () => {
    const res = await get(`/api/gl/accounts/${acc['1010']}/ledger?limit=20`, who);
    const rows = res.body.transactions.map((r: any) => [r.journalEntry.entryDate.slice(0, 10), Number(r.runningBalance)]);
    // chronological: Oct 1 1000, Oct 3 1020, Oct 15 1120, Oct 25 1070
    expect(rows).toEqual([['2026-10-25', 1070], ['2026-10-15', 1120], ['2026-10-03', 1020], ['2026-10-01', 1000]]);
    expect(Number(res.body.account.currentBalance)).toBe(1070);
  });

  it('page 2 starts from the right balance, and a date filter keeps the balance of the whole ledger', async () => {
    const page2 = await get(`/api/gl/accounts/${acc['1010']}/ledger?limit=2&page=2`, who);
    expect(page2.body.transactions.map((r: any) => Number(r.runningBalance))).toEqual([1020, 1000]);
    const filtered = await get(`/api/gl/accounts/${acc['1010']}/ledger?startDate=2026-10-10&endDate=2026-10-20`, who);
    expect(filtered.body.transactions.map((r: any) => Number(r.runningBalance))).toEqual([1120]);
  });

  it('the per-account CSV has the same balances, and the job file has a Balance column oldest first', async () => {
    const csv = csvOf(await get(`/api/gl/accounts/${acc['1010']}/ledger/export`, who));
    expect(csv[0]).toContain('RunningBalance');
    expect(csv.slice(1).map((l) => l.split(',').pop()!.replace(/"/g, ''))).toEqual(['1070.00', '1120.00', '1020.00', '1000.00']);

    process.env.LEDGER_EXPORT_JOB_LINES = '1';
    const job = await get(`/api/financial/export/general-ledger?accountId=${acc['1010']}`, who);
    expect(job.status).toBe(202);
    const done = await poll(`/api/financial/jobs/${job.body.jobId}`, who);
    const file = csvOf(await get(done.body.result.downloadUrl, who));
    expect(file[0].endsWith(',Balance')).toBe(true);
    expect(file.slice(1).map((l) => [l.slice(0, 10), l.split(',').pop()])).toEqual([
      ['2026-10-01', '1000.00'], ['2026-10-03', '1020.00'], ['2026-10-15', '1120.00'], ['2026-10-25', '1070.00'],
    ]);
    delete process.env.LEDGER_EXPORT_JOB_LINES;
  });
});

describe('exports', () => {
  beforeAll(async () => {
    await request(app).post('/api/financial/expenses').set(auth(owner))
      .send({ category: 'Transport', amount: 1234567.5, description: 'Big truck', expenseDate: today(), paidFrom: 'bank' });
  });

  it('profit and loss: a real CSV, 2 decimals, no thousand separator, range in the file name', async () => {
    const res = await get(`/api/financial/profit-loss/export?startDate=${today()}&endDate=${today()}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`profit-and-loss_${today()}_to_${today()}.csv`);
    const lines = csvOf(res);
    expect(lines[0]).toBe('Section,Code,Account,Amount');
    expect(lines).toContain('Expenses,5100,Operating Expenses,1234567.50');
  });

  it('profit and loss as Excel is a real xlsx file', async () => {
    const res = await get(`/api/financial/export/profit-loss?format=xlsx&startDate=${today()}&endDate=${today()}`).buffer(true).parse(binary);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('general ledger lists each line with both sides', async () => {
    const res = await get(`/api/financial/export/general-ledger?startDate=${today()}&endDate=${today()}`);
    const lines = csvOf(res);
    expect(lines[0]).toBe('Date,Entry,Account code,Account,Description,Source,Debit,Credit,Voided');
    expect(lines.some((l) => l.includes('5100') && l.includes('1234567.50'))).toBe(true);
    expect(lines.some((l) => l.includes(',1010,') && l.includes(',expense,') && l.endsWith(',no'))).toBe(true);
  });

  it('cash flow forecast and agent aging are real files', async () => {
    const cash = csvOf(await get('/api/financial/export/cash-flow'));
    expect(cash[0]).toBe('Date,Expected collection,Expected expense,Projected balance');
    expect(cash.length).toBeGreaterThan(1);
    const aging = await get('/api/financial/export/agent-aging');
    expect(aging.status).toBe(200);
    expect(csvOf(aging)[0]).toBe('Agent,Total balance,0-1 days,2-3 days,4-7 days,8+ days,Oldest collection');
  });

  it.each(['profit-loss', 'general-ledger', 'cash-flow'])('%s: an empty range gives the header row only', async (report) => {
    const res = await get(`/api/financial/export/${report}?startDate=2020-01-01&endDate=2020-01-31`);
    expect(res.status).toBe(200);
    expect(csvOf(res)).toHaveLength(1);
  });

  it('an empty range as Excel is a valid file; a bad report or date is a 400; view permission is needed', async () => {
    const x = await get('/api/financial/export/general-ledger?format=xlsx&startDate=2020-01-01&endDate=2020-01-31').buffer(true).parse(binary);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect((await get('/api/financial/export/nope')).status).toBe(400);
    expect((await get('/api/financial/export/general-ledger?startDate=yesterday')).status).toBe(400);
    expect((await get('/api/financial/export/general-ledger', rep)).status).toBe(403);
  });
});

describe('a ledger over the line limit is a background job', () => {
  it('answers 202 with a job id, finishes, downloads the full file, and is closed to another tenant', async () => {
    process.env.LEDGER_EXPORT_JOB_LINES = '3';
    const res = await get('/api/financial/export/general-ledger');
    expect(res.status).toBe(202);
    const { jobId, lines } = res.body;
    expect(jobId).toBeTruthy();
    expect(lines).toBeGreaterThan(3);

    const done = await poll(`/api/financial/jobs/${jobId}`);
    expect(done.body.status).toBe('done');
    expect(done.body.result.rows).toBe(lines);
    const file = await get(done.body.result.downloadUrl);
    expect(file.status).toBe(200);
    expect(csvOf(file)).toHaveLength(lines + 1);

    const other = (await createTenant('Journal other')).id;
    tenantIds.push(other);
    await seedTenantDefaults(other);
    const b = await mkUser(other, 'ownerb', 'super_admin');
    expect((await get(`/api/financial/jobs/${jobId}`, b)).status).toBe(404);
    expect((await get(done.body.result.downloadUrl, b)).status).toBe(404);
    delete process.env.LEDGER_EXPORT_JOB_LINES;
  });

  it('the per-account ledger export uses the same job above the limit', async () => {
    process.env.LEDGER_EXPORT_JOB_LINES = '1';
    const res = await get(`/api/gl/accounts/${ids['1010']}/ledger/export`);
    expect(res.status).toBe(202);
    expect((await poll(`/api/financial/jobs/${res.body.jobId}`)).body.status).toBe('done');
    delete process.env.LEDGER_EXPORT_JOB_LINES;
  });
});

describe('GET /api/financial/health', () => {
  it('lists every rule with its count and reports the planted faults as failures', async () => {
    const clean = await get('/api/financial/health');
    expect(clean.status).toBe(200);
    const rules = clean.body.checks.map((c: any) => c.rule);
    expect(rules).toEqual(expect.arrayContaining(['unbalanced_entries', 'account_balance_mismatch', 'expense_without_entry', 'delivered_without_delivery_date', 'accounts_without_tenant', 'open_ledger_gap_days']));
    expect(clean.body.checks.every((c: any) => typeof c.count === 'number')).toBe(true);
    expect(clean.body.failures.find((f: any) => f.rule === 'expense_without_entry')).toBeUndefined();
    expect(clean.body.balanceIntegrity.isHealthy).toBe(true);

    // Planted faults: a manual expense with no entry, and a one-sided journal entry
    const exp = await prismaBase.expense.create({ data: { tenantId, category: 'Other', amount: 7, description: 'No entry', expenseDate: new Date(), source: 'manual' } });
    const je = await prismaBase.journalEntry.create({ data: { tenantId, entryNumber: 'JE-PLANTED-1', entryDate: new Date(), description: 'one sided', sourceType: 'manual', createdBy: owner.id } });
    await prismaBase.accountTransaction.create({ data: { tenantId, journalEntryId: je.id, accountId: ids['3010'], debitAmount: 0, creditAmount: 40, runningBalance: 40 } });

    const bad = await get('/api/financial/health');
    expect(bad.body.healthy).toBe(false);
    const byRule = Object.fromEntries(bad.body.failures.map((f: any) => [f.rule, f]));
    expect(byRule.expense_without_entry).toMatchObject({ count: 1, sample: [exp.id] });
    expect(byRule.unbalanced_entries).toMatchObject({ count: 1, sample: ['JE-PLANTED-1'] });
    expect(byRule.account_balance_mismatch.count).toBe(1);
  });

  it('a check over the time limit runs as a job and returns a job id', async () => {
    process.env.FINANCE_HEALTH_INLINE_MS = '1';
    const res = await get('/api/financial/health');
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    const done = await poll(`/api/financial/jobs/${res.body.jobId}`);
    expect(done.body.status).toBe('done');
    expect(done.body.result.checks.length).toBeGreaterThan(5);
    delete process.env.FINANCE_HEALTH_INLINE_MS;
  });
});
