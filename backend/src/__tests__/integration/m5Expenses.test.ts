/**
 * M5-T28 (COD-52): expenses. Add posts DR 5100 / CR 1010 dated by the expense date; edit and delete reverse or
 * replace the entry (add, edit, delete nets to 0); negative amounts are rejected; a closed month is allowed with a
 * notice; one category list; PDF receipts in POST /api/upload; system rows are read-only; the category migration.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { migrationStatements } from './helpers/migrationSql';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { EXPENSE_CATEGORIES } from '../../config/expenseCategories';
import { uploadDir } from '../../config/multer';

const tenantIds: string[] = [];
const uploaded: string[] = [];
let tenantId: string;
let owner: { id: number; token: string };
let clerk: { id: number; token: string };
let admin: { id: number; token: string };
let agent: { id: number; token: string };
let rep: { id: number; token: string };

const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
const today = () => new Date().toISOString().slice(0, 10);
const balance = async (code: string) =>
  (await prismaBase.account.findFirstOrThrow({ where: { tenantId, code } })).currentBalance.toFixed(2);
const body = (over: Record<string, unknown> = {}) => ({
  category: 'Transport', amount: 120.5, description: 'Fuel run', expenseDate: today(), paidFrom: 'momo', ...over,
});
const add = (over: Record<string, unknown> = {}, who = owner) =>
  request(app).post('/api/financial/expenses').set(auth(who)).send(body(over));
/** Journal lines of the not-voided entries of one expense, by account code. */
const liveLines = async (expenseId: number) => {
  const lines = await prismaBase.accountTransaction.findMany({
    where: { tenantId, journalEntry: { sourceType: 'expense', sourceId: expenseId, isVoided: false } },
    include: { account: true, journalEntry: true },
  });
  return lines.map((l) => ({ code: l.account.code, dr: l.debitAmount.toFixed(2), cr: l.creditAmount.toFixed(2), date: l.journalEntry.entryDate }));
};

beforeAll(async () => {
  tenantId = (await createTenant('Expenses')).id;
  tenantIds.push(tenantId);
  await seedTenantDefaults(tenantId);
  [owner, clerk, admin, agent, rep] = await Promise.all([
    mkUser(tenantId, 'owner', 'super_admin'),
    mkUser(tenantId, 'clerk', 'accountant'),
    mkUser(tenantId, 'admin', 'admin'),
    mkUser(tenantId, 'agent', 'delivery_agent'),
    mkUser(tenantId, 'rep', 'sales_rep'),
  ]);
});

