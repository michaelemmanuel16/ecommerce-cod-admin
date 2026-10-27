/**
 * M5-T18 (COD-51, F-914): commission posting, the reversal on a return, and the backfill of open delivered orders.
 * DR 5050 / CR 2020 per earned entry, idempotent per entry. A return voids the open entries and reverses the posting.
 * After the backfill, account 2020 equals the sum of the unpaid earned entries.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { postEntry } from '../../services/commissionService';
import { applyCommissionBackfill, commissionLedgerCheck, planCommissionBackfill } from '../../services/commissionBackfillService';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { accountBalance } from './helpers/ledgerPost';

jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerStatusChangeWorkflows: () => Promise.resolve() },
}));

const SUFFIX = Date.now();
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'super_admin' };
let tenantId: string;
let customerId: number;
let agentId: number;
let adwoaId: number; // rate 7: the delivery entry books her commission
let freeRepId: number; // rate 0: nothing booked at delivery
let aiRepId: number;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const move = (id: number, to: any, options: any = {}) => inTenant(() => transitionOrder(id, to, ADMIN, options));
const mkOrder = async (status: any, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: { customerId, status, subtotal: 100, totalAmount: 100, codAmount: 100, deliveryAgentId: agentId, tenantId, ...extra } as any,
  })).id;
const mkEntry = (orderId: number | null, userId: number, amount: number, extra: Record<string, unknown> = {}) =>
  prismaBase.commissionEntry.create({ data: { tenantId, orderId, userId, kind: 'base', status: 'earned', amount, earnedAt: new Date('2026-10-05T10:00:00Z'), ...extra } as any });
const balance = (code: string) => accountBalance(tenantId, code);
const post = (entryId: number) => inTenant(() => prisma.$transaction((tx) => postEntry(tx, entryId, ADMIN.userId!)));
const jeFor = (entryId: number) => prismaBase.journalEntry.findMany({
  where: { tenantId, sourceType: 'commission_accrual', sourceId: entryId },
  include: { transactions: { include: { account: true } } },
  orderBy: { id: 'asc' },
});

const tenantIds: string[] = [];

/** A fresh tenant with a customer, a partner, reps (rate 7, rate 0, AI agent) and an admin. Sets the module variables. */
async function setupTenant(label: string) {
  tenantId = (await createTenant(label)).id;
  tenantIds.push(tenantId);
  await seedTenantDefaults(tenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-7)}${tenantIds.length}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  const user = async (name: string, role: string, extra: Record<string, unknown> = {}) =>
    (await prismaBase.user.create({
      data: { email: `${name}-${tenantIds.length}-${SUFFIX}@codadmin.test`, password: 'x', firstName: name, lastName: 'T', role, tenantId, ...extra } as any,
    })).id;
  agentId = await user('kofi', 'delivery_agent');
  adwoaId = await user('adwoa', 'sales_rep', { commissionAmount: 7 });
  freeRepId = await user('esi', 'sales_rep', { commissionAmount: 0 });
  aiRepId = await user('bot', 'sales_rep', { commissionAmount: 7, kind: 'ai_agent' });
  ADMIN.userId = await user('admin', 'super_admin');
}

beforeAll(() => setupTenant('Commission Tenant'), 30000);

afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('posting an earned entry (M5-T18)', () => {
  it('posts DR 5050 / CR 2020 once; a repeat posts nothing', async () => {
    const before = { exp: await balance('5050'), pay: await balance('2020') };
    const entry = await mkEntry(null, adwoaId, 8);

    const first = await post(entry.id);
    expect(first.posted).toBe(true);
    const second = await post(entry.id);
    expect(second.posted).toBe(false);
    expect(second.entry.journalEntryId).toBe(first.entry.journalEntryId);

    const journals = await jeFor(entry.id);
    expect(journals).toHaveLength(1);
    const debit = journals[0].transactions.find((t) => Number(t.debitAmount) > 0)!;
    const credit = journals[0].transactions.find((t) => Number(t.creditAmount) > 0)!;
    expect(debit.account.code).toBe('5050');
    expect(credit.account.code).toBe('2020');
    expect(Number(debit.debitAmount)).toBe(8);
    expect(await balance('5050')).toBe(before.exp + 8);
    expect(await balance('2020')).toBe(before.pay + 8);
  });

  it('two posts at the same moment still post once', async () => {
    const entry = await mkEntry(null, adwoaId, 3);
    await Promise.all([post(entry.id), post(entry.id)]);
    expect(await jeFor(entry.id)).toHaveLength(1);
  });

  it('refuses an entry that is not earned and an entry of zero', async () => {
    const paid = await mkEntry(null, adwoaId, 3, { status: 'paid' });
    await expect(post(paid.id)).rejects.toThrow(/Only earned/);
    const zero = await mkEntry(null, adwoaId, 0);
    await expect(post(zero.id)).rejects.toThrow(/zero/);
  });
});

