/**
 * M1-T10: side effects of a status move, inside the state machine, against the test DB.
 * Failed-delivery fee (FeeRule, one per move, DR 5070 CR 1015), revenue and reversal (D7), the reconcile safety net,
 * and the removed GL_DEFAULTS fee.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import { processReconcileDeliveredOrders } from '../../queues/financialReconciliationQueue';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerStatusChangeWorkflows: () => Promise.resolve() },
}));

const SUFFIX = Date.now();
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'super_admin' };
let tenantId: string;
let customerId: number;
let agentId: number;

const mk = async (status: any, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: { customerId, status, subtotal: 100, totalAmount: 100, codAmount: 100, deliveryAgentId: agentId, tenantId, ...extra } as any,
  })).id;
const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const move = (id: number, to: any, options: any = {}) => inTenant(() => transitionOrder(id, to, ADMIN, options));
const entries = (where: Record<string, unknown>) => prismaBase.journalEntry.findMany({ where: { tenantId, ...where }, orderBy: { id: 'asc' } });
const failedEntries = (orderId: number) =>
  entries({ sourceType: 'delivery_fee', sourceId: orderId, externalRef: { startsWith: 'failed:' } });
const allEntryCount = () => prismaBase.journalEntry.count({ where: { tenantId } });

beforeAll(async () => {
  tenantId = (await createTenant('OSE Tenant')).id;
  await seedTenantDefaults(tenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  agentId = (await prismaBase.user.create({
    data: { email: `ose-agent-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Kofi', lastName: 'Agent', role: 'delivery_agent', tenantId },
  })).id;
  ADMIN.userId = (await prismaBase.user.create({
    data: { email: `ose-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Ada', lastName: 'Admin', role: 'super_admin', tenantId },
  })).id;
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('failed-delivery fee (F-935, D6)', () => {
  it('with no FeeRule a failed_delivery move posts nothing', async () => {
    const id = await mk('out_for_delivery');
    await move(id, 'failed_delivery', { failureReason: 'not_reachable' });
    expect(await failedEntries(id)).toHaveLength(0);
  });

  it('with a FeeRule it posts exactly one entry, a repeat posts none, and two attempts post two', async () => {
    await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: agentId, outcome: 'failed', amount: 25, validFrom: new Date('2026-01-01') } });
    const id = await mk('out_for_delivery');

    await move(id, 'failed_delivery', { failureReason: 'not_reachable' });
    expect(await failedEntries(id)).toHaveLength(1);

    const same = await move(id, 'failed_delivery');
    expect(same.changed).toBe(false);
    expect(await failedEntries(id)).toHaveLength(1);

    await move(id, 'out_for_delivery');
    await move(id, 'failed_delivery', { failureReason: 'not_reachable' });
    const posted = await failedEntries(id);
    expect(posted).toHaveLength(2);
    expect(new Set(posted.map((e) => e.externalRef)).size).toBe(2);

    const lines = await prismaBase.accountTransaction.findMany({ where: { journalEntryId: posted[0].id }, include: { account: true } });
    const debit = lines.find((l) => Number(l.debitAmount) > 0)!;
    expect(debit.account.code).toBe(GL_ACCOUNTS.DELIVERY_FEES);
    expect(lines.find((l) => Number(l.creditAmount) > 0)!.account.code).toBe(GL_ACCOUNTS.CASH_IN_TRANSIT);
    expect(Number(debit.debitAmount)).toBe(25);
  });
});

describe('revenue and reversal (D7)', () => {
  it('delivered -> returned -> forced delivered -> returned posts revenue, reversal, revenue, reversal; net 0', async () => {
    const id = await mk('out_for_delivery');
    const deliveredOn = new Date('2026-10-10T12:00:00.000Z');

    await move(id, 'delivered', { deliveryDate: deliveredOn });
    let revenue = await entries({ sourceType: 'order_delivery', sourceId: id });
    expect(revenue).toHaveLength(1);
    expect(revenue[0].entryDate.toISOString()).toBe(deliveredOn.toISOString());
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).glJournalEntryId).toBe(revenue[0].id);

    await move(id, 'returned');
    let returns = await entries({ sourceType: 'order_return', sourceId: id });
    expect(returns).toHaveLength(1);
    const firstReturnedAt = (await prismaBase.order.findUniqueOrThrow({ where: { id } })).returnedAt!;
    expect(returns[0].entryDate.toISOString()).toBe(firstReturnedAt.toISOString());
    revenue = await entries({ sourceType: 'order_delivery', sourceId: id });
    expect(revenue[0].reversingEntryId).toBe(returns[0].id);

    // returned -> returned is a no-op; nothing extra posts
    await move(id, 'returned');
    expect(await entries({ sourceId: id, sourceType: { in: ['order_delivery', 'order_return'] } })).toHaveLength(2);

    await move(id, 'delivered', { force: true, reason: 'customer took it after all' });
    revenue = await entries({ sourceType: 'order_delivery', sourceId: id });
    expect(revenue).toHaveLength(2);

    await move(id, 'returned');
    returns = await entries({ sourceType: 'order_return', sourceId: id });
    revenue = await entries({ sourceType: 'order_delivery', sourceId: id });
    expect(returns).toHaveLength(2);
    expect(revenue[1].reversingEntryId).toBe(returns[1].id);
    const secondReturnedAt = (await prismaBase.order.findUniqueOrThrow({ where: { id } })).returnedAt!;
    expect(returns[1].entryDate.toISOString()).toBe(secondReturnedAt.toISOString());

    const ids = [...revenue, ...returns].map((e) => e.id);
    const lines = await prismaBase.accountTransaction.findMany({
      where: { journalEntryId: { in: ids }, account: { code: GL_ACCOUNTS.PRODUCT_REVENUE } },
    });
    const net = lines.reduce((sum, l) => sum + Number(l.creditAmount) - Number(l.debitAmount), 0);
    expect(net).toBe(0);
  });

  it('the reconcile job after a machine delivery posts no new journal entry', async () => {
    const id = await mk('out_for_delivery');
    await move(id, 'delivered');
    const before = await allEntryCount();
    // The job walks every tenant in the test DB; a leftover tenant from another suite may fail, ours must not post
    await processReconcileDeliveredOrders().catch(() => undefined);
    expect(await allEntryCount()).toBe(before);
    expect(await entries({ sourceType: 'order_delivery', sourceId: id })).toHaveLength(1);
  });
});
