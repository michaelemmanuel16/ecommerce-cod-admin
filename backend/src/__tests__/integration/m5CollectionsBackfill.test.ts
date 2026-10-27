/**
 * M5-T30 (COD-52): backfill of old draft collections, October delivery fees and aging, on a fixture tenant.
 * Dry run writes nothing. Apply reconciles the drafts the recorded deposits cover and stamps the fee of a partner with a rule.
 * A second apply changes nothing. August and September ledger rows stay as they were (D5). Runs the real script.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { execFileSync } from 'child_process';
import path from 'path';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { cashHeldCheck, ledgerSnapshot, planDraftReconcile } from '../../services/collectionsBackfillService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';

jest.setTimeout(180_000);

const SCRIPT = 'scripts/backfill-collections-fees-aging.ts';
let tenantId: string;
let partnerId: number;
let noRuleId: number;
let adminId: number;
let customerId: number;
const orderIds: Record<string, number> = {};

const mkOrder = async (key: string, status: string, agentId: number, deliveryDate: string | null) =>
  (orderIds[key] = (await prismaBase.order.create({
    data: { customerId, status, subtotal: 100, totalAmount: 100, codAmount: 100, deliveryAgentId: agentId, tenantId, deliveryDate: deliveryDate ? new Date(deliveryDate) : null, paymentStatus: 'collected' } as any,
  })).id);
const mkCollection = async (key: string, agentId: number, amount: number, status: string, at: string) =>
  prismaBase.agentCollection.create({ data: { tenantId, orderId: orderIds[key], agentId, amount, status, collectionDate: new Date(at) } as any });
const mkEntry = async (date: string, n: number) => {
  const [cash, rev] = await Promise.all(['1010', '4010'].map((code) => prismaBase.account.findFirstOrThrow({ where: { tenantId, code } })));
  await prismaBase.journalEntry.create({
    data: {
      tenantId, entryNumber: `T30-${n}`, entryDate: new Date(date), description: 'fixture', sourceType: 'manual', createdBy: adminId,
      transactions: { create: [
        { tenantId, accountId: cash.id, debitAmount: 100, creditAmount: 0 },
        { tenantId, accountId: rev.id, debitAmount: 0, creditAmount: 100 },
      ] },
    } as any,
  });
};

/** Everything the script may write, as one comparable value. */
async function state() {
  const [collections, orders, entries, balances] = await Promise.all([
    prismaBase.agentCollection.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, status: true, amount: true, allocatedAmount: true } }),
    prismaBase.order.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, paymentStatus: true, deliveryFee: true, deliveryFeeSource: true } }),
    prismaBase.journalEntry.count({ where: { tenantId } }),
    prismaBase.agentBalance.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { agentId: true, totalCollected: true, totalDeposited: true, currentBalance: true } }),
  ]);
  return JSON.stringify({ collections, orders, entries, balances });
}

