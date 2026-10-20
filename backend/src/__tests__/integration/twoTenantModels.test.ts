/**
 * M0-T28 (COD-7): two-tenant suite, one test per model. Tenant B's rows never show for
 * tenant A on list (findMany), get (findFirst / findUnique by B's id) and count.
 * Seed rows come from createTwoTenants; every tenant-scoped model that the plan names
 * is covered, plus the models the harness seeds on the side.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { TENANT_SCOPED_MODELS } from '../../utils/prismaExtensions';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { runInTenant } from '../../utils/tenantContext';

let pair: TwoTenants;

beforeAll(async () => {
  pair = await createTwoTenants('models');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

// [label, Prisma delegate, key in `ids`, Prisma model name]
const MODELS: Array<[string, string, string, string]> = [
  ['orders', 'order', 'order', 'Order'],
  ['customers', 'customer', 'customer', 'Customer'],
  ['products', 'product', 'product', 'Product'],
  ['deliveries', 'delivery', 'delivery', 'Delivery'],
  ['collections', 'agentCollection', 'agentCollection', 'AgentCollection'],
  ['deposits', 'agentDeposit', 'agentDeposit', 'AgentDeposit'],
  ['aging buckets', 'agentAgingBucket', 'agentAgingBucket', 'AgentAgingBucket'],
  ['payouts', 'payout', 'payout', 'Payout'],
  ['calls', 'call', 'call', 'Call'],
  ['order history', 'orderHistory', 'orderHistory', 'OrderHistory'],
  ['audit log', 'auditLog', 'auditLog', 'AuditLog'],
  ['webhook log', 'webhookLog', 'webhookLog', 'WebhookLog'],
  ['SMS templates', 'smsTemplate', 'smsTemplate', 'SmsTemplate'],
  ['download tokens', 'downloadToken', 'downloadToken', 'DownloadToken'],
  ['form submissions', 'formSubmission', 'formSubmission', 'FormSubmission'],
  ['product cost entries', 'product_cost_entries', 'productCostEntry', 'product_cost_entries'],
  ['GL journal entries', 'journalEntry', 'journalEntry', 'JournalEntry'],
  ['GL account transactions', 'accountTransaction', 'accountTransaction', 'AccountTransaction'],
  ['notifications', 'notification', 'notification', 'Notification'],
  ['pending checkouts', 'pendingCheckout', 'pendingCheckout', 'PendingCheckout'],
  ['webhook events', 'webhookEvent', 'webhookEvent', 'WebhookEvent'],
  ['workflow executions', 'workflowExecution', 'workflowExecution', 'WorkflowExecution'],
  // Seeded on the side by the harness
  ['users', 'user', 'user', 'User'],
  ['GL accounts', 'account', 'account', 'Account'],
  ['workflows', 'workflow', 'workflow', 'Workflow'],
  ['webhook configs', 'webhookConfig', 'webhookConfig', 'WebhookConfig'],
  ['checkout forms', 'checkoutForm', 'checkoutForm', 'CheckoutForm'],
  ['agent balances', 'agentBalance', 'agentBalance', 'AgentBalance'],
  // M1 models
  ['targets', 'target', 'target', 'Target'],
  ['findings', 'finding', 'finding', 'Finding'],
  ['fee rules', 'feeRule', 'feeRule', 'FeeRule'],
  ['FX rates', 'fxRate', 'fxRate', 'FxRate'],
];

describe('tenant B data never shows for tenant A', () => {
  it.each(MODELS)('%s', async (_label, delegate, idKey, modelName) => {
    const { a, b } = pair;
    const bId = b.ids[idKey];
    const aId = a.ids[idKey];
    expect(bId).toBeDefined();
    const db = (prisma as any)[delegate];
    const base = (prismaBase as any)[delegate];

    // Guard the guard: the model is on the scoped list, and B really has a row.
    expect(TENANT_SCOPED_MODELS.has(modelName)).toBe(true);
    expect(await base.count({ where: { id: bId, tenantId: b.id } })).toBe(1);

    // list
    const listed = await runInTenant(a.id, () => db.findMany({}));
    const listedIds = listed.map((r: any) => r.id);
    expect(listedIds).toContain(aId);
    expect(listedIds).not.toContain(bId);
    expect(listed.every((r: any) => r.tenantId === a.id)).toBe(true);
    // asking for B's tenant by name still only returns A's rows
    const forged = await runInTenant(a.id, () => db.findMany({ where: { tenantId: b.id } }));
    expect(forged.every((r: any) => r.tenantId === a.id)).toBe(true);
    expect(await runInTenant(a.id, () => db.findMany({ where: { id: bId } }))).toEqual([]);

    // get
    expect(await runInTenant(a.id, () => db.findFirst({ where: { id: bId } }))).toBeNull();
    expect(await runInTenant(a.id, () => db.findUnique({ where: { id: bId } }))).toBeNull();
    const own = await runInTenant(a.id, () => db.findUnique({ where: { id: aId } }));
    expect(own?.id).toBe(aId);

    // count: exactly A's rows, with and without a filter on B's id
    const aTotal = await base.count({ where: { tenantId: a.id } });
    expect(await runInTenant(a.id, () => db.count({}))).toBe(aTotal);
    expect(await runInTenant(a.id, () => db.count({ where: { id: bId } }))).toBe(0);
  });

  // write: tenant A cannot change or delete B's row, and B's row stays exactly as it was
  it.each(MODELS)('%s: no cross-tenant write', async (_label, delegate, idKey) => {
    const { a, b } = pair;
    const bId = b.ids[idKey];
    const db = (prisma as any)[delegate];
    const base = (prismaBase as any)[delegate];
    const before = await base.findUnique({ where: { id: bId } });

    await expect(runInTenant(a.id, () => db.update({ where: { id: bId }, data: {} }))).rejects.toThrow();
    expect(await runInTenant(a.id, () => db.updateMany({ where: { id: bId }, data: {} }))).toEqual({ count: 0 });
    await expect(runInTenant(a.id, () => db.delete({ where: { id: bId } }))).rejects.toThrow();
    expect(await runInTenant(a.id, () => db.deleteMany({ where: { id: bId } }))).toEqual({ count: 0 });

    expect(await base.findUnique({ where: { id: bId } })).toEqual(before);
  });

  it('every model the plan names is in the table', () => {
    const planned = [
      'Order', 'Customer', 'Product', 'Delivery', 'AgentCollection', 'AgentDeposit', 'AgentAgingBucket', 'Payout', 'Call',
      'OrderHistory', 'AuditLog', 'WebhookLog', 'SmsTemplate', 'DownloadToken', 'FormSubmission', 'product_cost_entries',
      'JournalEntry', 'AccountTransaction', 'Notification', 'PendingCheckout', 'WebhookEvent', 'WorkflowExecution',
    ];
    const covered = new Set(MODELS.map((m) => m[3]));
    expect(planned.filter((m) => !covered.has(m))).toEqual([]);
  });
});
