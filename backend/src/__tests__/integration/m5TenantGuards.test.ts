/**
 * M5-T47 (COD-55, F-703, F-909, F-913, F-939): one matrix over every endpoint the M5 finance work added or reshaped.
 *  - Role without the permission: a delivery agent gets 403 on every one.
 *  - Two tenants: tenant B reads no row of tenant A (lists carry none of A's markers) and cannot read or change A's rows by id.
 *  - Replay: the same settlement, manual payout, payout, fee posting and commission posting a second time change nothing.
 *  - Wording: no response the owner reads holds a banned term of wording-allowlist.json.
 * The per-feature suites (feeRules, findingsApi, m5Payouts, partnerPayout*, m5Expenses, ...) keep the detail; this suite is the
 * "every endpoint" net, so a new route that skips the tenant or permission check fails here.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder } from '../../services/orderStateMachine';
import { postEntry as postCommission } from '../../services/commissionService';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import * as fx from './helpers/settlementFixtures';

jest.setTimeout(300_000);

const MARK = 'zq47'; // inside every name, reference and description of tenant A; compared in lower case
const banned: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../wording-allowlist.json'), 'utf8')).banned;
const QS = 'from=2020-01-01&to=2030-12-31&startDate=2020-01-01&endDate=2030-12-31&asOfDate=2026-12-31&asOf=2026-12-31&month=2026-10';

let a: string;
let b: string;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let agentA: { id: number; token: string };
let repA: { id: number; token: string };
let kofiId: number;
let world: fx.SettlementWorld;
const R: Record<string, number> = {};
const seen: string[] = []; // every body the owner of A read, for the wording check

const call = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, who: { token: string }, body?: unknown) => {
  const req = request(app)[method](url).set({ Authorization: `Bearer ${who.token}` });
  return body === undefined ? req : req.send(body as object);
};
const balance = async (code: string) =>
  Number((await prismaBase.account.findUniqueOrThrow({ where: { tenantId_code: { tenantId: a, code } } })).currentBalance);

/** What a replay must leave alone. */
async function signature() {
  const w = { tenantId: a };
  const [settlements, lines, deposits, journal, payouts, entries, findings, feeRules] = await Promise.all([
    prismaBase.partnerSettlement.count({ where: w }), prismaBase.partnerSettlementLine.count({ where: w }),
    prismaBase.agentDeposit.count({ where: w }), prismaBase.journalEntry.count({ where: w }), prismaBase.payout.count({ where: w }),
    prismaBase.commissionEntry.count({ where: { ...w, status: 'paid' } }), prismaBase.finding.count({ where: w }), prismaBase.feeRule.count({ where: w }),
  ]);
  const balances = await Promise.all(['1010', '1015', '2020', '2040', '5070'].map(balance));
  return { settlements, lines, deposits, journal, payouts, entries, findings, feeRules, balances };
}

