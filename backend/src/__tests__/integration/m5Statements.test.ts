/**
 * M5-T25 (COD-52, F-922, F-923): monthly P&L (Aug and Sep as booked, with the note), income statement and balance sheet with
 * 3010 and "Result to date". Two tenants; empty periods give zeros, never NaN.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import glService from '../../services/glService';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';

jest.setTimeout(120_000);

let a: string;
let b: string;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let agentA: { id: number; token: string };
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

/** One balanced manual entry: [code, debit, credit][]. */
async function post(tenantId: string, who: number, date: string, lines: Array<[string, number, number]>) {
  const accounts = await prismaBase.account.findMany({ where: { tenantId, code: { in: lines.map((l) => l[0]) } } });
  const id = (code: string) => accounts.find((x) => x.code === code)!.id;
  await runInTenant(tenantId, () => glService.createJournalEntry({
    entryDate: `${date}T12:00:00.000Z`, description: `test ${date}`, sourceType: 'manual',
    transactions: lines.map(([code, d, c]) => ({ accountId: id(code), debitAmount: d, creditAmount: c })),
  }, { id: who, role: 'super_admin' }));
}

beforeAll(async () => {
  a = (await createTenant('Statements A')).id;
  b = (await createTenant('Statements B')).id;
  await Promise.all([seedTenantDefaults(a), seedTenantDefaults(b)]);
  [ownerA, ownerB, agentA] = await Promise.all([mkUser(a, 'ownerA', 'super_admin'), mkUser(b, 'ownerB', 'super_admin'), mkUser(a, 'agentA', 'delivery_agent')]);

  await post(a, ownerA.id, '2026-07-01', [['1010', 5000, 0], ['3010', 0, 5000]]); // opening equity
  // August: booked the old way, no 5050 line
  await post(a, ownerA.id, '2026-08-10', [['1015', 1000, 0], ['4010', 0, 1000]]);
  await post(a, ownerA.id, '2026-08-10', [['5010', 300, 0], ['1200', 0, 300]]);
  await post(a, ownerA.id, '2026-08-12', [['5100', 100, 0], ['1010', 0, 100]]);
  // September
  await post(a, ownerA.id, '2026-09-10', [['1015', 2000, 0], ['4010', 0, 2000]]);
  await post(a, ownerA.id, '2026-09-10', [['5010', 600, 0], ['1200', 0, 600]]);
  await post(a, ownerA.id, '2026-09-10', [['5070', 200, 0], ['1015', 0, 200]]);
  await post(a, ownerA.id, '2026-09-25', [['5100', 50, 0], ['1010', 0, 50]]); // after day 17: not in "same days last month"
  // October 1-17 (the plan's October commission and reward)
  await post(a, ownerA.id, '2026-10-05', [['1015', 3000, 0], ['4010', 0, 3000]]);
  await post(a, ownerA.id, '2026-10-05', [['5010', 900, 0], ['1200', 0, 900]]);
  await post(a, ownerA.id, '2026-10-05', [['5070', 400, 0], ['1015', 0, 400]]);
  await post(a, ownerA.id, '2026-10-06', [['5050', 2128, 0], ['2020', 0, 2128]]);
  await post(a, ownerA.id, '2026-10-07', [['5050', 640, 0], ['2020', 0, 640]]);
  await post(a, ownerA.id, '2026-10-08', [['5080', 1000, 0], ['1010', 0, 1000]]);
  await post(a, ownerA.id, '2026-10-20', [['5100', 77, 0], ['1010', 0, 77]]); // after asOf
  // Tenant B: its own October revenue that must never reach A
  await post(b, ownerB.id, '2026-10-03', [['1010', 999, 0], ['4010', 0, 999]]);
});

afterAll(async () => {
  await deleteTenantRows([a, b]);
  await prismaBase.$disconnect();
});

const pl = (who: { token: string }, q = 'asOf=2026-10-17') => request(app).get(`/api/financial/monthly-pl?${q}`).set(auth(who));

