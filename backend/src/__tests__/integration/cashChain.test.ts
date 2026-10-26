/**
 * M5-T07 (COD-48): the cash chain (F-904). 1015 holds the cash partners hold, net of the delivery fee. A verified deposit
 * moves it to 1010 once. Verifying a collection posts nothing. Excess goes to 2040 with a Finding. A rejected deposit is
 * voided by a reversing entry. 1020 stays at 0 and takes no postings.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { FinancialSyncService } from '../../services/financialSyncService';
import agentReconciliationService from '../../services/agentReconciliationService';
import financialService from '../../services/financialService';
import { GLAccountService } from '../../services/glAccountService';
import { checkLedgerForTenant } from '../../services/ledgerCheckService';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'super_admin' };
let tenantId: string;
let customerId: number;
let kofiId: number;
let esiId: number;
let kwesiId: number;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const mkPartner = async (label: string) =>
  (await prismaBase.user.create({
    data: { email: `cc-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'P', role: 'delivery_agent', kind: 'person', tenantId },
  })).id;
/** An order delivered through the state machine, then synced the way the post-delivery queue does (transaction and draft collection). */
const deliver = async (partnerId: number, total = 200) => {
  const id = (await prismaBase.order.create({
    data: { customerId, status: 'out_for_delivery', subtotal: total, totalAmount: total, codAmount: total, deliveryAgentId: partnerId, tenantId } as any,
  })).id;
  await inTenant(() => transitionOrder(id, 'delivered', ADMIN));
  return id;
};
const sync = (ids: number[]) => inTenant(() => FinancialSyncService.batchSyncOrders(ids, ADMIN.userId));
const balance = async (code: string) =>
  Number((await prismaBase.account.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code } } })).currentBalance);
const linesOn = (code: string) => prismaBase.accountTransaction.findMany({ where: { tenantId, account: { code } } });
const entryCount = () => prismaBase.journalEntry.count({ where: { tenantId } });
const depositEntries = (depositId: number) =>
  prismaBase.journalEntry.findMany({
    where: { tenantId, sourceType: 'agent_deposit', sourceId: depositId },
    include: { transactions: { include: { account: true } } },
    orderBy: { id: 'asc' },
  });
const deposit = (partnerId: number, amount: number, ref: string) =>
  inTenant(() => agentReconciliationService.createDeposit(partnerId, amount, 'momo', ref));

