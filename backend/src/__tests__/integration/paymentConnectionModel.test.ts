/**
 * M3b-T02 (COD-31): PaymentConnection is tenant-scoped. An insert inside a tenant gets that tenant's id,
 * two tenants can hold a connection for the same provider, and one tenant cannot hold two for it.
 * The cross-tenant read and write checks for the model are in twoTenantModels.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { runInTenant } from '../../utils/tenantContext';

let pair: TwoTenants;

beforeAll(async () => {
  pair = await createTwoTenants('payconn');
  // The harness seeds one paystack connection per tenant; start these tests from none.
  await prismaBase.paymentConnection.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('PaymentConnection tenant scope', () => {
  it('stamps the tenant of the context on insert, even if the data names another tenant', async () => {
    const { a, b } = pair;
    const row = await runInTenant(a.id, () =>
      prisma.paymentConnection.create({ data: { provider: 'paystack', tenantId: b.id } as any }),
    );
    expect(row.tenantId).toBe(a.id);
    await prismaBase.paymentConnection.delete({ where: { id: row.id } });
  });

  it('lets each tenant hold its own connection for the same provider', async () => {
    const { a, b } = pair;
    const rowA = await runInTenant(a.id, () => prisma.paymentConnection.create({ data: { provider: 'paystack', publicKey: 'pk_a' } as any }));
    const rowB = await runInTenant(b.id, () => prisma.paymentConnection.create({ data: { provider: 'paystack', publicKey: 'pk_b' } as any }));
    expect(rowA.tenantId).toBe(a.id);
    expect(rowB.tenantId).toBe(b.id);

    const seenByA = await runInTenant(a.id, () => prisma.paymentConnection.findMany({}));
    expect(seenByA.map((r) => r.publicKey)).toEqual(['pk_a']);
    const seenByB = await runInTenant(b.id, () => prisma.paymentConnection.findMany({}));
    expect(seenByB.map((r) => r.publicKey)).toEqual(['pk_b']);
  });

  it('refuses a second connection for the same provider inside one tenant', async () => {
    const { a } = pair;
    await expect(
      runInTenant(a.id, () => prisma.paymentConnection.create({ data: { provider: 'paystack' } as any })),
    ).rejects.toThrow();
  });

  it('defaults a new connection to test mode, enabled, with no known currencies', async () => {
    const { a } = pair;
    const row = await runInTenant(a.id, () => prisma.paymentConnection.create({ data: { provider: 'stub' } as any }));
    expect(row).toMatchObject({ mode: 'test', isEnabled: true, supportedCurrencies: [], lastCheckedAt: null });
  });
});
