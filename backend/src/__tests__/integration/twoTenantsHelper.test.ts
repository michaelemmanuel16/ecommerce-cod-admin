/**
 * M0-T27 (COD-7): the two-tenant harness builds what it promises, scopes by tenant,
 * and cleans up after itself.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { TenantContextMissing, runInTenant } from '../../utils/tenantContext';
import { verifyAccessToken } from '../../utils/jwt';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let cleanedUp = false;

beforeAll(async () => {
  pair = await createTwoTenants('helper');
}, 30000);

afterAll(async () => {
  if (!cleanedUp) await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('createTwoTenants', () => {
  it('makes two different tenants, each with an admin, a sales rep and a delivery agent', async () => {
    expect(pair.a.id).not.toBe(pair.b.id);
    for (const t of [pair.a, pair.b]) {
      expect(t.users.admin.role).toBe('admin');
      expect(t.users.salesRep.role).toBe('sales_rep');
      expect(t.users.deliveryAgent.role).toBe('delivery_agent');
      const rows = await prismaBase.user.findMany({ where: { tenantId: t.id } });
      const people = rows.filter((u) => u.kind === 'person');
      expect(people.map((u) => u.role).sort()).toEqual(['admin', 'delivery_agent', 'sales_rep']);
      expect(rows.filter((u) => u.kind === 'system')).toHaveLength(1); // M2-T03: one system user per tenant
    }
  });

  it('mints tokens that carry the tenant of the user', () => {
    for (const t of [pair.a, pair.b]) {
      expect(verifyAccessToken(t.users.admin.token).tenantId).toBe(t.id);
    }
  });

  it('seeds one row per scoped model for each tenant, all stamped with that tenant', async () => {
    const stamped = async (t: typeof pair.a) => {
      const [order, customer, product, delivery, collection, notification, journal, accountTx, accounts, partner] = await Promise.all([
        prismaBase.order.findUnique({ where: { id: t.ids.order } }),
        prismaBase.customer.findUnique({ where: { id: t.ids.customer } }),
        prismaBase.product.findUnique({ where: { id: t.ids.product } }),
        prismaBase.delivery.findUnique({ where: { id: t.ids.delivery } }),
        prismaBase.agentCollection.findUnique({ where: { id: t.ids.agentCollection } }),
        prismaBase.notification.findUnique({ where: { id: t.ids.notification } }),
        prismaBase.journalEntry.findUnique({ where: { id: t.ids.journalEntry } }),
        prismaBase.accountTransaction.findMany({ where: { journalEntryId: t.ids.journalEntry } }),
        prismaBase.account.count({ where: { tenantId: t.id } }),
        prismaBase.user.findUnique({ where: { id: t.users.deliveryAgent.id } }),
      ]);
      expect([order, customer, product, delivery, collection, notification, journal, partner].map((r) => r?.tenantId))
        .toEqual(Array(8).fill(t.id));
      expect(accountTx).toHaveLength(2);
      expect(accountTx.every((x) => x.tenantId === t.id)).toBe(true);
      expect(accounts).toBe(16);
    };
    await stamped(pair.a);
    await stamped(pair.b);
  });

  it('runInTenant scopes queries to one tenant and nothing runs without a context', async () => {
    const seenByA = await runInTenant(pair.a.id, () => prisma.order.findMany({}));
    expect(seenByA.map((o) => o.id)).toEqual([pair.a.ids.order]);
    const seenByB = await runInTenant(pair.b.id, () => prisma.order.findMany({}));
    expect(seenByB.map((o) => o.id)).toEqual([pair.b.ids.order]);
    await expect(prisma.order.findMany({})).rejects.toThrow(TenantContextMissing);
  });

  // Keep this test last: it tears down the pair the tests above use.
  it('cleanup removes every row and both tenants', async () => {
    const ids = [pair.a.id, pair.b.id];
    await pair.cleanup();
    cleanedUp = true;
    const t = { tenantId: { in: ids } };
    expect(await prismaBase.tenant.count({ where: { id: { in: ids } } })).toBe(0);
    const left = await Promise.all([
      prismaBase.user.count({ where: t }),
      prismaBase.order.count({ where: t }),
      prismaBase.customer.count({ where: t }),
      prismaBase.product.count({ where: t }),
      prismaBase.account.count({ where: t }),
      prismaBase.journalEntry.count({ where: t }),
      prismaBase.auditLog.count({ where: t }),
      prismaBase.notification.count({ where: t }),
    ]);
    expect(left.every((n) => n === 0)).toBe(true);
  }, 30000);
});
