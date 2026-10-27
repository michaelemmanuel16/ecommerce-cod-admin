/**
 * M5-T13, T14, T15 (COD-50): verify = reconcile in one step (F-912), aging per tenant with the four buckets (F-910, F-911,
 * F-704) and the Orders "Unpaid by agent" tab (F-309). Real database, two tenants.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant, getTenantId } from '../../utils/tenantContext';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import agentReconciliationService from '../../services/agentReconciliationService';
import agingService, { bucketIndexOf } from '../../services/agingService';
import { processSyncCashFindings } from '../../queues/agingQueue';
import * as cash from '../../services/kpi/cash';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { migrationStatements } from './helpers/migrationSql';
import { mkPartner } from './helpers/settlementFixtures';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const DAY = 24 * 60 * 60 * 1000;
let tenantId: string;
let otherId: string;
let owner: { id: number; token: string };
let rep: { id: number; token: string };
let customerId: number;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const setBalance = (agentId: number, currentBalance: number, tenant = tenantId) =>
  prismaBase.agentBalance.upsert({
    where: { agentId }, update: { currentBalance },
    create: { tenantId: tenant, agentId, currentBalance, totalCollected: Math.max(currentBalance, 0), totalDeposited: 0 },
  });

interface Delivered { daysAgo: number; cod?: number; fee?: number; status?: 'draft' | 'verified' | 'approved' | 'deposited' | 'reconciled'; allocated?: number; deleted?: boolean; orderStatus?: string }
/** A delivered order with its collection. The collection holds the net amount: cod minus the fee, as the delivery flow writes it. */
const delivered = async (agentId: number, o: Delivered, tenant = tenantId) => {
  const cod = o.cod ?? 100;
  const fee = o.fee ?? 0;
  const at = new Date(Date.now() - o.daysAgo * DAY);
  const order = await prismaBase.order.create({
    data: {
      customerId: tenant === tenantId ? customerId : (await otherCustomer()), status: (o.orderStatus ?? 'delivered') as any, subtotal: cod, totalAmount: cod, codAmount: cod,
      deliveryAgentId: agentId, deliveryDate: at, deliveryFee: fee, tenantId: tenant, deletedAt: o.deleted ? new Date() : null,
    } as any,
  });
  const collection = await prismaBase.agentCollection.create({
    data: { tenantId: tenant, orderId: order.id, agentId, amount: cod - fee, status: o.status ?? 'draft', allocatedAmount: o.allocated ?? 0, collectionDate: at },
  });
  return { orderId: order.id, collectionId: collection.id };
};
let otherCustomerId: number;
const otherCustomer = async () => otherCustomerId;

const unpaidByAge = () => request(app).get('/api/financial/unpaid-by-age').set(bearer(owner.token));
const agentAging = () => request(app).get('/api/financial/agent-aging').set(bearer(owner.token));
const partnerRow = (body: any, agentId: number) => body.partners.find((p: any) => p.agentId === agentId);

beforeAll(async () => {
  tenantId = (await createTenant('Collections aging')).id;
  otherId = (await createTenant('Collections aging B')).id;
  await seedTenantDefaults(tenantId);
  [owner, rep] = await Promise.all([mkUser(tenantId, 'owner', 'super_admin'), mkUser(tenantId, 'rep', 'sales_rep')]);
  const mkCustomer = async (t: string, n: number) => (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-7)}${n}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId: t },
  })).id;
  customerId = await mkCustomer(tenantId, 1);
  otherCustomerId = await mkCustomer(otherId, 2);
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherId]);
  await prismaBase.$disconnect();
});

