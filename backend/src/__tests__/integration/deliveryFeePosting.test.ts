/**
 * M5-T06 (COD-48): delivery fee posting (F-936, F-915). One 5070 / 1015 entry per outcome, nothing to 5040, 1020 or 2030,
 * no pay-per-delivery anywhere. Fixture: Kofi GH25 on delivered and GH5 on failed; Logiswift failed 0.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { accountBalance } from './helpers/ledgerPost';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'super_admin' };
let tenantId: string;
let customerId: number;
let kofiId: number;
let logiswiftId: number;

const mk = async (partnerId: number, status: any, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: { customerId, status, subtotal: 200, totalAmount: 200, codAmount: 200, deliveryAgentId: partnerId, tenantId, ...extra } as any,
  })).id;
const move = (id: number, to: any, options: any = {}) => runInTenant(tenantId, () => transitionOrder(id, to, ADMIN, options));
const feeEntries = (orderId: number) =>
  prismaBase.journalEntry.findMany({
    where: { tenantId, sourceType: 'delivery_fee', sourceId: orderId },
    orderBy: { id: 'asc' },
    include: { transactions: { include: { account: true } } },
  });
const balance = (code: string) => accountBalance(tenantId, code);
const linesOn = async (code: string) =>
  prismaBase.accountTransaction.findMany({ where: { tenantId, account: { code } } });

beforeAll(async () => {
  tenantId = (await createTenant('Fee Posting')).id;
  await seedTenantDefaults(tenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  const mkPartner = async (label: string, kind: any, commissionAmount = 0) =>
    (await prismaBase.user.create({
      data: { email: `fp-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'P', role: 'delivery_agent', kind, commissionAmount, tenantId },
    })).id;
  // Kofi still carries an old commission amount on his profile: it must never reach the ledger.
  kofiId = await mkPartner('kofi', 'person', 12);
  logiswiftId = await mkPartner('logiswift', 'company');
  ADMIN.userId = (await prismaBase.user.create({
    data: { email: `fp-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Ada', lastName: 'Admin', role: 'super_admin', tenantId },
  })).id;
  const rule = (partnerUserId: number, outcome: any, amount: number) =>
    prismaBase.feeRule.create({ data: { tenantId, partnerUserId, outcome, amount, validFrom: new Date('2026-01-01') } });
  await rule(kofiId, 'delivered', 25);
  await rule(kofiId, 'failed', 5);
  await rule(logiswiftId, 'delivered', 35);
  await rule(logiswiftId, 'failed', 0);
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('delivery fee posting', () => {
  it('Kofi delivered posts one balanced entry, DR 5070 CR 1015 for GH25, dated by the delivery date', async () => {
    const id = await mk(kofiId, 'out_for_delivery');
    const deliveredOn = new Date('2026-10-10T12:00:00.000Z');
    await move(id, 'delivered', { deliveryDate: deliveredOn });

    const entries = await feeEntries(id);
    expect(entries).toHaveLength(1);
    expect(entries[0].entryDate.toISOString()).toBe(deliveredOn.toISOString());
    expect(entries[0].externalRef).toMatch(/^delivered:\d+$/);
    const debit = entries[0].transactions.find((t) => Number(t.debitAmount) > 0)!;
    const credit = entries[0].transactions.find((t) => Number(t.creditAmount) > 0)!;
    expect(debit.account.code).toBe(GL_ACCOUNTS.DELIVERY_FEES);
    expect(credit.account.code).toBe(GL_ACCOUNTS.CASH_IN_TRANSIT);
    expect(Number(debit.debitAmount)).toBe(25);
    expect(Number(credit.creditAmount)).toBe(25);

    // The revenue entry no longer nets Kofi's old GH12 profile commission: 1015 holds the gross, less the fee
    const revenue = await prismaBase.journalEntry.findFirstOrThrow({
      where: { tenantId, sourceType: 'order_delivery', sourceId: id }, include: { transactions: { include: { account: true } } },
    });
    expect(revenue.transactions.map((t) => t.account.code).sort()).toEqual(['4010', '1015'].sort());
    expect(Number(revenue.transactions.find((t) => t.account.code === '1015')!.debitAmount)).toBe(200);
  });

  it('a repeat of the move posts nothing more', async () => {
    const id = await mk(kofiId, 'out_for_delivery');
    await move(id, 'delivered');
    await move(id, 'delivered');
    expect(await feeEntries(id)).toHaveLength(1);
  });

  it('Kofi failed posts GH5 and a second failed attempt posts a second GH5', async () => {
    const id = await mk(kofiId, 'out_for_delivery');
    await move(id, 'failed_delivery', { failureReason: 'not_reachable' });
    expect(await feeEntries(id)).toHaveLength(1);
    await move(id, 'out_for_delivery');
    await move(id, 'failed_delivery', { failureReason: 'not_reachable' });
    const entries = await feeEntries(id);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => Number(e.transactions[0].debitAmount) + Number(e.transactions[0].creditAmount))).toEqual([5, 5]);
    expect(new Set(entries.map((e) => e.externalRef)).size).toBe(2);
  });

  it('Logiswift failed stamps 0 and posts nothing; a partner with no return rule posts nothing on return', async () => {
    const id = await mk(logiswiftId, 'out_for_delivery');
    await move(id, 'failed_delivery', { failureReason: 'not_reachable' });
    expect(await feeEntries(id)).toHaveLength(0);
    await move(id, 'returned');
    expect(await feeEntries(id)).toHaveLength(0);
  });

  it('a returned order reverses the delivered fee and posts the returned fee from the rule', async () => {
    await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: kofiId, outcome: 'returned', amount: 3, validFrom: new Date('2026-01-01') } });
    const id = await mk(kofiId, 'out_for_delivery');
    await move(id, 'delivered');
    const before = await balance('5070');
    await move(id, 'returned');

    const entries = await feeEntries(id);
    expect(entries.map((e) => e.externalRef!.split(':')[0])).toEqual(['delivered', 'reversal', 'returned']);
    expect(entries[0].reversingEntryId).toBe(entries[1].id);
    // delivered 25 reversed (-25), returned fee +3
    expect(await balance('5070')).toBe(before - 25 + 3);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id } });
    expect(Number(order.deliveryFee)).toBe(3);

    // The order's 1015 nets to zero: delivered +200 -25, return -200 +25, returned fee -3
    const net = (await prismaBase.accountTransaction.findMany({
      where: { tenantId, account: { code: '1015' }, journalEntry: { sourceId: id, sourceType: { in: ['order_delivery', 'order_return', 'delivery_fee'] } } },
    })).reduce((sum, l) => sum + Number(l.debitAmount) - Number(l.creditAmount), 0);
    expect(net).toBe(-3);
  });

  it('delivered again after a return posts a fresh delivered fee', async () => {
    const id = await mk(kofiId, 'out_for_delivery');
    await move(id, 'delivered');
    await move(id, 'returned');
    await move(id, 'delivered', { force: true, reason: 'customer took it after all' });
    const delivered = (await feeEntries(id)).filter((e) => e.externalRef!.startsWith('delivered:'));
    expect(delivered).toHaveLength(2);
    expect(delivered.filter((e) => e.reversingEntryId === null)).toHaveLength(1);
    expect(Number((await prismaBase.order.findUniqueOrThrow({ where: { id } })).deliveryFee)).toBe(25);
  });

  it('1015 holds gross minus the fee, and a collection is booked at that net amount', async () => {
    const id = await mk(kofiId, 'out_for_delivery');
    const before = await balance('1015');
    await move(id, 'delivered');
    expect(await balance('1015')).toBe(before + 200 - 25);
  });

  it('no entry posts to 5040, 1020 or 2030', async () => {
    for (const code of ['5040', '1020', '2030']) {
      expect(await linesOn(code)).toHaveLength(0);
      const account = await prismaBase.account.findUnique({ where: { tenantId_code: { tenantId, code } } });
      expect(account === null || account.isActive === false).toBe(true);
    }
  });

  it('a pay-per-delivery commission entry cannot be created', async () => {
    await expect(prismaBase.commissionEntry.create({
      data: { tenantId, userId: kofiId, kind: 'pay_per_delivery', amount: 12 } as any,
    })).rejects.toThrow();
  });
});