beforeAll(async () => {
  tenantId = (await createTenant('Cash Chain')).id;
  await seedTenantDefaults(tenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  ADMIN.userId = (await prismaBase.user.create({
    data: { email: `cc-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Ada', lastName: 'Admin', role: 'super_admin', tenantId },
  })).id;
  kofiId = await mkPartner('kofi');
  esiId = await mkPartner('esi');
  kwesiId = await mkPartner('kwesi');
  await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: kofiId, outcome: 'delivered', amount: 25, validFrom: new Date('2026-01-01') } });
  await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: kwesiId, outcome: 'delivered', amount: 30, validFrom: new Date('2026-01-01') } });
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('delivery, collection, verified deposit', () => {
  let orders: number[];
  let depositId: number;

  it('three deliveries leave 1015 at gross minus fees and book draft collections at the net amount', async () => {
    orders = [await deliver(kofiId), await deliver(kofiId), await deliver(kofiId)];
    await sync(orders);

    expect(await balance('1015')).toBe(3 * (200 - 25));
    const collections = await prismaBase.agentCollection.findMany({ where: { orderId: { in: orders } } });
    expect(collections.map((c) => Number(c.amount))).toEqual([175, 175, 175]);
    expect(collections.every((c) => c.status === 'draft')).toBe(true);
    expect(Number((await prismaBase.agentBalance.findUniqueOrThrow({ where: { agentId: kofiId } })).currentBalance)).toBe(525);
    expect(await balance('1010')).toBe(0);
  });

  it('a verified deposit moves 1015 down once and 1010 up once', async () => {
    const created = await deposit(kofiId, 525, 'REF-KOFI-1');
    depositId = created.id;
    await inTenant(() => agentReconciliationService.verifyDeposit(depositId, ADMIN.userId!));

    expect(await balance('1015')).toBe(0);
    expect(await balance('1010')).toBe(525);
    const entries = await depositEntries(depositId);
    expect(entries).toHaveLength(1);
    const byCode = Object.fromEntries(entries[0].transactions.map((t) => [t.account.code, t]));
    expect(Number(byCode['1010'].debitAmount)).toBe(525);
    expect(Number(byCode['1015'].creditAmount)).toBe(525);
    expect(Object.keys(byCode).sort()).toEqual(['1010', '1015']);

    const collections = await prismaBase.agentCollection.findMany({ where: { orderId: { in: orders } } });
    expect(collections.every((c) => c.status === 'deposited' && Number(c.allocatedAmount) === 175)).toBe(true);
    expect(await prismaBase.finding.count({ where: { tenantId, type: 'excess_deposit' } })).toBe(0);
  });

  it('verifying the same deposit again posts nothing', async () => {
    const before = await entryCount();
    await expect(inTenant(() => agentReconciliationService.verifyDeposit(depositId, ADMIN.userId!))).rejects.toThrow();
    expect(await entryCount()).toBe(before);
    expect(await balance('1010')).toBe(525);
  });
});

describe('verifying a collection', () => {
  it('changes the status and posts no journal entry', async () => {
    const id = await deliver(kwesiId);
    await sync([id]);
    const collection = await prismaBase.agentCollection.findFirstOrThrow({ where: { orderId: id } });
    const before = await entryCount();
    const [b1015, b1010] = [await balance('1015'), await balance('1010')];

    await inTenant(() => agentReconciliationService.verifyCollection(collection.id, ADMIN.userId!));

    expect((await prismaBase.agentCollection.findUniqueOrThrow({ where: { id: collection.id } })).status).toBe('reconciled');
    expect(await entryCount()).toBe(before);
    expect(await balance('1015')).toBe(b1015);
    expect(await balance('1010')).toBe(b1010);
  });
});

describe('excess deposit and rejection', () => {
  let depositId: number;

  it('a deposit larger than the open collections posts the excess to 2040 and opens a Finding', async () => {
    const orders = [await deliver(esiId), await deliver(esiId)];
    await sync(orders);
    // The partner balance runs ahead of its open collections (for example after the old draft collections were reconciled by a backfill)
    await prismaBase.agentBalance.update({ where: { agentId: esiId }, data: { currentBalance: 600 } });
    const [b1015, b1010, b2040] = [await balance('1015'), await balance('1010'), await balance('2040')];

    const created = await deposit(esiId, 500, 'REF-ESI-1');
    depositId = created.id;
    await inTenant(() => agentReconciliationService.verifyDeposit(depositId, ADMIN.userId!));

    expect(await balance('1010')).toBe(b1010 + 500);
    expect(await balance('1015')).toBe(b1015 - 400);
    expect(await balance('2040')).toBe(b2040 + 100);
    const [entry] = await depositEntries(depositId);
    expect(entry.transactions.map((t) => [t.account.code, Number(t.debitAmount), Number(t.creditAmount)]).sort())
      .toEqual([['1010', 500, 0], ['1015', 0, 400], ['2040', 0, 100]]);
    const finding = await prismaBase.finding.findFirstOrThrow({ where: { tenantId, type: 'excess_deposit', subjectId: String(depositId) } });
    expect(finding.status).toBe('open');
    expect(Number(finding.amount)).toBe(100);
  });

  it('a deposit rejected after posting leaves a reversing entry and puts everything back', async () => {
    const [b1015, b1010, b2040] = [await balance('1015'), await balance('1010'), await balance('2040')];
    await inTenant(() => agentReconciliationService.rejectDeposit(depositId, ADMIN.userId!, 'Receipt is unclear'));

    const entries = await depositEntries(depositId);
    expect(entries).toHaveLength(1);
    expect(entries[0].isVoided).toBe(true);
    const reversal = await prismaBase.journalEntry.findFirstOrThrow({
      where: { tenantId, sourceType: 'reversal', sourceId: depositId }, include: { transactions: { include: { account: true } } },
    });
    expect(reversal.transactions.map((t) => [t.account.code, Number(t.debitAmount), Number(t.creditAmount)]).sort())
      .toEqual([['1010', 0, 500], ['1015', 400, 0], ['2040', 100, 0]]);
    expect(await balance('1010')).toBe(b1010 - 500);
    expect(await balance('1015')).toBe(b1015 + 400);
    expect(await balance('2040')).toBe(b2040 - 100);

    const saved = await prismaBase.agentDeposit.findUniqueOrThrow({ where: { id: depositId } });
    expect(saved.status).toBe('rejected');
    expect(saved.rejectReason).toBe('Receipt is unclear');
    expect(Number((await prismaBase.agentBalance.findUniqueOrThrow({ where: { agentId: esiId } })).currentBalance)).toBe(600);
    const collections = await prismaBase.agentCollection.findMany({ where: { agentId: esiId } });
    expect(collections.every((c) => c.status === 'draft' && Number(c.allocatedAmount) === 0)).toBe(true);
    expect((await prismaBase.finding.findFirstOrThrow({ where: { tenantId, type: 'excess_deposit', subjectId: String(depositId) } })).status).toBe('closed');
  });
});

describe('the old "mark COD deposited" route', () => {
  it('posts the same entry (DR 1010, CR 1015) for the net amount, once', async () => {
    const orders = [await deliver(kofiId), await deliver(kofiId)];
    await sync(orders);
    const transactions = await prismaBase.transaction.findMany({ where: { orderId: { in: orders }, type: 'cod_collection' } });
    expect(transactions).toHaveLength(2);
    const [b1015, b1010] = [await balance('1015'), await balance('1010')];

    const requester = { id: ADMIN.userId!, role: 'super_admin' } as any;
    await inTenant(() => financialService.markCODAsDeposited(transactions.map((t) => String(t.id)), 'DEP-OLD-1', requester));

    expect(await balance('1010')).toBe(b1010 + 350);
    expect(await balance('1015')).toBe(b1015 - 350);
    await expect(inTenant(() => financialService.markCODAsDeposited(transactions.map((t) => String(t.id)), 'DEP-OLD-1', requester)))
      .rejects.toThrow();
    expect(await balance('1010')).toBe(b1010 + 350);
  });
});

describe('after the whole chain', () => {
  it('1020 is 0 and has no postings; so do 5040 and 2030', async () => {
    expect(await balance('1020')).toBe(0);
    for (const code of ['1020', '5040', '2030']) expect(await linesOn(code)).toHaveLength(0);
  });

  it('the nightly balance check and the order-versus-ledger check pass', async () => {
    const balances = await inTenant(() => GLAccountService.verifyAllAccountBalances());
    expect(balances.unbalanced).toEqual([]);
    const ledger = await checkLedgerForTenant(tenantId);
    expect(ledger.gapDays).toEqual([]);
  });
});