describe('M5-T13: collection status path', () => {
  it('migration: old verified and approved rows move to reconciled when cash was posted, else draft; twice is safe', async () => {
    const p = (await mkPartner(tenantId, 'mig')).id;
    const posted = await delivered(p, { daysAgo: 1, status: 'approved' });
    const unposted = await delivered(p, { daysAgo: 1, status: 'verified' });
    const open = await delivered(p, { daysAgo: 1, status: 'draft' });
    const done = await delivered(p, { daysAgo: 1, status: 'deposited', allocated: 100 });
    await prismaBase.journalEntry.create({
      data: { tenantId, entryNumber: `MIG-${SUFFIX}`, entryDate: new Date(), description: 'old verify', sourceType: 'agent_collection', sourceId: posted.collectionId, createdBy: owner.id } as any,
    });

    const run = async () => { for (const sql of migrationStatements('20261026170000_m5_collections_aging')) await prismaBase.$executeRawUnsafe(sql); };
    await run();
    await run();

    const status = async (id: number) => (await prismaBase.agentCollection.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(posted.collectionId)).toBe('reconciled');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: posted.orderId } })).paymentStatus).toBe('reconciled');
    expect(await status(unposted.collectionId)).toBe('draft');
    expect(await status(open.collectionId)).toBe('draft');
    expect(await status(done.collectionId)).toBe('deposited');
  });

  it('the approve route is gone', async () => {
    const res = await request(app).post('/api/agent-reconciliation/1/approve').set(bearer(owner.token));
    expect(res.status).toBe(404);
  });

  it('reject needs a reason: refused without one, stored with one', async () => {
    const p = (await mkPartner(tenantId, 'rej')).id;
    const dep = await prismaBase.agentDeposit.create({ data: { tenantId, agentId: p, amount: 50, depositMethod: 'cash', depositDate: new Date(), referenceNumber: `REJ-${SUFFIX}` } });
    const url = `/api/agent-reconciliation/deposits/${dep.id}/reject`;
    expect((await request(app).post(url).set(bearer(owner.token)).send({})).status).toBe(400);
    expect((await request(app).post(url).set(bearer(owner.token)).send({ reason: '  ' })).status).toBe(400);
    expect((await prismaBase.agentDeposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe('pending');

    const ok = await request(app).post(url).set(bearer(owner.token)).send({ reason: 'Receipt is unclear' });
    expect(ok.status).toBe(200);
    const row = await prismaBase.agentDeposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect([row.status, row.rejectReason]).toEqual(['rejected', 'Receipt is unclear']);
  });

  it('recentDecided=N returns every pending pay-in plus the N newest decided ones (M5 UI fix 3)', async () => {
    const p = (await mkPartner(tenantId, 'recent')).id;
    const mk = (n: number, status: 'pending' | 'verified' | 'rejected', ago: number) => prismaBase.agentDeposit.create({
      data: { tenantId, agentId: p, amount: 10 + n, depositMethod: 'cash', depositDate: new Date(Date.now() - ago * DAY), referenceNumber: `RD${n}-${SUFFIX}`, status } as any,
    });
    await mk(1, 'pending', 20); await mk(2, 'pending', 19);
    for (let i = 0; i < 4; i++) await mk(10 + i, i % 2 ? 'rejected' : 'verified', 10 - i);
    const res = await request(app).get(`/api/agent-reconciliation/deposits?agentId=${p}&recentDecided=2`).set(bearer(owner.token));
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ status: string; referenceNumber: string }>;
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(2);
    expect(rows.filter((r) => r.status !== 'pending').map((r) => r.referenceNumber).sort()).toEqual([`RD12-${SUFFIX}`, `RD13-${SUFFIX}`]);
    expect(rows).toHaveLength(4);
    const plain = await request(app).get(`/api/agent-reconciliation/deposits?agentId=${p}`).set(bearer(owner.token));
    expect(plain.body).toHaveLength(6);
  });

  it('two people verifying one deposit: the second gets "Already verified" and the balance drops once', async () => {
    const p = (await mkPartner(tenantId, 'dup')).id;
    await setBalance(p, 300);
    await delivered(p, { daysAgo: 1, cod: 200 });
    const dep = await prismaBase.agentDeposit.create({ data: { tenantId, agentId: p, amount: 200, depositMethod: 'cash', depositDate: new Date(), referenceNumber: `DUP-${SUFFIX}` } });

    const results = await Promise.allSettled([
      inTenant(() => agentReconciliationService.verifyDeposit(dep.id, owner.id)),
      inTenant(() => agentReconciliationService.verifyDeposit(dep.id, owner.id)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.message).toMatch(/Already verified/);
    expect(lost.reason.statusCode).toBe(409);
    expect(Number((await prismaBase.agentBalance.findUniqueOrThrow({ where: { agentId: p } })).currentBalance)).toBe(100);
  });

  it('two people verifying one collection: draft to reconciled once, the second gets "Already verified"', async () => {
    const p = (await mkPartner(tenantId, 'dupc')).id;
    await setBalance(p, 500);
    const c = await delivered(p, { daysAgo: 1, cod: 120 });
    const results = await Promise.allSettled([
      inTenant(() => agentReconciliationService.verifyCollection(c.collectionId, owner.id)),
      inTenant(() => agentReconciliationService.verifyCollection(c.collectionId, owner.id)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('Already verified');
    expect((await prismaBase.agentCollection.findUniqueOrThrow({ where: { id: c.collectionId } })).status).toBe('reconciled');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: c.orderId } })).paymentStatus).toBe('reconciled');
    expect(Number((await prismaBase.agentBalance.findUniqueOrThrow({ where: { agentId: p } })).currentBalance)).toBe(380);
  });

  it('a verify that would push the balance below zero fails, leaves everything as it was and opens a Finding', async () => {
    const p = (await mkPartner(tenantId, 'neg')).id;
    await setBalance(p, 100);
    const dep = await prismaBase.agentDeposit.create({ data: { tenantId, agentId: p, amount: 300, depositMethod: 'cash', depositDate: new Date(), referenceNumber: `NEG-${SUFFIX}` } });

    await expect(inTenant(() => agentReconciliationService.verifyDeposit(dep.id, owner.id))).rejects.toMatchObject({ statusCode: 400, errorCode: 'BALANCE_BELOW_ZERO' });
    expect((await prismaBase.agentDeposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe('pending');
    expect(Number((await prismaBase.agentBalance.findUniqueOrThrow({ where: { agentId: p } })).currentBalance)).toBe(100);
    const own = { tenantId, type: 'verify_exceeds_cash_held' as const, subjectType: 'delivery_partner', subjectId: String(p) };
    const findings = await prismaBase.finding.findMany({ where: own });
    expect(findings).toHaveLength(1);
    expect([findings[0].status, Number(findings[0].amount)]).toEqual(['open', 200]);
    expect(findings[0].note).toContain(`#${dep.id}`);

    // A repeat does not open a second Finding, and the cash held sync (which closes negative_cash_held ones) leaves it open
    await expect(inTenant(() => agentReconciliationService.verifyDeposit(dep.id, owner.id))).rejects.toMatchObject({ errorCode: 'BALANCE_BELOW_ZERO' });
    await inTenant(() => agingService.syncNegativeCashFindings());
    expect((await prismaBase.finding.findMany({ where: own })).map((f) => f.status)).toEqual(['open']);
  });
});

describe('M5-T14: aging buckets, cash held, fee-net amounts', () => {
  it('bucket edges: 0 and 3 in 0-3, 4 and 7 in 4-7, 8 and 14 in 8-14, 15 and more in 15+', () => {
    expect([0, 3, 4, 7, 8, 14, 15, 90].map(bucketIndexOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('counts delivered orders with an open collection only, in the four buckets, net of the fee; today is in 0-3', async () => {
    const p = (await mkPartner(tenantId, 'bkt', { daysToPay: 30 })).id;
    await setBalance(p, 600);
    await delivered(p, { daysAgo: 0, cod: 100, fee: 12 }); // today: 88 net
    await delivered(p, { daysAgo: 3, cod: 100 });
    await delivered(p, { daysAgo: 4, cod: 100 });
    await delivered(p, { daysAgo: 9, cod: 100 });
    await delivered(p, { daysAgo: 20, cod: 100 });
    // not counted: reconciled, covered by a deposit, deleted, not delivered
    await delivered(p, { daysAgo: 5, status: 'reconciled', allocated: 100 });
    await delivered(p, { daysAgo: 5, status: 'deposited', allocated: 100 });
    await delivered(p, { daysAgo: 5, deleted: true });
    await delivered(p, { daysAgo: 5, orderStatus: 'returned' });
    await delivered(p, { daysAgo: 6, cod: 100, allocated: 40 }); // part-covered: 60 left

    const body = (await agentAging()).body;
    const row = partnerRow(body, p);
    expect(row.buckets.map((b: any) => [b.key, b.orders, Number(b.amount)])).toEqual([
      ['0-3', 2, 188], ['4-7', 2, 160], ['8-14', 1, 100], ['15+', 1, 100],
    ]);
    expect(row.unpaidOrders).toBe(6);
    expect(Number(row.unpaidAmount)).toBe(548);
    expect(row.oldestUnpaidDays).toBe(20);
    expect(row.daysToPay).toBe(30);
    expect(Number(row.cashHeld)).toBe(600);

    const card = (await unpaidByAge()).body;
    expect(card.basis).toBe('net_of_delivery_fee');
    expect(card.buckets.map((b: any) => b.key)).toEqual(['0-3', '4-7', '8-14', '15+']);
    const mine = card.buckets.map((b: any) => b.orders).reduce((a: number, b: number) => a + b, 0);
    expect(card.total.orders).toBe(mine);
  });

  it('negative cash held shows with a Finding, and the Finding closes when the balance recovers', async () => {
    const p = (await mkPartner(tenantId, 'negcash')).id;
    await setBalance(p, -75);
    await inTenant(() => agingService.syncNegativeCashFindings());

    const row = partnerRow((await agentAging()).body, p);
    expect(row.negativeCashHeld).toBe(true);
    expect(Number(row.cashHeld)).toBe(-75);
    const finding = await prismaBase.finding.findFirstOrThrow({ where: { tenantId, type: 'negative_cash_held', subjectType: 'delivery_partner', subjectId: String(p) } });
    expect([finding.status, Number(finding.amount), row.findingId]).toEqual(['open', 75, finding.id]);

    await inTenant(() => agingService.syncNegativeCashFindings());
    expect(await prismaBase.finding.count({ where: { tenantId, type: 'negative_cash_held', subjectId: String(p) } })).toBe(1);

    await setBalance(p, 0);
    await inTenant(() => agingService.syncNegativeCashFindings());
    expect((await prismaBase.finding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe('closed');
  });
});

describe('M5-T14: cash held sync is per tenant', () => {
  it('syncing one tenant leaves the Findings of the other as they were, and its report never lists them', async () => {
    const pb = (await mkPartner(otherId, 'tb', { daysToPay: 8 })).id;
    await delivered(pb, { daysAgo: 10, cod: 70 }, otherId);
    await setBalance(pb, -20, otherId);
    await runInTenant(otherId, () => agingService.syncNegativeCashFindings());
    const before = await prismaBase.finding.findMany({ where: { tenantId: otherId, type: 'negative_cash_held' } });
    expect(before).toHaveLength(1);

    await inTenant(() => agingService.syncNegativeCashFindings());
    const after = await prismaBase.finding.findMany({ where: { tenantId: otherId, type: 'negative_cash_held' } });
    expect(after.map((f) => [f.id, f.status])).toEqual(before.map((f) => [f.id, f.status]));
    const report = await runInTenant(otherId, () => agingService.getAgingReport());
    expect(report.partners.map((p) => p.agentId)).toEqual([pb]);
    expect(report.summary.totalOrders).toBe(1);
  });

  it('a tenant that fails does not stop the others; the job still fails', async () => {
    const real = agingService.syncNegativeCashFindings.bind(agingService);
    const pb = (await mkPartner(otherId, 'tb2', { daysToPay: 8 })).id;
    await setBalance(pb, -33, otherId);
    const spy = jest.spyOn(agingService, 'syncNegativeCashFindings').mockImplementation(async () => {
      const id = getTenantId();
      if (id === tenantId) throw new Error('boom');
      if (id === otherId) return real();
    });
    try {
      await expect(processSyncCashFindings()).rejects.toThrow(/failed for 1\//);
    } finally {
      spy.mockRestore();
    }
    const rows = await prismaBase.finding.findMany({ where: { tenantId: otherId, type: 'negative_cash_held', subjectId: String(pb) } });
    expect(rows.map((f) => Number(f.amount))).toEqual([33]);
  });
});

describe('M5-T15: Orders "Unpaid by agent" tab', () => {
  it('uses the partner days to pay, else 7; the count matches the aging card, the table and the Dashboard', async () => {
    const fast = (await mkPartner(tenantId, 'fast', { daysToPay: 3 })).id;   // overdue above 3 days
    const slow = (await mkPartner(tenantId, 'slow', { daysToPay: 20 })).id;  // overdue above 20 days
    const none = (await mkPartner(tenantId, 'none', { daysToPay: 0 })).id;   // no days to pay: 7
    await setBalance(fast, 1000); await setBalance(slow, 1000); await setBalance(none, 1000);
    const f4 = await delivered(fast, { daysAgo: 4 });
    const f3 = await delivered(fast, { daysAgo: 3 });
    const s10 = await delivered(slow, { daysAgo: 10 });
    const s21 = await delivered(slow, { daysAgo: 21 });
    const n8 = await delivered(none, { daysAgo: 8 });
    const n7 = await delivered(none, { daysAgo: 7 });
    const mine = [f4, f3, s10, s21, n8, n7].map((x) => x.orderId);

    const res = await request(app).get('/api/orders?tab=unpaid_by_agent&limit=100').set(bearer(owner.token));
    expect(res.status).toBe(200);
    const body = res.body;
    const ids = body.orders.map((o: any) => o.id).filter((id: number) => mine.includes(id)).sort();
    expect(ids).toEqual([f4.orderId, s21.orderId, n8.orderId].sort());
    expect(body.orders.find((o: any) => o.id === n8.orderId).unpaid).toEqual({ days: 8, daysToPay: 7 });

    // Count matches the aging card, the partner table and the Dashboard tile
    const aging = (await agentAging()).body;
    expect(body.pagination.total).toBe(aging.summary.overdueOrders);
    expect((await unpaidByAge()).body.overdue.orders).toBe(body.pagination.total);
    // The tab count on /api/orders/counts is the same number, and null for a role without financial:view
    expect((await request(app).get('/api/orders/counts').set(bearer(owner.token))).body.unpaidByAgent).toBe(body.pagination.total);
    expect((await request(app).get('/api/orders/counts').set(bearer(rep.token))).body.unpaidByAgent).toBeNull();
    expect((await cash.cashHeldByPartners(tenantId)).detail?.overdueOrders).toBe(body.pagination.total);

    // Paging happens in the database
    const page = await request(app).get('/api/orders?tab=unpaid_by_agent&limit=1&page=2').set(bearer(owner.token));
    expect([page.body.orders.length, page.body.pagination.total]).toEqual([1, body.pagination.total]);
  });

  it('a role without financial view is refused', async () => {
    expect((await request(app).get('/api/orders?tab=unpaid_by_agent').set(bearer(rep.token))).status).toBe(403);
  });
});
