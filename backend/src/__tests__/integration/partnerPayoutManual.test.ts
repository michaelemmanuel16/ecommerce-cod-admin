/**
 * M5-T12 (COD-49): manual partner payout (F-908). FIFO to the partner's oldest unpaid orders, amount 0 or below rejected,
 * excess held in 2040 with a warning, a partner with no unpaid orders holds the whole amount as unapplied.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { recordPartnerPayout, parsePartnerPayout } from '../../services/partnerSettlementService';
import { runInTenant } from '../../utils/tenantContext';
import * as fx from './helpers/settlementFixtures';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { accountBalance } from './helpers/ledgerPost';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
let tenantId: string;
let owner: { id: number; token: string };
let stock: { id: number; token: string };
let customerId: number;
let refSeq = 0;

const world = () => ({ tenantId, customerId, actorId: owner.id });
const mkPartner = async (label: string) => (await fx.mkPartner(tenantId, label, { fees: { delivered: 25 } })).id;
const deliver = (partnerId: number, total = 200) => fx.mkDeliveredOrder(world(), partnerId, total);
const balance = (code: string) => accountBalance(tenantId, code);
const collectionOf = (orderId: number) => prismaBase.agentCollection.findUniqueOrThrow({ where: { orderId } });
const ref = (label: string) => `${label}-${++refSeq}`;
const manual = (token: string, body: Record<string, unknown>) => request(app).post('/api/partner-settlements/manual').set(bearer(token)).send(body);

beforeAll(async () => {
  tenantId = (await createTenant('Manual Payout')).id;
  await seedTenantDefaults(tenantId);
  customerId = await fx.mkCustomer(tenantId, `+2332${String(SUFFIX).slice(-8)}`);
  owner = await mkUser(tenantId, 'mowner', 'super_admin');
  stock = await mkUser(tenantId, 'mstock', 'inventory_manager');
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('POST /api/partner-settlements/manual', () => {
  it('matches the amount to the oldest unpaid orders first: two in full, the third in part', async () => {
    const partner = await mkPartner('mkofi');
    const [o1, o2, o3] = [await deliver(partner), await deliver(partner), await deliver(partner)];
    // The third order is the oldest by delivery: FIFO follows the collection date, not the id
    await prismaBase.agentCollection.update({ where: { orderId: o3 }, data: { collectionDate: new Date('2026-01-01') } });
    const [b1015, b1010] = [await balance('1015'), await balance('1010')];

    const res = await manual(owner.token, { partnerId: partner, amount: 400, payoutDate: '2026-10-21', reference: ref('MAN'), notes: 'Cash at the office' });
    expect(res.status).toBe(201);
    const s = res.body.settlement;
    expect(s).toMatchObject({ isManual: true, status: 'matched', payoutAmount: '400.00', expectedNet: '525.00', unappliedAmount: '0.00', payoutDate: '2026-10-21', warnings: [] });
    expect(s.lines.map((l: any) => [l.orderId, l.expAmount, l.matchedBy])).toEqual([[o3, '175.00', 'fifo'], [o1, '175.00', 'fifo'], [o2, '50.00', 'fifo']]);

    expect((await collectionOf(o3)).status).toBe('reconciled');
    expect((await collectionOf(o1)).status).toBe('reconciled');
    const part = await collectionOf(o2);
    expect(part.status).toBe('draft');
    expect(Number(part.allocatedAmount)).toBe(50);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: o3 } })).paymentStatus).toBe('reconciled');

    const deposit = await prismaBase.agentDeposit.findFirstOrThrow({ where: { tenantId, settlementId: s.id } });
    expect(deposit).toMatchObject({ status: 'verified', depositMethod: 'manual', agentId: partner });
    expect(Number(deposit.amount)).toBe(400);
    expect(await balance('1010')).toBe(b1010 + 400);
    expect(await balance('1015')).toBe(b1015 - 400);
    const bal = await prismaBase.agentBalance.findUniqueOrThrow({ where: { agentId: partner } });
    expect(Number(bal.currentBalance)).toBe(125);
    expect(Number(bal.totalDeposited)).toBe(400);
    expect(await prismaBase.auditLog.count({ where: { tenantId, resource: 'partner_settlement', resourceId: String(s.id) } })).toBe(1);
  });

  it('the Overview card shows a part payment with every owed order and what is still owed, not Matched (M5 QA)', async () => {
    const partner = await mkPartner('mpart');
    for (let i = 0; i < 3; i++) await deliver(partner); // 3 orders, 175 each after the fee: 525 owed
    expect((await manual(owner.token, { partnerId: partner, amount: 200, payoutDate: '2026-09-15', reference: ref('PART') })).status).toBe(201);

    const res = await request(app).get('/api/financial/overview?from=2026-09-15&to=2026-09-15&asOf=2026-09-15').set(bearer(owner.token));
    expect(res.status).toBe(200);
    const row = res.body.reconciliation.rows.find((r: any) => r.partnerId === partner);
    expect(row).toMatchObject({ paidIn: '200.00', expectedAfterFees: '525.00', orders: 3, stillOwed: '325.00' });
  });

  it('rejects an amount of 0 or below and bad input', async () => {
    const partner = await mkPartner('mbad');
    const before = await prismaBase.partnerSettlement.count({ where: { tenantId } });
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ amount: 0 }, /amount must be above 0/],
      [{ amount: -5 }, /amount must be above 0/],
      [{ amount: 'abc' }, /amount must be a number/],
      [{ amount: 100, reference: '  ' }, /reference is required/],
      [{ amount: 100, payoutDate: '2026-02-30' }, /YYYY-MM-DD/],
      [{ amount: 100, partnerId: 'x' }, /partnerId/],
    ];
    for (const [extra, message] of cases) {
      const res = await manual(owner.token, { partnerId: partner, reference: ref('BAD'), ...extra });
      expect({ extra, status: res.status }).toEqual({ extra, status: 400 });
      expect(res.body.error).toMatch(message);
    }
    expect(await prismaBase.partnerSettlement.count({ where: { tenantId } })).toBe(before);
  });

  it('holds the excess in 2040 and the response says how much is unapplied', async () => {
    const partner = await mkPartner('mexcess');
    const o = await deliver(partner);
    const [b1010, b1015, b2040] = [await balance('1010'), await balance('1015'), await balance('2040')];
    const res = await manual(owner.token, { partnerId: partner, amount: 300, reference: ref('EXC') });
    expect(res.status).toBe(201);
    expect(res.body.settlement).toMatchObject({ status: 'over', unappliedAmount: '125.00', expectedNet: '175.00' });
    expect(res.body.settlement.warnings).toEqual(['GHS 125.00 will be held as unapplied (account 2040)']);
    expect((await collectionOf(o)).status).toBe('reconciled');
    expect(await balance('1010')).toBe(b1010 + 300);
    expect(await balance('1015')).toBe(b1015 - 175);
    expect(await balance('2040')).toBe(b2040 + 125);
    expect(res.body.settlement.findings.map((f: any) => f.type)).toEqual(['excess_deposit']);
  });

  it('a partner with no unpaid orders holds the whole amount as unapplied', async () => {
    const partner = await mkPartner('mnone');
    const b2040 = await balance('2040');
    const res = await manual(owner.token, { partnerId: partner, amount: 80, reference: ref('NONE') });
    expect(res.status).toBe(201);
    expect(res.body.settlement).toMatchObject({ unappliedAmount: '80.00', matchedLines: 0, lines: [], expectedNet: '0.00' });
    expect(res.body.settlement.warnings[0]).toMatch(/80\.00 will be held as unapplied/);
    expect(await balance('2040')).toBe(b2040 + 80);
  });

  it('a used reference is 409 and says when it was used', async () => {
    const partner = await mkPartner('mdup');
    const reference = ref('DUP');
    expect((await manual(owner.token, { partnerId: partner, amount: 10, payoutDate: '2026-10-19', reference })).status).toBe(201);
    const again = await manual(owner.token, { partnerId: partner, amount: 10, reference });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('This reference was used on 2026-10-19');
    // another partner may use the same reference
    expect((await manual(owner.token, { partnerId: await mkPartner('mdup2'), amount: 10, reference })).status).toBe(201);
  });

  it('closes a short_pay Finding when it covers the rest', async () => {
    const partner = await mkPartner('mshort');
    const [x, y] = [await deliver(partner), await deliver(partner)];
    const short = await runInTenant(tenantId, () => recordPartnerPayout({ id: owner.id }, parsePartnerPayout({
      partnerId: partner, payoutDate: '2026-10-20', payoutAmount: 300, reference: ref('SH'),
      lines: [{ externalOrderRef: String(x), orderId: x, expAmount: 200, charge: 25 }, { externalOrderRef: String(y), orderId: y, expAmount: 200, charge: 25 }],
    })));
    const finding = await prismaBase.finding.findFirstOrThrow({ where: { tenantId, type: 'short_pay', subjectId: String(short.id) } });
    expect(finding.status).toBe('open');

    const reference = ref('TOP');
    const res = await manual(owner.token, { partnerId: partner, amount: 50, reference });
    expect(res.status).toBe(201);
    expect(res.body.settlement.matchedLines).toBe(1);
    expect(await prismaBase.finding.findUniqueOrThrow({ where: { id: finding.id } })).toMatchObject({ status: 'explained', explanation: `Cleared by settlement ${reference}` });
  });

  it('needs the payouts permission and a partner of this tenant', async () => {
    const partner = await mkPartner('mperm');
    expect((await manual(stock.token, { partnerId: partner, amount: 10, reference: ref('P') })).status).toBe(403);
    expect((await manual(owner.token, { partnerId: stock.id, amount: 10, reference: ref('P') })).status).toBe(404);
  });
});

describe('concurrency', () => {
  it('two payouts at once for one partner each clear a different order; the cash is applied once', async () => {
    const partner = await mkPartner('mrace');
    const [o1, o2] = [await deliver(partner), await deliver(partner)];
    const [b1010, b1015, b2040] = [await balance('1010'), await balance('1015'), await balance('2040')];
    const [r1, r2] = await Promise.all([
      manual(owner.token, { partnerId: partner, amount: 175, reference: ref('RACE-1') }),
      manual(owner.token, { partnerId: partner, amount: 175, reference: ref('RACE-2') }),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect([r1.body.settlement.lines[0].orderId, r2.body.settlement.lines[0].orderId].sort()).toEqual([o1, o2].sort());
    expect((await collectionOf(o1)).status).toBe('reconciled');
    expect((await collectionOf(o2)).status).toBe('reconciled');
    expect(await balance('1010')).toBe(b1010 + 350);
    expect(await balance('1015')).toBe(b1015 - 350);
    expect(await balance('2040')).toBe(b2040);
  });

  it('a payout and a verified deposit of one partner at once never cover the same cash twice', async () => {
    const partner = await mkPartner('mrace2');
    const o = await deliver(partner);
    const deposit = await fx.mkDeposit(tenantId, partner, 175, `RACE-DEP-${SUFFIX}`);
    const agentRecon = (await import('../../services/agentReconciliationService')).default;
    const [b1015, b1010, b2040] = [await balance('1015'), await balance('1010'), await balance('2040')];
    const settled = await Promise.allSettled([
      manual(owner.token, { partnerId: partner, amount: 175, reference: ref('RACE-3') }),
      runInTenant(tenantId, () => agentRecon.verifyDeposit(deposit.id, owner.id)),
    ]);
    // Whichever runs first covers the order. 1015 falls by 175 once. The other either fails (the partner balance is
    // spent) or its 175 is held as unapplied in 2040: 1010 and 2040 move together, never the order's cash twice.
    expect((await collectionOf(o)).allocatedAmount.toNumber()).toBe(175);
    expect(await balance('1015')).toBe(b1015 - 175);
    const received = (await balance('1010')) - b1010;
    expect([175, 350]).toContain(received);
    expect((await balance('2040')) - b2040).toBe(received - 175);
    expect(settled.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/partner-settlements/manual/preview', () => {
  const preview = (token: string, body: Record<string, unknown>) => request(app).post('/api/partner-settlements/manual/preview').set(bearer(token)).send(body);

  it('shows the plan with no write, and the real call then does exactly that', async () => {
    const partner = await mkPartner('mprev');
    const [o1, o2, o3] = [await deliver(partner), await deliver(partner), await deliver(partner)];
    await prismaBase.agentCollection.update({ where: { orderId: o3 }, data: { collectionDate: new Date('2026-01-01') } });
    const snapshot = async () => ({
      settlements: await prismaBase.partnerSettlement.count({ where: { tenantId } }),
      entries: await prismaBase.journalEntry.count({ where: { tenantId } }),
      collections: (await prismaBase.agentCollection.findMany({ where: { agentId: partner }, orderBy: { id: 'asc' } })).map((c) => [c.status, Number(c.allocatedAmount)]),
    });
    const before = await snapshot();

    const res = await preview(owner.token, { partnerId: partner, amount: 400 });
    expect(res.status).toBe(200);
    const p = res.body.preview;
    expect(p).toMatchObject({ unpaidTotal: '525.00', appliedAmount: '400.00', unappliedAmount: '0.00', leftUnpaid: '125.00', warnings: [] });
    expect(p.orders).toEqual([
      { orderId: o3, applied: '175.00', clearsOrder: true },
      { orderId: o1, applied: '175.00', clearsOrder: true },
      { orderId: o2, applied: '50.00', clearsOrder: false },
    ]);
    expect(await snapshot()).toEqual(before);

    const real = (await manual(owner.token, { partnerId: partner, amount: 400, reference: ref('PREV') })).body.settlement;
    expect(real.lines.map((l: any) => [l.orderId, l.expAmount])).toEqual(p.orders.map((o: any) => [o.orderId, o.applied]));
    expect(real.unappliedAmount).toBe(p.unappliedAmount);
    expect(real.expectedNet).toBe(p.unpaidTotal);
    expect(real.warnings).toEqual(p.warnings);
  });

  it('shows the amount held as unapplied, validates, and needs the permission', async () => {
    const partner = await mkPartner('mprev2');
    await deliver(partner);
    const res = await preview(owner.token, { partnerId: partner, amount: 300 });
    expect(res.body.preview).toMatchObject({ appliedAmount: '175.00', unappliedAmount: '125.00', leftUnpaid: '0.00' });
    expect(res.body.preview.warnings).toEqual(['GHS 125.00 will be held as unapplied (account 2040)']);
    expect((await preview(owner.token, { partnerId: partner, amount: 0 })).status).toBe(400);
    expect((await preview(owner.token, { partnerId: 'x', amount: 5 })).status).toBe(400);
    expect((await preview(owner.token, { partnerId: stock.id, amount: 5 })).status).toBe(404);
    expect((await preview(stock.token, { partnerId: partner, amount: 5 })).status).toBe(403);
    const empty = await preview(owner.token, { partnerId: await mkPartner('mprev3'), amount: 80 });
    expect(empty.body.preview).toMatchObject({ orders: [], unappliedAmount: '80.00' });
  });
});