describe('a return voids the entry and reverses the posting (M5-T18)', () => {
  it('an entry this service posted: DR 2020 / CR 5050 for its amount, status void, 2020 back to where it was', async () => {
    const orderId = await mkOrder('delivered', { customerRepId: freeRepId });
    const entry = await mkEntry(orderId, freeRepId, 9);
    const before = { exp: await balance('5050'), pay: await balance('2020') };
    await post(entry.id);
    expect(await balance('2020')).toBe(before.pay + 9);

    await move(orderId, 'returned');

    const after = await prismaBase.commissionEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('void');
    const journals = await jeFor(entry.id);
    expect(journals.map((j) => j.sourceType)).toEqual(['commission_accrual', 'commission_accrual']);
    const reversal = journals[1];
    expect(reversal.transactions.find((t) => Number(t.debitAmount) > 0)!.account.code).toBe('2020');
    expect(reversal.transactions.find((t) => Number(t.creditAmount) > 0)!.account.code).toBe('5050');
    expect(await balance('2020')).toBe(before.pay);
    expect(await balance('5050')).toBe(before.exp);

    // A repeat of the move changes nothing
    await move(orderId, 'returned');
    expect(await jeFor(entry.id)).toHaveLength(2);
  });

  it('an entry on top of a delivery entry that booked the same commission: the return takes back each once, 2020 nets 0', async () => {
    const orderId = await mkOrder('out_for_delivery', { customerRepId: adwoaId });
    await move(orderId, 'delivered'); // the delivery entry books DR 5050 / CR 2020 of 7 (Adwoa's rate)
    const entry = await mkEntry(orderId, adwoaId, 7);
    const before = await balance('2020');
    await post(entry.id);
    await move(orderId, 'returned');
    // The revenue reversal takes back its 7, the entry reversal takes back its own 7: nothing is reversed twice
    expect(await balance('2020')).toBe(before - 7);
    expect(await jeFor(entry.id)).toHaveLength(2);
  });

  it('a paid entry is left alone; an entry never posted voids with no ledger line', async () => {
    const orderId = await mkOrder('delivered', { customerRepId: freeRepId });
    const paid = await mkEntry(orderId, freeRepId, 4, { status: 'paid' });
    const open = await mkEntry(orderId, freeRepId, 6, { kind: 'upsell' });
    await move(orderId, 'returned');
    expect((await prismaBase.commissionEntry.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('paid');
    expect((await prismaBase.commissionEntry.findUniqueOrThrow({ where: { id: open.id } })).status).toBe('void');
    expect(await jeFor(open.id)).toHaveLength(0);
  });
});

describe('backfill of open delivered orders (M5-T18)', () => {
  let adoptedOrder: number;
  let postedOrder: number;
  let paidOrder: number;

  // A fresh tenant, so account 2020 holds nothing but this describe's postings
  beforeAll(() => setupTenant('Commission Backfill'), 30000);

  it('plans the right orders and prints a count and a total before it writes', async () => {
    // Delivered through the machine at Adwoa's rate 7: the delivery entry books DR 5050 / CR 2020 of 7
    adoptedOrder = await mkOrder('out_for_delivery', { customerRepId: adwoaId });
    await move(adoptedOrder, 'delivered');
    // Delivered with no journal entry (an old order): the backfill posts its own
    postedOrder = await mkOrder('delivered', { customerRepId: adwoaId, deliveryDate: new Date('2026-10-02T09:00:00Z') });
    // Not open: already paid, rep with rate 0, AI agent, no rep, not delivered
    paidOrder = await mkOrder('delivered', { customerRepId: adwoaId, commissionPaid: true });
    await mkOrder('delivered', { customerRepId: freeRepId });
    await mkOrder('delivered', { customerRepId: aiRepId });
    await mkOrder('delivered');
    await mkOrder('confirmed', { customerRepId: adwoaId });

    const plan = await planCommissionBackfill(tenantId);
    expect(plan.rows.map((r) => r.orderId).sort()).toEqual([adoptedOrder, postedOrder].sort());
    expect(plan.rows).toHaveLength(2);
    expect(plan.total.toString()).toBe('14');
    expect(plan.adopted).toBe(1);
    expect(plan.rows.length - plan.adopted).toBe(1);
    expect(plan.rows.find((r) => r.orderId === adoptedOrder)!.adoptJournalEntryId).not.toBeNull();
    expect(plan.rows.find((r) => r.orderId === postedOrder)!.earnedAt.toISOString()).toBe('2026-10-02T09:00:00.000Z');
    // A dry run (plan only) wrote nothing
    expect(await prismaBase.commissionEntry.count({ where: { orderId: { in: [adoptedOrder, postedOrder] } } })).toBe(0);
  });

  it('after the run, 2020 equals the sum of the unpaid earned entries; a second run writes nothing', async () => {
    const plan = await planCommissionBackfill(tenantId);
    const written = await applyCommissionBackfill(tenantId, plan);
    expect(written.written).toBe(2);
    expect(written.total.toString()).toBe('14');

    const check = await commissionLedgerCheck(tenantId);
    expect(check.openEntries.toString()).toBe('14');
    // The adopted entry added nothing to 2020 (the delivery entry booked 7), the posted one added 7
    expect(check.payableBalance.toString()).toBe('14');
    expect(check.difference.toString()).toBe('0');

    const entries = await prismaBase.commissionEntry.findMany({ where: { orderId: { in: [adoptedOrder, postedOrder] } }, orderBy: { orderId: 'asc' } });
    expect(entries.map((e) => [e.status, e.kind, Number(e.amount)])).toEqual([['earned', 'base', 7], ['earned', 'base', 7]]);
    expect(entries.every((e) => e.journalEntryId !== null)).toBe(true);

    // The same plan again (a stale or concurrent run) skips orders that now have an entry; a fresh plan is empty
    const again = await applyCommissionBackfill(tenantId, plan);
    expect(again.written).toBe(0);
    expect((await planCommissionBackfill(tenantId)).rows).toHaveLength(0);
    expect(await prismaBase.commissionEntry.count({ where: { orderId: paidOrder } })).toBe(0);
  });

  it('a return after the backfill voids the adopted entry without a second reversal', async () => {
    const before = await balance('2020');
    await move(adoptedOrder, 'returned');
    // The order revenue reversal takes the 7 back once; the entry needs no extra line
    expect(await balance('2020')).toBe(before - 7);
    const entry = await prismaBase.commissionEntry.findFirstOrThrow({ where: { orderId: adoptedOrder } });
    expect(entry.status).toBe('void');
    expect(await jeFor(entry.id)).toHaveLength(0);
  });
});