afterAll(async () => {
  for (const f of uploaded) fs.rmSync(path.join(uploadDir, path.basename(f)), { force: true });
  await prismaBase.expense.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('add expense', () => {
  it('posts DR 5100 and CR 1010 dated by the expense date, and keeps the entry id on the row', async () => {
    const res = await add({ expenseDate: today(), amount: '250.00' });
    expect(res.status).toBe(201);
    expect(res.body.expense.source).toBe('manual');
    expect(res.body.expense.paidFrom).toBe('momo');
    expect(res.body.notice).toBeNull();
    const lines = await liveLines(res.body.expense.id);
    expect(lines.map((l) => [l.code, l.dr, l.cr]).sort()).toEqual([['1010', '0.00', '250.00'], ['5100', '250.00', '0.00']]);
    const row = await prismaBase.expense.findUniqueOrThrow({ where: { id: res.body.expense.id } });
    expect(row.journalEntryId).not.toBeNull();
    expect(lines[0].date.toISOString().slice(0, 10)).toBe(today());
  });

  it.each(['momo', 'bank', 'cash'])('paid from %s credits 1010', async (paidFrom) => {
    const res = await add({ paidFrom, amount: 10 });
    expect(res.status).toBe(201);
    expect((await liveLines(res.body.expense.id)).find((l) => l.cr === '10.00')!.code).toBe('1010');
  });

  it('rejects a negative or zero amount and a paid-from outside the list', async () => {
    expect((await add({ amount: -5 })).status).toBe(400);
    expect((await add({ amount: 0 })).status).toBe(400);
    const bad = await add({ paidFrom: 'crypto' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('EXPENSE_PAID_FROM_INVALID');
  });

  it('allows a date in a closed month and says so', async () => {
    const res = await add({ expenseDate: '2026-08-12', amount: 40 });
    expect(res.status).toBe(201);
    expect(res.body.notice).toBe('This month is closed; the P&L changes');
    expect((await liveLines(res.body.expense.id))[0].date.toISOString().slice(0, 10)).toBe('2026-08-12');
  });
});

describe('categories', () => {
  it('lists one category list with no "Airtime and rewards"', async () => {
    const res = await request(app).get('/api/financial/expense-categories').set(auth(owner));
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([...EXPENSE_CATEGORIES]);
    expect(res.body.categories).not.toContain('Airtime and rewards');
    expect(res.body.paidFrom).toEqual(['momo', 'bank', 'cash']);
    expect(res.body.closedBefore).toBe(today().slice(0, 7) + '-01');
    expect(res.body.closedNotice).toBe('This month is closed; the P&L changes');
    expect(res.body.receipt).toEqual({ maxBytes: 15 * 1024 * 1024, mimeTypes: expect.arrayContaining(['application/pdf', 'image/png']) });
  });

  it('rejects a category outside the list and names the list', async () => {
    const res = await add({ category: 'Airtime and rewards' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EXPENSE_CATEGORY_INVALID');
    expect(res.body.error).toContain('Office and internet');
  });

  it('accepts a list name in any case and stores the list spelling', async () => {
    const res = await add({ category: 'office AND internet', amount: 1 });
    expect(res.status).toBe(201);
    expect(res.body.expense.category).toBe('Office and internet');
  });

  it('the migration maps each old category as the owner approved (PRD F-918) and is safe to run twice', async () => {
    const t = (await createTenant('Expense categories')).id;
    tenantIds.push(t);
    const seeded: Array<[string, string]> = [
      ['COGS', 'Packaging'], ['Delivery', 'Transport'], ['Marketing', 'Marketing'], ['Operations', 'Other'],
      ['Salaries', 'Salaries'], ['Utilities', 'Office and internet'], ['Other', 'Other'],
      [' cogs ', 'Packaging'], ['UTILITIES', 'Office and internet'], ['marketing', 'Marketing'],
      ['Meta ads', 'Other'], ['Delivery fees', 'Other'], ['Other expenses', 'Other'],
      ['Photography', 'Photography'], ['office AND internet', 'Office and internet'],
    ];
    for (const [category] of seeded) {
      await prismaBase.expense.create({ data: { tenantId: t, category, amount: 10, description: category, expenseDate: new Date() } });
    }
    const run = async () => { for (const stmt of migrationStatements('20261026130000_m5_expense_categories')) await prismaBase.$executeRawUnsafe(stmt); };
    const read = async () => (await prismaBase.expense.findMany({ where: { tenantId: t } })).map((r) => [r.description, r.category]);

    await run();
    expect(await read()).toEqual(expect.arrayContaining(seeded.map(([old, mapped]) => [old, mapped])));
    expect((await read()).every(([, c]) => (EXPENSE_CATEGORIES as readonly string[]).includes(c))).toBe(true);
    const first = await read();
    await run();
    expect(await read()).toEqual(first);
  });
});

describe('edit and delete keep the ledger right', () => {
  it('add, edit amount, delete: 5100 and 1010 return to where they were and no live entry is left', async () => {
    const before = [await balance('5100'), await balance('1010')];
    const created = await add({ amount: 300 });
    const id = created.body.expense.id;
    expect([await balance('5100'), await balance('1010')]).not.toEqual(before);

    const edited = await request(app).put(`/api/financial/expenses/${id}`).set(auth(owner)).send({ amount: 450 });
    expect(edited.status).toBe(200);
    expect(edited.body.expense.amount).toBe('450.00');
    const live = await liveLines(id);
    expect(live.map((l) => [l.code, l.dr, l.cr]).sort()).toEqual([['1010', '0.00', '450.00'], ['5100', '450.00', '0.00']]);
    const row = await prismaBase.expense.findUniqueOrThrow({ where: { id } });
    const entry = await prismaBase.journalEntry.findUniqueOrThrow({ where: { id: row.journalEntryId! } });
    expect(entry.isVoided).toBe(false);
    const voided = await prismaBase.journalEntry.findMany({ where: { tenantId, sourceType: { in: ['expense', 'reversal'] }, sourceId: id, isVoided: true } });
    expect(voided).toHaveLength(2); // the old entry and its reversal

    const del = await request(app).delete(`/api/financial/expenses/${id}`).set(auth(owner));
    expect(del.status).toBe(200);
    expect(await liveLines(id)).toEqual([]);
    expect([await balance('5100'), await balance('1010')]).toEqual(before);
    expect(await prismaBase.expense.findUnique({ where: { id } })).toBeNull();
  });

  it('an edit of the date moves the entry date; an edit of the category leaves the entry alone', async () => {
    const created = await add({ amount: 60 });
    const id = created.body.expense.id;
    const first = (await prismaBase.expense.findUniqueOrThrow({ where: { id } })).journalEntryId;

    const cat = await request(app).put(`/api/financial/expenses/${id}`).set(auth(owner)).send({ category: 'Software', paidFrom: 'bank', receiptUrl: '/uploads/receipt-1761500000000-123456789.pdf' });
    expect(cat.status).toBe(200);
    expect(cat.body.expense.category).toBe('Software');
    expect((await prismaBase.expense.findUniqueOrThrow({ where: { id } })).journalEntryId).toBe(first);

    const moved = await request(app).put(`/api/financial/expenses/${id}`).set(auth(owner)).send({ expenseDate: '2026-09-03' });
    expect(moved.body.notice).toBe('This month is closed; the P&L changes');
    const live = await liveLines(id);
    expect(live).toHaveLength(2);
    expect(live[0].date.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect((await prismaBase.expense.findUniqueOrThrow({ where: { id } })).journalEntryId).not.toBe(first);
  });

  it('rejects a negative edit and leaves the ledger as it was', async () => {
    const created = await add({ amount: 15 });
    const id = created.body.expense.id;
    const res = await request(app).put(`/api/financial/expenses/${id}`).set(auth(owner)).send({ amount: -1 });
    expect(res.status).toBe(400);
    expect((await liveLines(id)).find((l) => l.code === '5100')!.dr).toBe('15.00');
  });
});

describe('receiptUrl check (stored XSS guard)', () => {
  const R2 = 'https://img.example-r2.test';
  const prev = process.env.R2_PUBLIC_URL;
  beforeAll(() => { process.env.R2_PUBLIC_URL = R2; });
  afterAll(() => { if (prev === undefined) delete process.env.R2_PUBLIC_URL; else process.env.R2_PUBLIC_URL = prev; });

  it.each([
    '/uploads/receipt-1761500000000-123456789.pdf',
    `${R2}/products/t1/receipt-1761500000000-123456789.png`,
    '',
  ])('accepts %p', async (receiptUrl) => {
    const res = await add({ receiptUrl, amount: 2 });
    expect(res.status).toBe(201);
  });

  it.each(['javascript:alert(1)', 'http://evil.example/x.pdf', 'https://evil.example/x.pdf', '/uploads/../etc/passwd.pdf', `${R2}/a/../b.pdf`, '/uploads/a-1-2.html'])(
    'rejects %p on add and on edit', async (receiptUrl) => {
      const res = await add({ receiptUrl, amount: 2 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('EXPENSE_RECEIPT_INVALID');
      const ok = await add({ amount: 2 });
      const put = await request(app).put(`/api/financial/expenses/${ok.body.expense.id}`).set(auth(owner)).send({ receiptUrl });
      expect(put.status).toBe(400);
    });
});

describe('list total and breakdown agree', () => {
  it('the list totalAmount equals the sum of the breakdown for the same range, and for one category', async () => {
    await add({ category: 'Software', amount: 19.99, description: 'Tool A' });
    await add({ category: 'Software', amount: 0.01, description: 'Tool B' });
    const list = await request(app).get('/api/financial/expenses?limit=5').set(auth(owner));
    const breakdown = await request(app).get('/api/financial/expenses/breakdown').set(auth(owner));
    const sum = breakdown.body.breakdown.reduce((n: number, b: any) => n + Number(b.totalAmount), 0);
    expect(Number(list.body.totalAmount)).toBeCloseTo(sum, 2);
    expect(list.body.pagination.total).toBeGreaterThan(5); // the total covers every page, not the 5 rows shown

    const soft = await request(app).get('/api/financial/expenses?category=Software').set(auth(owner));
    expect(soft.body.totalAmount).toBe(breakdown.body.breakdown.find((b: any) => b.category === 'Software').totalAmount);
  });
});

describe('system rows and permissions', () => {
  it('a Meta or delivery-fee row is locked: listed as locked, edit and delete refused', async () => {
    const row = await prismaBase.expense.create({
      data: { tenantId, category: 'Marketing', amount: 99, description: 'Meta daily spend', expenseDate: new Date(), source: 'meta' },
    });
    const list = await request(app).get('/api/financial/expenses?limit=100').set(auth(owner));
    expect(list.body.expenses.find((e: any) => e.id === row.id).locked).toBe(true);
    expect(list.body.expenses.find((e: any) => e.source === 'manual').locked).toBe(false);
    const put = await request(app).put(`/api/financial/expenses/${row.id}`).set(auth(owner)).send({ amount: 1 });
    expect(put.status).toBe(403);
    expect(put.body.code).toBe('EXPENSE_LOCKED');
    expect((await request(app).delete(`/api/financial/expenses/${row.id}`).set(auth(owner))).status).toBe(403);
    expect(await prismaBase.expense.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it('the finance clerk and admin can edit and delete any row; a delivery agent can add but cannot list, edit or delete', async () => {
    const mine = await add({ amount: 11 }, agent);
    expect(mine.status).toBe(201);
    const others = await add({ amount: 12 }, owner);
    // The agent default holds financial:create only, so the list is closed to them (the own-rows rule is in the service)
    expect((await request(app).get('/api/financial/expenses').set(auth(agent))).status).toBe(403);
    expect((await request(app).put(`/api/financial/expenses/${mine.body.expense.id}`).set(auth(agent)).send({ amount: 13 })).status).toBe(403);
    expect((await request(app).delete(`/api/financial/expenses/${others.body.expense.id}`).set(auth(agent))).status).toBe(403);

    expect((await request(app).put(`/api/financial/expenses/${mine.body.expense.id}`).set(auth(clerk)).send({ amount: 14 })).status).toBe(200);
    expect((await request(app).delete(`/api/financial/expenses/${others.body.expense.id}`).set(auth(admin))).status).toBe(200);
    expect((await request(app).delete(`/api/financial/expenses/${mine.body.expense.id}`).set(auth(clerk))).status).toBe(200);
    expect((await add({}, rep)).status).toBe(403);
  });

  it('search matches the description or the category', async () => {
    await add({ description: 'Zebra stickers', category: 'Packaging', amount: 3 });
    const res = await request(app).get('/api/financial/expenses?search=zebra').set(auth(owner));
    expect(res.body.expenses.map((e: any) => e.description)).toEqual(['Zebra stickers']);
    const byCat = await request(app).get('/api/financial/expenses?search=packag').set(auth(owner));
    expect(byCat.body.expenses.length).toBeGreaterThan(0);
  });

  it("tenant B never sees tenant A's expenses", async () => {
    const other = (await createTenant('Expenses other')).id;
    tenantIds.push(other);
    await seedTenantDefaults(other);
    const b = await mkUser(other, 'ownerb', 'super_admin');
    const res = await request(app).get('/api/financial/expenses?limit=100').set(auth(b));
    expect(res.body.expenses).toEqual([]);
    const a = await add({ amount: 5 });
    expect((await request(app).delete(`/api/financial/expenses/${a.body.expense.id}`).set(auth(b))).status).toBe(404);
  });
});

describe('POST /api/upload accepts a PDF receipt', () => {
  const upload = (buf: Buffer, name: string, type: string) =>
    request(app).post('/api/upload').set(auth(owner)).attach('image', buf, { filename: name, contentType: type });

  it('stores a PDF', async () => {
    const res = await upload(Buffer.from('%PDF-1.4\n%receipt\n'), 'receipt.pdf', 'application/pdf');
    expect(res.status).toBe(200);
    expect(res.body.file.mimetype).toBe('application/pdf');
    uploaded.push(res.body.url);
  });

  it('refuses a file that says PDF but is not one', async () => {
    const res = await upload(Buffer.from('<html>not a pdf</html>'), 'fake.pdf', 'application/pdf');
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toMatch(/not a valid PDF/);
  });

  it('a file over 15 MB gets a message with the limit', async () => {
    const res = await upload(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(15 * 1024 * 1024)]), 'big.pdf', 'application/pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/max 15MB/);
  });

  it('a type that is not an image or PDF names the allowed types', async () => {
    const res = await upload(Buffer.from('x'), 'a.txt', 'text/plain');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/PDF/);
  });
});