const run = (...args: string[]) =>
  execFileSync('npx', ['ts-node', SCRIPT, '--tenant', tenantId, ...args], {
    cwd: path.join(__dirname, '../../..'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' },
  });

beforeAll(async () => {
  tenantId = (await createTenant('T30 Backfill')).id;
  await seedTenantDefaults(tenantId);
  adminId = (await mkUser(tenantId, 'admin', 'super_admin')).id;
  partnerId = (await mkUser(tenantId, 'kofi', 'delivery_agent')).id;
  noRuleId = (await mkUser(tenantId, 'nana', 'delivery_agent')).id;
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(Date.now()).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;

  // Reconciled in August and September: 300. Recorded deposits: 500. So 200 of deposits cover no collection yet.
  await mkOrder('r1', 'delivered', partnerId, '2026-08-10T10:00:00Z'); await mkCollection('r1', partnerId, 200, 'reconciled', '2026-08-10');
  await mkOrder('r2', 'delivered', partnerId, '2026-09-10T10:00:00Z'); await mkCollection('r2', partnerId, 100, 'reconciled', '2026-09-10');
  // Three delivered drafts, oldest first: the surplus pays d1 and d2, d3 stays (October, fee 25 below)
  await mkOrder('d1', 'delivered', partnerId, '2026-09-11T10:00:00Z'); await mkCollection('d1', partnerId, 100, 'draft', '2026-09-11');
  await mkOrder('d2', 'delivered', partnerId, '2026-09-12T10:00:00Z'); await mkCollection('d2', partnerId, 100, 'draft', '2026-09-12');
  await mkOrder('d3', 'delivered', partnerId, '2026-10-10T10:00:00Z'); await mkCollection('d3', partnerId, 100, 'draft', '2026-10-10');
  await prismaBase.orderHistory.create({ data: { tenantId, orderId: orderIds.d3, status: 'delivered', fromStatus: 'out_for_delivery' } as any });
  // A draft on a cancelled order: not unpaid cash, left alone
  await mkOrder('x', 'cancelled', partnerId, null); await mkCollection('x', partnerId, 50, 'draft', '2026-09-20');
  // A partner with no fee rule: its October order is left alone
  await mkOrder('n1', 'delivered', noRuleId, '2026-10-11T10:00:00Z');
  await prismaBase.orderHistory.create({ data: { tenantId, orderId: orderIds.n1, status: 'delivered', fromStatus: 'out_for_delivery' } as any });

  await prismaBase.agentBalance.create({ data: { tenantId, agentId: partnerId, totalCollected: 650, totalDeposited: 500, currentBalance: 150 } });
  await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: partnerId, outcome: 'delivered', basis: 'flat', amount: 25, validFrom: new Date('2026-10-01') } as any });
  await mkEntry('2026-08-15T10:00:00Z', 1);
  await mkEntry('2026-09-15T10:00:00Z', 2);
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('collections backfill (M5-T30)', () => {
  it('plans the drafts and the cash held without writing', async () => {
    const before = await state();
    const plan = await planDraftReconcile(tenantId);
    expect(plan.drafts.count).toBe(4);
    expect(plan.delivered.count).toBe(3);
    expect(plan.notDelivered.count).toBe(1);
    expect(plan.reconcile.map((r) => r.orderId)).toEqual([orderIds.d1, orderIds.d2]);
    expect(plan.reconcileAmount.toString()).toBe('200');
    const [row] = await cashHeldCheck(tenantId);
    expect(row.expected.toString()).toBe('150');
    expect(row.withinLimit).toBe(true);
    expect(await state()).toBe(before);
  });

  it('dry run prints counts and writes nothing', async () => {
    const before = await state();
    const out = run();
    expect(out).toContain('DRY RUN');
    expect(out).toContain('draft collections: 4, 350.00');
    expect(out).toContain('covered by recorded deposits (would reconcile): 2, 200.00');
    expect(out).toContain('fees to stamp: 1 orders, 25.00; no fee rule (left alone): 1');
    expect(await state()).toBe(before);
  });

  it('apply reconciles the covered drafts, stamps the fee and leaves August and September alone', async () => {
    const ledgerBefore = await ledgerSnapshot(tenantId);
    expect(ledgerBefore.map((m) => m.entries)).toEqual([1, 1]);
    const out = run('--apply');
    expect(out).toContain('wrote: 2 collections reconciled, 1 fees stamped (25.00)');
    expect(out).toContain('UNCHANGED');

    const coll = async (key: string) => prismaBase.agentCollection.findUniqueOrThrow({ where: { orderId: orderIds[key] } });
    expect((await coll('d1')).status).toBe('reconciled');
    expect((await coll('d2')).status).toBe('reconciled');
    expect((await coll('d3')).status).toBe('draft');
    expect(Number((await coll('d3')).amount)).toBe(75); // held net of the fee, like a new collection
    expect((await coll('x')).status).toBe('draft');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderIds.d1 } })).paymentStatus).toBe('reconciled');

    const d3 = await prismaBase.order.findUniqueOrThrow({ where: { id: orderIds.d3 } });
    expect(Number(d3.deliveryFee)).toBe(25);
    expect(d3.deliveryFeeSource).toBe('rule');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderIds.n1 } })).deliveryFee).toBeNull();

    const feeEntries = await prismaBase.journalEntry.findMany({ where: { tenantId, sourceType: 'delivery_fee' }, include: { transactions: { include: { account: true } } } });
    expect(feeEntries).toHaveLength(1);
    expect(feeEntries[0].entryDate.toISOString().slice(0, 7)).toBe('2026-10');
    expect(feeEntries[0].transactions.find((t) => Number(t.debitAmount) === 25)!.account.code).toBe('5070');

    expect(await ledgerSnapshot(tenantId)).toEqual(ledgerBefore);
    const balance = await prismaBase.agentBalance.findFirstOrThrow({ where: { agentId: partnerId } });
    expect(Number(balance.currentBalance)).toBe(125);
    const [row] = await cashHeldCheck(tenantId);
    expect(row.expected.toString()).toBe('125');
    expect(row.diff.toString()).toBe('0');
    const plan = await planDraftReconcile(tenantId);
    expect(plan.delivered.count).toBe(1);
  });

  it('a second apply changes nothing', async () => {
    const before = await state();
    const out = run('--apply');
    expect(out).toContain('wrote: 0 collections reconciled, 0 fees stamped (0.00)');
    expect(await state()).toBe(before);
  });
});