type Case = { name: string; method: 'get' | 'post' | 'put' | 'patch' | 'delete'; url: () => string; body?: () => unknown; carriesMarker?: boolean; deniedRole?: 'rep' };
const withQs = (p: string) => `${p}${p.includes('?') ? '&' : '?'}${QS}`;
const lists: Case[] = [
  { name: 'findings', method: 'get', url: () => '/api/findings', carriesMarker: true },
  { name: 'payouts', method: 'get', url: () => withQs('/api/payouts') },
  { name: 'payouts owed', method: 'get', url: () => withQs('/api/payouts/owed'), carriesMarker: true },
  { name: 'delivery partners', method: 'get', url: () => '/api/delivery-partners', carriesMarker: true },
  { name: 'expenses', method: 'get', url: () => withQs('/api/financial/expenses'), carriesMarker: true },
  { name: 'expense breakdown', method: 'get', url: () => withQs('/api/financial/expenses/breakdown') },
  { name: 'overview', method: 'get', url: () => withQs('/api/financial/overview') },
  { name: 'monthly P&L', method: 'get', url: () => withQs('/api/financial/monthly-pl') },
  { name: 'income statement', method: 'get', url: () => withQs('/api/financial/profit-loss') },
  { name: 'balance sheet', method: 'get', url: () => withQs('/api/financial/balance-sheet') },
  { name: 'profit by product', method: 'get', url: () => withQs('/api/financial/profit-by-product') },
  { name: 'order cohort', method: 'get', url: () => withQs('/api/financial/cohort-profit') },
  { name: 'cost of failed deliveries', method: 'get', url: () => withQs('/api/financial/failed-delivery-cost') },
  { name: 'agent aging', method: 'get', url: () => withQs('/api/financial/agent-aging') },
  { name: 'unpaid by age', method: 'get', url: () => withQs('/api/financial/unpaid-by-age') },
  { name: 'cash flow', method: 'get', url: () => withQs('/api/financial/cash-flow') },
  { name: 'finance health', method: 'get', url: () => withQs('/api/financial/health') },
  { name: 'ledger journal entries', method: 'get', url: () => withQs('/api/gl/journal-entries'), carriesMarker: true },
  { name: 'trial balance', method: 'get', url: () => withQs('/api/gl/trial-balance') },
  { name: 'deposits', method: 'get', url: () => withQs('/api/agent-reconciliation/deposits'), carriesMarker: true, deniedRole: 'rep' }, // a partner may read its own pay-ins
];
// By id: tenant B hits tenant A's rows.
const byId: Case[] = [
  { name: 'read fee rules', method: 'get', url: () => `/api/delivery-partners/${kofiId}/fee-rules` },
  { name: 'add a fee rule', method: 'post', url: () => `/api/delivery-partners/${kofiId}/fee-rules`, body: () => ({ outcome: 'returned', amount: 1, validFrom: '2026-05-01' }) },
  { name: 'CSV preview', method: 'post', url: () => `/api/delivery-partners/${kofiId}/csv/preview`, body: () => ({ csv: 'Order Number,Status\n1,delivered' }) },
  { name: 'assign a finding', method: 'patch', url: () => `/api/findings/${R.finding}`, body: () => ({ assigneeId: ownerB.id }) },
  { name: 'owed of a rep', method: 'get', url: () => `/api/payouts/owed/${repA.id}` },
  { name: 'record a payout', method: 'post', url: () => '/api/payouts', body: () => ({ payeeId: repA.id, amount: 10, method: 'Mobile Money', reference: 'ZQ47-X' }) },
  { name: 'record a partner payout', method: 'post', url: () => '/api/partner-settlements', body: () => ({ partnerId: kofiId, payoutDate: '2026-10-20', payoutAmount: 10, reference: 'ZQ47-X', lines: [{ externalOrderRef: '1', expAmount: 10 }] }) },
  { name: 'manual payout', method: 'post', url: () => '/api/partner-settlements/manual', body: () => ({ partnerId: kofiId, amount: 10, payoutDate: '2026-10-20', reference: 'ZQ47-X' }) },
  { name: 'manual payout preview', method: 'post', url: () => '/api/partner-settlements/manual/preview', body: () => ({ partnerId: kofiId, amount: 10 }) },
  { name: 'edit an expense', method: 'put', url: () => `/api/financial/expenses/${R.expense}`, body: () => ({ amount: 1 }) },
  { name: 'delete an expense', method: 'delete', url: () => `/api/financial/expenses/${R.expense}` },
  { name: 'remind a partner', method: 'post', url: () => `/api/financial/agent-aging/${kofiId}/remind` },
  { name: 'verify a deposit', method: 'post', url: () => `/api/agent-reconciliation/deposits/${R.deposit}/verify` },
  { name: 'reject a deposit', method: 'post', url: () => `/api/agent-reconciliation/deposits/${R.deposit}/reject`, body: () => ({ reason: 'No receipt shown' }) },
  { name: 'read a journal entry', method: 'get', url: () => `/api/gl/journal-entries/${R.journal}` },
  { name: 'void a journal entry', method: 'post', url: () => `/api/gl/journal-entries/${R.journal}/void`, body: () => ({ reason: 'test void reason' }) },
  { name: 'read an account', method: 'get', url: () => `/api/gl/accounts/${R.account}` },
];

