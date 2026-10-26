/**
 * M5-T08 (COD-49): Findings service and API (F-909): list, filter, assign, explain, write off, and the auto-close of a
 * short_pay Finding when a later settlement clears its cause. Two tenants.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { closeClearedShortPays } from '../../services/findingService';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

let tenantId: string;
let otherTenantId: string;
let owner: { id: number; token: string };
let clerk: { id: number; token: string };
let manager: { id: number; token: string };
let rep: { id: number; token: string };
let otherOwner: { id: number; token: string };
const ids: Record<string, number> = {};

const mkFinding = (type: string, extra: Record<string, unknown> = {}, tid = tenantId) =>
  prismaBase.finding.create({ data: { tenantId: tid, type: type as any, subjectType: 'test', subjectId: `${Date.now()}-${Math.random()}`, amount: 50, ...extra } });
const patch = (token: string, id: number, body: Record<string, unknown>) =>
  request(app).patch(`/api/findings/${id}`).set(bearer(token)).send(body);

beforeAll(async () => {
  tenantId = (await createTenant('Findings')).id;
  otherTenantId = (await createTenant('Findings Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  owner = await mkUser(tenantId, 'fowner', 'super_admin');
  clerk = await mkUser(tenantId, 'fclerk', 'accountant');
  manager = await mkUser(tenantId, 'fmanager', 'manager');
  rep = await mkUser(tenantId, 'frep', 'sales_rep');
  otherOwner = await mkUser(otherTenantId, 'fother', 'super_admin');
  // The accountant holds financial:update in this tenant (the matrix is the tenant's to change)
  await prismaBase.systemConfig.upsert({
    where: { tenantId },
    update: { rolePermissions: { accountant: { financial: ['view', 'create', 'update'] } } },
    create: { tenantId, rolePermissions: { accountant: { financial: ['view', 'create', 'update'] } } } as any,
  });
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('GET /api/findings', () => {
  beforeAll(async () => {
    ids.short = (await mkFinding('short_pay', { assigneeId: clerk.id })).id;
    ids.cash = (await mkFinding('cash_gap')).id;
    ids.explained = (await mkFinding('short_pay', { status: 'explained', explanation: 'done' })).id;
    ids.foreign = (await mkFinding('short_pay', {}, otherTenantId)).id;
  });

  it('lists the tenant newest first and never another tenant', async () => {
    const res = await request(app).get('/api/findings').set(bearer(owner.token));
    expect(res.status).toBe(200);
    const got = res.body.findings.map((f: any) => f.id);
    expect(got).toEqual([ids.explained, ids.cash, ids.short]);
    expect(got).not.toContain(ids.foreign);
    expect(res.body.pagination.total).toBe(3);
  });

  it('filters by type, status and assignee', async () => {
    const byType = await request(app).get('/api/findings?type=short_pay').set(bearer(owner.token));
    expect(byType.body.findings.map((f: any) => f.id).sort()).toEqual([ids.short, ids.explained].sort());
    const byStatus = await request(app).get('/api/findings?type=short_pay&status=open').set(bearer(owner.token));
    expect(byStatus.body.findings.map((f: any) => f.id)).toEqual([ids.short]);
    const byAssignee = await request(app).get(`/api/findings?assigneeId=${clerk.id}`).set(bearer(owner.token));
    expect(byAssignee.body.findings.map((f: any) => f.id)).toEqual([ids.short]);
    expect(byAssignee.body.findings[0].assignee.id).toBe(clerk.id);
    const unassigned = await request(app).get('/api/findings?assigneeId=none').set(bearer(owner.token));
    expect(unassigned.body.findings.map((f: any) => f.id)).toEqual([ids.explained, ids.cash]);
  });

  it('rejects an unknown type or status and a role without financial:view', async () => {
    expect((await request(app).get('/api/findings?type=nope').set(bearer(owner.token))).status).toBe(400);
    expect((await request(app).get('/api/findings?status=nope').set(bearer(owner.token))).status).toBe(400);
    expect((await request(app).get('/api/findings').set(bearer(rep.token))).status).toBe(403);
  });
});

describe('PATCH /api/findings/:id', () => {
  it('assigns and unassigns, and refuses an assignee of another tenant', async () => {
    const f = await mkFinding('cash_gap');
    const res = await patch(owner.token, f.id, { assigneeId: manager.id });
    expect(res.status).toBe(200);
    expect(res.body.finding.assignee.id).toBe(manager.id);
    expect(res.body.finding.status).toBe('open');
    expect((await patch(owner.token, f.id, { assigneeId: otherOwner.id })).status).toBe(400);
    const cleared = await patch(owner.token, f.id, { assigneeId: null });
    expect(cleared.body.finding.assignee).toBeNull();
  });

  it('explains with a note, and needs the note', async () => {
    const f = await mkFinding('short_pay');
    expect((await patch(owner.token, f.id, { status: 'explained' })).status).toBe(400);
    const res = await patch(clerk.token, f.id, { status: 'explained', explanation: 'Partner paid on Monday' });
    expect(res.status).toBe(200);
    expect(res.body.finding).toMatchObject({ status: 'explained', explanation: 'Partner paid on Monday', resolvedById: clerk.id });
    expect(res.body.finding.resolvedAt).toBeTruthy();
    // a second change on a closed Finding is a 409
    expect((await patch(owner.token, f.id, { status: 'explained', explanation: 'again' })).status).toBe(409);
  });

  it('a write-off is owner only and needs a note', async () => {
    const f = await mkFinding('short_pay');
    expect((await patch(clerk.token, f.id, { status: 'written_off', explanation: 'lost' })).status).toBe(403);
    expect((await patch(owner.token, f.id, { status: 'written_off' })).status).toBe(400);
    const res = await patch(owner.token, f.id, { status: 'written_off', explanation: 'Partner closed down' });
    expect(res.status).toBe(200);
    expect(res.body.finding.status).toBe('written_off');
  });

  it('needs financial:update, and another tenant sees 404', async () => {
    const f = await mkFinding('cash_gap');
    expect((await patch(manager.token, f.id, { assigneeId: clerk.id })).status).toBe(403);
    expect((await patch(otherOwner.token, f.id, { assigneeId: otherOwner.id })).status).toBe(404);
    expect((await patch(owner.token, f.id, {})).status).toBe(400);
  });

  it('two people resolving at once: one wins, the other gets 409', async () => {
    const f = await mkFinding('short_pay');
    const [a, b] = await Promise.all([
      patch(owner.token, f.id, { status: 'explained', explanation: 'A' }),
      patch(clerk.token, f.id, { status: 'explained', explanation: 'B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('writes one audit row per change', async () => {
    const f = await mkFinding('cash_gap');
    await patch(owner.token, f.id, { assigneeId: clerk.id });
    expect(await prismaBase.auditLog.count({ where: { tenantId, resource: 'finding', resourceId: String(f.id) } })).toBe(1);
  });
});

describe('closeClearedShortPays', () => {
  let partnerId: number;
  const mkSettlement = async (reference: string, orderIds: number[]) => {
    const s = await prismaBase.partnerSettlement.create({
      data: { tenantId, partnerId, payoutDate: new Date(), payoutAmount: 10, reference, status: 'short' },
    });
    for (const orderId of orderIds) {
      await prismaBase.partnerSettlementLine.create({ data: { tenantId, settlementId: s.id, orderId, externalOrderRef: String(orderId), expAmount: 100, matched: true } });
    }
    return s;
  };

  beforeAll(async () => {
    partnerId = (await mkUser(tenantId, 'fpartner', 'delivery_agent', { kind: 'person' })).id;
    ids.customer = (await prismaBase.customer.create({
      data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(Date.now()).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
    })).id;
  });

  const mkOrderWithCollection = async (status: 'draft' | 'reconciled') => {
    const order = await prismaBase.order.create({
      data: { customerId: ids.customer, status: 'delivered', subtotal: 100, totalAmount: 100, codAmount: 100, deliveryAgentId: partnerId, tenantId } as any,
    });
    await prismaBase.agentCollection.create({ data: { tenantId, orderId: order.id, agentId: partnerId, amount: 100, status, collectionDate: new Date() } });
    return order.id;
  };

  it('closes a short_pay Finding as explained when no matched order is unpaid any more, and leaves the others', async () => {
    const paid = await mkOrderWithCollection('reconciled');
    const unpaid = await mkOrderWithCollection('draft');
    const cleared = await mkSettlement(`C-${Date.now()}`, [paid]);
    const notCleared = await mkSettlement(`N-${Date.now()}`, [paid, unpaid]);
    const fCleared = await mkFinding('short_pay', { subjectType: 'partner_settlement', subjectId: String(cleared.id) });
    const fNot = await mkFinding('short_pay', { subjectType: 'partner_settlement', subjectId: String(notCleared.id) });

    const closed = await runInTenant(tenantId, () => closeClearedShortPays(prismaBase as any, partnerId, 'PAY-77'));
    expect(closed).toEqual([fCleared.id]);
    const after = await prismaBase.finding.findUniqueOrThrow({ where: { id: fCleared.id } });
    expect(after).toMatchObject({ status: 'explained', explanation: 'Cleared by settlement PAY-77' });
    expect(after.resolvedAt).toBeTruthy();
    expect((await prismaBase.finding.findUniqueOrThrow({ where: { id: fNot.id } })).status).toBe('open');
  });
});

describe('a write-off posts to the ledger (F-909)', () => {
  const bal = async (code: string) => Number((await prismaBase.account.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code } } })).currentBalance);
  const entriesOf = (findingId: number) => prismaBase.journalEntry.findMany({
    where: { tenantId, sourceType: 'finding_writeoff', sourceId: findingId }, include: { transactions: { include: { account: true } } },
  });
  const lines = (e: Awaited<ReturnType<typeof entriesOf>>[number]) => e.transactions.map((t) => [t.account.code, Number(t.debitAmount), Number(t.creditAmount)]).sort();

  it.each(['short_pay', 'cash_gap', 'unpaid_term'])('%s: DR 5100, CR 1015', async (type) => {
    const f = await mkFinding(type, { amount: 70 });
    const [e5100, c1015] = [await bal('5100'), await bal('1015')];
    expect((await patch(owner.token, f.id, { status: 'written_off', explanation: 'Partner closed' })).status).toBe(200);
    const entries = await entriesOf(f.id);
    expect(entries).toHaveLength(1);
    expect(lines(entries[0])).toEqual([['1015', 0, 70], ['5100', 70, 0]]);
    expect(await bal('5100')).toBe(e5100 + 70);
    expect(await bal('1015')).toBe(c1015 - 70);
  });

  it.each(['excess_deposit', 'over_pay'])('%s: DR 5100, CR 2040', async (type) => {
    const f = await mkFinding(type, { amount: 30 });
    expect((await patch(owner.token, f.id, { status: 'written_off', explanation: 'Not claimed' })).status).toBe(200);
    const entries = await entriesOf(f.id);
    expect(lines(entries[0])).toEqual([['2040', 0, 30], ['5100', 30, 0]]);
  });

  it('a type with no ledger amount, or an amount of 0, posts nothing', async () => {
    const noLedger = await mkFinding('fee_rule_missing', { amount: 50 });
    const zero = await mkFinding('short_pay', { amount: 0 });
    const none = await mkFinding('short_pay', { amount: null });
    for (const f of [noLedger, zero, none]) {
      expect((await patch(owner.token, f.id, { status: 'written_off', explanation: 'x' })).status).toBe(200);
      expect(await entriesOf(f.id)).toHaveLength(0);
    }
  });

  it('a repeat write-off posts once, and a non-owner is denied and posts nothing', async () => {
    const f = await mkFinding('short_pay', { amount: 20 });
    expect((await patch(clerk.token, f.id, { status: 'written_off', explanation: 'lost' })).status).toBe(403);
    expect(await entriesOf(f.id)).toHaveLength(0);
    const [a, b] = await Promise.all([
      patch(owner.token, f.id, { status: 'written_off', explanation: 'A' }),
      patch(owner.token, f.id, { status: 'written_off', explanation: 'B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await patch(owner.token, f.id, { status: 'written_off', explanation: 'again' }).then((r) => r.status)).toBe(409);
    expect(await entriesOf(f.id)).toHaveLength(1);
  });

  it('an explained Finding posts nothing', async () => {
    const f = await mkFinding('short_pay', { amount: 20 });
    await patch(owner.token, f.id, { status: 'explained', explanation: 'paid later' });
    expect(await entriesOf(f.id)).toHaveLength(0);
  });
});