describe('GET /api/financial/monthly-pl', () => {
  it('returns Aug, Sep, same days last month and to-date', async () => {
    const res = await pl(ownerA);
    expect(res.status).toBe(200);
    expect(res.body.columns.map((c: any) => c.label)).toEqual(['Aug', 'Sep', '1-17 Sep', '1-17 Oct']);
    expect(res.body.targetNetMargin).toBe(35);
  });

  it('Aug and Sep equal the booked ledger and carry the note; commission is "not split out"', async () => {
    const [aug, sep] = (await pl(ownerA)).body.columns;
    expect(aug.revenue).toBe('1000.00');
    expect(aug.productCost).toBe('300.00');
    expect(aug.otherExpenses).toBe('100.00');
    expect(aug.netProfit).toBe('600.00');
    expect(aug.netMarginPct).toBe(60);
    expect(aug.note).toBe('Booked with the older cost per set. Not restated.');
    expect(aug.repCommission).toBeNull();
    expect(aug.repCommissionNote).toBe('not split out');
    expect(sep.note).toBe('Booked with the older cost per set. Not restated.');
    expect(sep.deliveryFees).toBe('200.00');
    expect(sep.netProfit).toBe('1150.00'); // 2000 - 600 - 200 - 50
  });

  it('same days last month stops at day 17; to-date has fees as one line and commission as its own line', async () => {
    const [, , same, to] = (await pl(ownerA)).body.columns;
    expect(same.revenue).toBe('2000.00');
    expect(same.otherExpenses).toBe('0.00'); // the 25 Sep expense is outside 1-17
    expect(same.note).toBeNull();
    expect(to.revenue).toBe('3000.00');
    expect(to.deliveryFees).toBe('400.00');
    expect(to.repCommission).toBe('2768.00');
    expect(to.metaSpend).toBe('1000.00');
    expect(to.otherExpenses).toBe('0.00'); // the 20 Oct expense is after asOf
    expect(to.netProfit).toBe('-2068.00'); // 3000 - 900 - 400 - 2768 - 1000
    expect(to.netMarginPct).toBe(-68.9);
  });

  it('the owner can edit the note (periodNotes)', async () => {
    await prismaBase.systemConfig.create({ data: { tenantId: a, periodNotes: { '2026-08': 'Edited note' } } });
    const [aug, sep] = (await pl(ownerA)).body.columns;
    expect(aug.note).toBe('Edited note');
    expect(sep.note).toBe('Booked with the older cost per set. Not restated.');
  });

  it('months before the first entry have no column; a tenant with no entries gets zeros and null margins', async () => {
    const res = await pl(ownerA, 'asOf=2026-10-17&months=6');
    expect(res.body.columns.map((c: any) => c.key)).toEqual(['2026-07', '2026-08', '2026-09', 'same-days-last-month', 'to-date']);
    const empty = await pl(ownerA, 'asOf=2020-03-10');
    for (const c of empty.body.columns) {
      expect(c.revenue).toBe('0.00');
      expect(c.netProfit).toBe('0.00');
      expect(c.netMarginPct).toBeNull();
      expect(c.hasData).toBe(false);
    }
    expect(JSON.stringify(empty.body)).not.toMatch(/NaN|null.*Infinity/);
  });

  it('never shows tenant B data to tenant A, and B sees only its own', async () => {
    const mine = await pl(ownerA);
    expect(JSON.stringify(mine.body)).not.toContain('999.00');
    const theirs = (await pl(ownerB)).body.columns;
    expect(theirs.map((c: any) => c.label)).toEqual(['1-17 Sep', '1-17 Oct']); // no month column before B's first entry
    expect(theirs[1].revenue).toBe('999.00');
  });

  it('rejects a bad parameter and a role without financial view', async () => {
    expect((await pl(ownerA, 'months=0')).status).toBe(400);
    expect((await pl(ownerA, 'asOf=17-10-2026')).status).toBe(400);
    expect((await pl(agentA)).status).toBe(403);
  });
});

describe('statements on /profit-loss and /balance-sheet', () => {
  it('income statement lines for 1-17 Oct', async () => {
    const res = await request(app).get('/api/financial/profit-loss?startDate=2026-10-01&endDate=2026-10-17').set(auth(ownerA));
    expect(res.status).toBe(200);
    expect(res.body.statement).toMatchObject({
      revenue: '3000.00', productCost: '900.00', grossProfit: '2100.00', grossMarginPct: 70,
      deliveryFees: '400.00', repCommission: '2768.00', metaSpend: '1000.00', paystackFees: '0.00', otherExpenses: '0.00',
      netProfit: '-2068.00',
    });
    expect(res.body.netIncome).toBeDefined(); // old fields stay
  });

  it('balance sheet balances with 3010 and Result to date', async () => {
    const res = await request(app).get('/api/financial/balance-sheet?asOfDate=2026-10-17').set(auth(ownerA));
    const s = res.body.statement;
    expect(s.equity.ownersEquity).toBe('5000.00');
    expect(s.equity.resultToDate).toBe('-318.00'); // 6000 - 400 - 850 - 5068
    expect(s.isBalanced).toBe(true);
    expect(s.outOfBalanceBy).toBeNull();
    expect(s.assets.total).toBe(s.totalLiabilitiesAndEquity);
    expect(s.assets.lines.map((l: any) => l.code).slice(0, 4)).toEqual(['1010', '1015', '1030', '1200']);
    expect(s.liabilities.lines.find((l: any) => l.code === '2020').amount).toBe('2768.00');
  });

  it('a date with no entries returns zeros', async () => {
    const res = await request(app).get('/api/financial/balance-sheet?asOfDate=2020-01-01').set(auth(ownerA));
    const s = res.body.statement;
    expect(s.assets.total).toBe('0.00');
    expect(s.equity.total).toBe('0.00');
    expect(s.equity.hint).not.toBeNull();
    expect(s.isBalanced).toBe(true);
    const is = await request(app).get('/api/financial/profit-loss?startDate=2020-01-01&endDate=2020-01-31').set(auth(ownerA));
    expect(is.body.statement.revenue).toBe('0.00');
    expect(is.body.statement.netMarginPct).toBeNull();
  });
});