beforeAll(async () => {
  a = (await createTenant('Guards A')).id;
  b = (await createTenant('Guards B')).id;
  await Promise.all([seedTenantDefaults(a), seedTenantDefaults(b)]);
  [ownerA, agentA, repA, ownerB] = await Promise.all([
    mkUser(a, 'zq47owner', 'super_admin'), mkUser(a, 'zq47agent', 'delivery_agent'), mkUser(a, 'zq47rep', 'sales_rep'), mkUser(b, 'ownerb', 'super_admin'),
  ]);
  world = { tenantId: a, customerId: await fx.mkCustomer(a, '+233241470001'), actorId: ownerA.id };
  kofiId = (await fx.mkPartner(a, 'zq47kofi', { fees: { delivered: 25, failed: 5 } })).id;
  // Tenant B has a partner and rows of its own, so an empty B would not hide a leak
  const partnerB = await fx.mkPartner(b, 'bpartner', { fees: { delivered: 10 } });
  await prismaBase.finding.create({ data: { tenantId: b, type: 'short_pay', subjectType: 'test', subjectId: 'b-finding', amount: 5 } });
  await prismaBase.agentDeposit.create({ data: { tenantId: b, agentId: partnerB.id, amount: 5, depositMethod: 'cash', depositDate: new Date(), referenceNumber: 'B-DEP' } });

  R.finding = (await prismaBase.finding.create({ data: { tenantId: a, type: 'short_pay', subjectType: 'test', subjectId: 'zq47-finding', amount: 50 } })).id;
  R.deposit = (await prismaBase.agentDeposit.create({ data: { tenantId: a, agentId: kofiId, amount: 10, depositMethod: 'cash', depositDate: new Date(), referenceNumber: 'ZQ47-DEP' } })).id;
  const expense = await call('post', '/api/financial/expenses', ownerA, { category: 'Transport', amount: 20, description: 'zq47 expense', expenseDate: '2026-10-05', paidFrom: 'momo' });
  R.expense = expense.body.expense.id;
  R.journal = (await prismaBase.journalEntry.findFirstOrThrow({ where: { tenantId: a, sourceType: 'expense', sourceId: R.expense } })).id;
  R.account = (await prismaBase.account.findFirstOrThrow({ where: { tenantId: a, code: '1010' } })).id;
  const entry = await prismaBase.commissionEntry.create({ data: { tenantId: a, userId: repA.id, kind: 'base', status: 'earned', amount: 50, earnedAt: new Date('2026-10-02T10:00:00Z') } as never });
  await runInTenant(a, () => prisma.$transaction((tx) => postCommission(tx, entry.id, ownerA.id)));
}, 120000);

afterAll(async () => {
  await prismaBase.agentDeposit.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await deleteTenantRows([a, b]);
  await prismaBase.$disconnect();
});

describe('owner of tenant A reads its own rows (so the leak checks below are not vacuous)', () => {
  it.each(lists.map((c) => [c.name, c] as const))('%s answers and, where it lists rows, carries tenant A markers', async (_name, c) => {
    const res = await call(c.method, c.url(), ownerA);
    expect(res.status).toBeLessThan(500);
    seen.push(JSON.stringify(res.body));
    if (c.carriesMarker) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body).toLowerCase()).toContain(MARK);
    }
  });
});

describe('a role without the permission is denied (delivery agent; sales rep where partners may read)', () => {
  it.each([...lists, ...byId].map((c) => [c.name, c] as const))('%s is 403', async (_name, c) => {
    const before = await signature();
    const res = await call(c.method, c.url(), c.deniedRole === 'rep' ? repA : agentA, c.body?.());
    expect(res.status).toBe(403);
    expect(await signature()).toEqual(before);
  });
});

describe('a partner reads only its own pay-ins', () => {
  it("tenant A's other partner deposit is not in the agent's list", async () => {
    const res = await call('get', '/api/agent-reconciliation/deposits', agentA);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain(MARK);
  });
});

