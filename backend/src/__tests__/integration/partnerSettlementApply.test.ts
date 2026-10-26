/**
 * M5-T11 (COD-49): settlement matching and auto-reconcile (F-906, F-904, F-909). Fixture: Kofi keeps GH₵25 on each delivered
 * order of GH₵200, so each collection holds 175 and 1015 holds the net cash. A payout list matches lines to orders,
 * reconciles the collections, posts one deposit, trues up fees and opens Findings for gaps.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { FinancialSyncService } from '../../services/financialSyncService';
import { recordPartnerPayout, parsePartnerPayout } from '../../services/partnerSettlementService';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'super_admin' };
let tenantId: string;
let otherTenantId: string;
let customerId: number;
let kofiId: number;
let otherPartnerId: number;
let refSeq = 0;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const mkPartner = async (label: string, tid = tenantId) =>
  (await prismaBase.user.create({
    data: { email: `ps-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'P', role: 'delivery_agent', kind: 'person', tenantId: tid },
  })).id;
const mkCustomer = async (phone: string) =>
  (await prismaBase.customer.create({ data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: phone, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId } })).id;
/** An order delivered through the state machine, then synced the way the post-delivery queue does (draft collection). */
const deliver = async (partnerId: number, total = 200, cust = customerId) => {
  const id = (await prismaBase.order.create({
    data: { customerId: cust, status: 'out_for_delivery', subtotal: total, totalAmount: total, codAmount: total, deliveryAgentId: partnerId, tenantId } as any,
  })).id;
  await inTenant(() => transitionOrder(id, 'delivered', ADMIN));
  await inTenant(() => FinancialSyncService.batchSyncOrders([id], ADMIN.userId));
  return id;
};
const balance = async (code: string) =>
  Number((await prismaBase.account.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code } } })).currentBalance);