describe('tenant B never sees or touches tenant A', () => {
  it.each(lists.map((c) => [c.name, c] as const))('list: %s holds no row of tenant A', async (_name, c) => {
    const res = await call(c.method, c.url(), ownerB);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain(MARK);
  });

  it.each(byId.map((c) => [c.name, c] as const))('by id: %s is refused, not served', async (_name, c) => {
    const res = await call(c.method, c.url(), ownerB, c.body?.());
    expect([400, 403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain(MARK);
  });

  it("none of those calls changed a row of tenant A", async () => {
    expect((await prismaBase.finding.findUniqueOrThrow({ where: { id: R.finding } })).assigneeId).toBeNull();
    expect((await prismaBase.agentDeposit.findUniqueOrThrow({ where: { id: R.deposit } })).status).toBe('pending');
    expect(Number((await prismaBase.expense.findUniqueOrThrow({ where: { id: R.expense } })).amount)).toBe(20);
    expect((await prismaBase.journalEntry.findUniqueOrThrow({ where: { id: R.journal } })).isVoided).toBe(false);
    expect(await prismaBase.feeRule.count({ where: { tenantId: a, partnerUserId: kofiId, outcome: 'returned' } })).toBe(0);
    expect(await prismaBase.partnerSettlement.count({ where: { tenantId: a } })).toBe(0);
    expect(await prismaBase.payout.count({ where: { tenantId: a } })).toBe(0);
  });
});

describe('replays change nothing', () => {
  it('the same partner payout twice: one settlement, one deposit, the cash moves once', async () => {
    const orderId = await fx.mkDeliveredOrder(world, kofiId, 200);
    const body = { partnerId: kofiId, payoutDate: '2026-10-20', payoutAmount: 175, reference: 'ZQ47-REF', lines: [{ externalOrderRef: `#${orderId}`, orderId, expAmount: 200, charge: 25 }] };
    const first = await call('post', '/api/partner-settlements', ownerA, body);
    expect(first.status).toBe(201);
    seen.push(JSON.stringify(first.body));
    const after = await signature();
    const again = await call('post', '/api/partner-settlements', ownerA, body);
    expect(again.status).toBe(200);
    expect(again.body.settlement).toMatchObject({ id: first.body.settlement.id, replayed: true });
    expect(await signature()).toEqual(after);
  });

  it('the same manual payout twice: the second is a 409 and nothing moves', async () => {
    await fx.mkDeliveredOrder(world, kofiId, 200);
    const body = { partnerId: kofiId, amount: 100, payoutDate: '2026-10-21', reference: 'ZQ47-MAN' };
    const first = await call('post', '/api/partner-settlements/manual', ownerA, body);
    expect(first.status).toBe(201);
    seen.push(JSON.stringify(first.body));
    const after = await signature();
    expect((await call('post', '/api/partner-settlements/manual', ownerA, body)).status).toBe(409);
    expect(await signature()).toEqual(after);
  });

  it('the same payout to a rep twice: the second is refused and the entries are paid once', async () => {
    const body = { payeeId: repA.id, amount: 50, method: 'Mobile Money', reference: 'ZQ47-PAY' };
    const first = await call('post', '/api/payouts', ownerA, body);
    expect(first.status).toBe(201);
    seen.push(JSON.stringify(first.body));
    const after = await signature();
    const again = await call('post', '/api/payouts', ownerA, body);
    expect([400, 409]).toContain(again.status);
    expect(await signature()).toEqual(after);
  });

  it('a delivery fee posts once however often the move repeats, and a commission entry posts once', async () => {
    const id = await fx.mkOrder(world, kofiId, 'out_for_delivery', { total: 200 });
    const actor = { kind: 'user' as const, userId: ownerA.id, role: 'super_admin' as const };
    const move = () => runInTenant(a, () => transitionOrder(id, 'delivered', actor, { deliveryDate: new Date('2026-10-18T12:00:00.000Z') }));
    await move();
    const after = await signature();
    await move();
    await move();
    expect(await signature()).toEqual(after);
    expect(await prismaBase.journalEntry.count({ where: { tenantId: a, sourceType: 'delivery_fee', sourceId: id } })).toBe(1);

    const entry = await prismaBase.commissionEntry.create({ data: { tenantId: a, userId: repA.id, kind: 'base', status: 'earned', amount: 8, earnedAt: new Date('2026-10-03T10:00:00Z') } as never });
    const post = () => runInTenant(a, () => prisma.$transaction((tx) => postCommission(tx, entry.id, ownerA.id)));
    await post();
    const payable = await balance('2020');
    await post();
    expect(await balance('2020')).toBe(payable);
  });

  it('a second fee rule for the same outcome and date is refused and stores nothing', async () => {
    const rule = { outcome: 'returned', amount: 2, validFrom: '2026-05-01' };
    expect((await call('post', `/api/delivery-partners/${kofiId}/fee-rules`, ownerA, rule)).status).toBe(201);
    const count = await prismaBase.feeRule.count({ where: { tenantId: a } });
    expect((await call('post', `/api/delivery-partners/${kofiId}/fee-rules`, ownerA, rule)).status).toBeGreaterThanOrEqual(400);
    expect(await prismaBase.feeRule.count({ where: { tenantId: a } })).toBe(count);
  });
});

describe('wording guard', () => {
  it('no response the owner read holds a banned term', () => {
    expect(seen.length).toBeGreaterThan(lists.length);
    const text = seen.join('\n').toLowerCase();
    expect(banned.filter((term) => text.includes(term.toLowerCase()))).toEqual([]);
  });
});