const collectionOf = (orderId: number) => prismaBase.agentCollection.findUniqueOrThrow({ where: { orderId } });
const orderOf = (id: number) => prismaBase.order.findUniqueOrThrow({ where: { id } });
const findings = (type: string) => prismaBase.finding.findMany({ where: { tenantId, type: type as any }, orderBy: { id: 'asc' } });
const ref = (label: string) => `${label}-${++refSeq}`;
const payout = (partnerId: number, reference: string, payoutAmount: number, lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  inTenant(() => recordPartnerPayout({ id: ADMIN.userId! }, parsePartnerPayout({ partnerId, payoutDate: '2026-10-20', payoutAmount, reference, lines, ...extra })));
const line = (orderId: number, charge = 25, extra: Record<string, unknown> = {}) => ({ externalOrderRef: `#${orderId}`, orderId, expAmount: 200, charge, ...extra });

beforeAll(async () => {
  tenantId = (await createTenant('Settlement Apply')).id;
  otherTenantId = (await createTenant('Settlement Apply Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  customerId = await mkCustomer(`+2332${String(SUFFIX).slice(-8)}`);
  ADMIN.userId = (await prismaBase.user.create({
    data: { email: `ps-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Ada', lastName: 'Admin', role: 'super_admin', tenantId },
  })).id;
  kofiId = await mkPartner('kofi');
  otherPartnerId = await mkPartner('other');
  await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: kofiId, outcome: 'delivered', amount: 25, validFrom: new Date('2026-01-01') } });
  await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: otherPartnerId, outcome: 'delivered', amount: 25, validFrom: new Date('2026-01-01') } });
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('a paid list with known charges (expected net = collected minus fees, F4)', () => {
  let a: number; let b: number; let c: number; let d: number;
  let result: Awaited<ReturnType<typeof payout>>;
  let before: { b1015: number; b1010: number; b5070: number };

  beforeAll(async () => {
    [a, b, c, d] = [await deliver(kofiId), await deliver(kofiId), await deliver(kofiId), await deliver(kofiId)];
    before = { b1015: await balance('1015'), b1010: await balance('1010'), b5070: await balance('5070') };
    // Charges 25, 25 and 35: the third is GH₵10 more than the fee booked at delivery. Expected net 175 + 175 + 165 = 515.
    result = await payout(kofiId, ref('APPLY'), 515, [line(a), line(b), line(c, 35)]);
  });

  it('is matched: expected net equals the payout and every line has its order', () => {
    expect(result).toMatchObject({ status: 'matched', expectedNet: '515.00', payoutAmount: '515.00', shortAmount: '0.00', unappliedAmount: '0.00', matchedLines: 3, unmatchedLines: 0, replayed: false });
    expect(result.lines.map((l) => [l.orderId, l.matched, l.matchedBy])).toEqual([[a, true, 'order_id'], [b, true, 'order_id'], [c, true, 'order_id']]);
  });

  it('matched collections become reconciled with their order and line; the order not in the list stays unpaid', async () => {
    for (const [i, id] of [a, b, c].entries()) {
      const coll = await collectionOf(id);
      expect(coll.status).toBe('reconciled');
      expect(coll.settlementLineId).toBe(result.lines[i].id);
      expect((await orderOf(id)).paymentStatus).toBe('reconciled');
    }
    expect((await collectionOf(d)).status).toBe('draft');
    expect((await orderOf(d)).paymentStatus).not.toBe('reconciled');
  });

  it('posts one deposit for the net amount, linked to the settlement, and moves the cash once', async () => {
    const deposits = await prismaBase.agentDeposit.findMany({ where: { tenantId, settlementId: result.id } });
    expect(deposits).toHaveLength(1);
    expect(deposits[0]).toMatchObject({ status: 'verified', depositMethod: 'partner_payout', agentId: kofiId });
    expect(Number(deposits[0].amount)).toBe(515);
    expect(result.depositId).toBe(deposits[0].id);
    const entries = await prismaBase.journalEntry.findMany({ where: { tenantId, sourceType: 'agent_deposit', sourceId: deposits[0].id }, include: { transactions: { include: { account: true } } } });
    expect(entries).toHaveLength(1);
    expect(entries[0].transactions.map((t) => [t.account.code, Number(t.debitAmount), Number(t.creditAmount)]).sort()).toEqual([['1010', 515, 0], ['1015', 0, 515]]);
    expect(await balance('1010')).toBe(before.b1010 + 515);
    expect(await balance('1020')).toBe(0);
  });

  it('trues up the fee: the order and its collection take the real charge, and only the difference is booked to 5070', async () => {
    const order = await orderOf(c);
    expect(Number(order.deliveryFee)).toBe(35);
    expect(order.deliveryFeeSource).toBe('settlement');
    expect(Number((await collectionOf(c)).amount)).toBe(165);
    expect(Number((await orderOf(a)).deliveryFee)).toBe(25);
    expect((await orderOf(a)).deliveryFeeSource).toBe('rule');

    const entry = await prismaBase.journalEntry.findFirstOrThrow({ where: { tenantId, sourceType: 'delivery_fee', externalRef: `trueup:${result.id}` }, include: { transactions: { include: { account: true } } } });
    expect(entry.transactions.map((t) => [t.account.code, Number(t.debitAmount), Number(t.creditAmount)]).sort()).toEqual([['1015', 0, 10], ['5070', 10, 0]]);
    expect(await balance('5070')).toBe(before.b5070 + 10);
    // 1015 held the net of all four orders (700); it falls by the true-up (10) and the deposit (515): d's 175 is left
    expect(await balance('1015')).toBe(before.b1015 - 10 - 515);
    expect(await balance('1015')).toBe(175);
  });

  it('keeps the partner balance in step with the collections', async () => {
    const bal = await prismaBase.agentBalance.findUniqueOrThrow({ where: { agentId: kofiId } });
    expect(Number(bal.currentBalance)).toBe(175);
    expect(Number(bal.totalCollected)).toBe(700 - 10);
    expect(Number(bal.totalDeposited)).toBe(515);
  });

  it('opens a charge_variance Finding for the line over the 5 percent limit and marks the settlement for review', async () => {
    const found = await findings('charge_variance');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ subjectType: 'settlement_line', subjectId: String(result.lines[2].id), status: 'open' });
    expect(Number(found[0].amount)).toBe(10);
    expect(result.needsReview).toBe(true);
    expect(result.findings.map((f) => f.type)).toContain('charge_variance');
  });

  it('sending the payload again changes nothing', async () => {
    const counts = async () => ({
      settlements: await prismaBase.partnerSettlement.count({ where: { tenantId } }),
      deposits: await prismaBase.agentDeposit.count({ where: { tenantId } }),
      entries: await prismaBase.journalEntry.count({ where: { tenantId } }),
      findings: await prismaBase.finding.count({ where: { tenantId } }),
      b1015: await balance('1015'), b1010: await balance('1010'), b5070: await balance('5070'),
    });
    const before2 = await counts();
    const again = await payout(kofiId, result.reference, 515, [line(a), line(b), line(c, 35)]);
    expect(again).toMatchObject({ id: result.id, replayed: true });
    expect(await counts()).toEqual(before2);
  });
});

describe('gaps', () => {
  it('a line with no order, another partner\'s order, and an order not delivered are unmatched lines; their cash is held in 2040', async () => {
    const mine = await deliver(kofiId);
    const theirs = await deliver(otherPartnerId);
    const onTheRoad = (await prismaBase.order.create({
      data: { customerId, status: 'out_for_delivery', subtotal: 200, totalAmount: 200, codAmount: 200, deliveryAgentId: kofiId, tenantId } as any,
    })).id;
    const [b1015, b1010, b2040] = [await balance('1015'), await balance('1010'), await balance('2040')];

    // Four lines of 175 net each; only the first matches. The partner paid all four.
    const result = await payout(kofiId, ref('GAPS'), 700, [line(mine), line(theirs), line(onTheRoad), { externalOrderRef: 'ZZ-404', expAmount: 200, charge: 25 }]);
    expect(result).toMatchObject({ status: 'unmatched', matchedLines: 1, unmatchedLines: 3, expectedNet: '175.00', unappliedAmount: '525.00' });
    expect(result.lines.map((l) => l.note)).toEqual([
      null, 'The order belongs to another delivery partner', 'The order is out for delivery, not delivered', 'No order matches this line',
    ]);
    expect((await collectionOf(mine)).status).toBe('reconciled');
    expect((await collectionOf(theirs)).status).toBe('draft');
    expect((await orderOf(onTheRoad)).paymentStatus).not.toBe('reconciled');

    expect(await balance('1010')).toBe(b1010 + 700);
    expect(await balance('1015')).toBe(b1015 - 175);
    expect(await balance('2040')).toBe(b2040 + 525);
    const unmatched = (await findings('unmatched_line')).filter((f) => result.lines.some((l) => String(l.id) === f.subjectId));
    expect(unmatched).toHaveLength(3);
    expect(unmatched.every((f) => Number(f.amount) === 175 && f.status === 'open')).toBe(true);
    expect(result.warnings[0]).toMatch(/525\.00 .* held as unapplied/);
    // The cash above the open collections is reported once, as an excess deposit (not again as over_pay)
    expect(result.findings.map((f) => f.type)).toContain('excess_deposit');
    expect(result.findings.map((f) => f.type)).not.toContain('over_pay');
  });

  it('a payout above the expected net with every line matched is over, the excess goes to 2040', async () => {
    const x = await deliver(kofiId);
    const b2040 = await balance('2040');
    const result = await payout(kofiId, ref('OVER'), 200, [line(x)]);
    expect(result).toMatchObject({ status: 'over', expectedNet: '175.00', unappliedAmount: '25.00', shortAmount: '0.00' });
    expect(await balance('2040')).toBe(b2040 + 25);
    expect((await collectionOf(x)).status).toBe('reconciled');
  });

  it('a payout below the expected net is short: the oldest orders are paid first and a short_pay Finding opens', async () => {
    const [x, y] = [await deliver(kofiId), await deliver(kofiId)];
    const result = await payout(kofiId, ref('SHORT'), 300, [line(x), line(y)]);
    expect(result).toMatchObject({ status: 'short', expectedNet: '350.00', shortAmount: '50.00', unappliedAmount: '0.00' });
    expect((await collectionOf(x)).status).toBe('reconciled');
    const second = await collectionOf(y);
    expect(second.status).toBe('draft');
    expect(Number(second.allocatedAmount)).toBe(125);
    const finding = (await findings('short_pay')).find((f) => f.subjectId === String(result.id))!;
    expect(finding).toMatchObject({ subjectType: 'partner_settlement', status: 'open' });
    expect(Number(finding.amount)).toBe(50);
  });

  it('a later payout that covers the rest closes the short_pay Finding as explained', async () => {
    const [x, y] = [await deliver(kofiId), await deliver(kofiId)];
    const short = await payout(kofiId, ref('SHORT2'), 300, [line(x), line(y)]);
    const open = (await findings('short_pay')).find((f) => f.subjectId === String(short.id))!;
    expect(open.status).toBe('open');

    const later = await payout(kofiId, ref('TOPUP'), 50, [line(y)]);
    // The list expects only what is still due on the order: 175 less the 125 paid before
    expect(later).toMatchObject({ matchedLines: 1, status: 'matched', expectedNet: '50.00' });
    expect((await collectionOf(y)).status).toBe('reconciled');
    const closed = await prismaBase.finding.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed).toMatchObject({ status: 'explained', explanation: `Cleared by settlement ${later.reference}` });
  });

  it('matches by order number and by customer phone with the amount when no order id is sent', async () => {
    const phone = `+2332${String(SUFFIX + 7).slice(-8)}`;
    const phoneCustomer = await mkCustomer(phone);
    const byNumber = await deliver(kofiId);
    const byPhone = await deliver(kofiId, 200, phoneCustomer);
    const result = await payout(kofiId, ref('KEYS'), 350, [
      { externalOrderRef: String(byNumber), expAmount: 200, charge: 25 },
      { externalOrderRef: phone, expAmount: 200, charge: 25 },
    ]);
    expect(result.lines.map((l) => [l.orderId, l.matchedBy])).toEqual([[byNumber, 'order_number'], [byPhone, 'phone_amount']]);
    expect(result.status).toBe('matched');
  });

  it('an order of another tenant is not found', async () => {
    const foreign = (await prismaBase.customer.create({
      data: { firstName: 'B', lastName: 'B', phoneNumber: `+2332${String(SUFFIX + 9).slice(-8)}`, address: 'x', state: 'x', area: 'x', tenantId: otherTenantId },
    })).id;
    const orderB = (await prismaBase.order.create({
      data: { customerId: foreign, status: 'delivered', subtotal: 200, totalAmount: 200, codAmount: 200, tenantId: otherTenantId } as any,
    })).id;
    const result = await payout(kofiId, ref('TENANT'), 175, [line(orderB)]);
    expect(result.lines[0]).toMatchObject({ matched: false, note: `Order ${orderB} was not found` });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderB } })).paymentStatus).not.toBe('reconciled');
  });
});

describe('concurrency', () => {
  it('two payouts listing the same order: the cash is covered once, the second payout is held as unapplied', async () => {
    const x = await deliver(kofiId);
    const [b1015, b1010, b2040] = [await balance('1015'), await balance('1010'), await balance('2040')];
    const [r1, r2] = await Promise.all([
      payout(kofiId, ref('RACE-A'), 175, [line(x)]),
      payout(kofiId, ref('RACE-B'), 175, [line(x)]),
    ]);
    expect([r1.matchedLines, r2.matchedLines].sort()).toEqual([0, 1]);
    expect((await collectionOf(x)).status).toBe('reconciled');
    expect(Number((await collectionOf(x)).allocatedAmount)).toBe(175);
    expect(await balance('1010')).toBe(b1010 + 350);
    expect(await balance('1015')).toBe(b1015 - 175);
    expect(await balance('2040')).toBe(b2040 + 175);
    expect(await prismaBase.agentDeposit.count({ where: { tenantId, settlementId: { in: [r1.id, r2.id] } } })).toBe(2);
  });

  it('the same reference at once: one settlement, one deposit', async () => {
    const x = await deliver(kofiId);
    const reference = ref('RACE-SAME');
    const [r1, r2] = await Promise.all([payout(kofiId, reference, 175, [line(x)]), payout(kofiId, reference, 175, [line(x)])]);
    expect(r1.id).toBe(r2.id);
    expect([r1.replayed, r2.replayed].sort()).toEqual([false, true]);
    expect(await prismaBase.agentDeposit.count({ where: { tenantId, settlementId: r1.id } })).toBe(1);
  });
});

describe('the ledger stays balanced', () => {
  it('1020 stays 0 and every account balance equals the sum of its lines', async () => {
    expect(await balance('1020')).toBe(0);
    const accounts = await prismaBase.account.findMany({ where: { tenantId }, include: { transactions: true } });
    for (const acc of accounts) {
      const sum = acc.transactions.reduce((s, t) => s + (acc.normalBalance === 'debit' ? Number(t.debitAmount) - Number(t.creditAmount) : Number(t.creditAmount) - Number(t.debitAmount)), 0);
      expect({ code: acc.code, balance: Number(acc.currentBalance) }).toEqual({ code: acc.code, balance: Math.round(sum * 100) / 100 });
    }
  });
});
