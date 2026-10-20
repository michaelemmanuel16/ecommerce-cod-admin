import { describe, it, expect, afterAll } from '@jest/globals';
import prisma from '../../utils/prisma';
import { tenantStorage, withoutTenant, TenantContextMissing } from '../../utils/tenantContext';

// T12: a query on a scoped model with no tenant context throws; it passes inside
// tenantStorage.run and inside withoutTenant. The ids match no rows, so reads
// return empty and writes fail on their own (never with TenantContextMissing).

const TENANT = '00000000-0000-0000-0000-00000000f001';
const noRow = { id: -1 };

// One call per operation on a scoped model (Customer)
const operations: Array<[string, () => Promise<unknown>]> = [
  ['findMany', () => prisma.customer.findMany({ where: noRow })],
  ['findFirst', () => prisma.customer.findFirst({ where: noRow })],
  ['findFirstOrThrow', () => prisma.customer.findFirstOrThrow({ where: noRow })],
  ['findUnique', () => prisma.customer.findUnique({ where: noRow })],
  ['findUniqueOrThrow', () => prisma.customer.findUniqueOrThrow({ where: noRow })],
  ['count', () => prisma.customer.count({ where: noRow })],
  ['aggregate', () => prisma.customer.aggregate({ _count: true, where: noRow })],
  ['groupBy', () => prisma.customer.groupBy({ by: ['id'], where: noRow })],
  ['create', () => prisma.customer.create({ data: {} as any })],
  ['createMany', () => prisma.customer.createMany({ data: [] })],
  ['update', () => prisma.customer.update({ where: noRow, data: { firstName: 'x' } })],
  ['updateMany', () => prisma.customer.updateMany({ where: noRow, data: { firstName: 'x' } })],
  ['upsert', () => prisma.customer.upsert({ where: noRow, update: {}, create: {} as any })],
  ['delete', () => prisma.customer.delete({ where: noRow })],
  ['deleteMany', () => prisma.customer.deleteMany({ where: noRow })],
];

// Whatever the DB says (not found, validation), it must not be TenantContextMissing
const notContextError = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (err) {
    expect(err).not.toBeInstanceOf(TenantContextMissing);
  }
};

describe('tenant fail-closed extension', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe.each(operations)('%s', (_name, run) => {
    it('throws TenantContextMissing without context', async () => {
      await expect(run()).rejects.toThrow(TenantContextMissing);
    });

    it('throws when the store has a null tenant and no withoutTenant marker', async () => {
      await expect(tenantStorage.run({ tenantId: null }, async () => run())).rejects.toThrow(TenantContextMissing);
    });

    it('does not throw TenantContextMissing inside tenantStorage.run', async () => {
      await notContextError(() => tenantStorage.run({ tenantId: TENANT }, async () => run()));
    });

    it('does not throw TenantContextMissing inside withoutTenant', async () => {
      await notContextError(() => withoutTenant('test', run));
    });
  });

  it('names the error class, model and operation', async () => {
    const err: any = await prisma.order.findMany().catch((e) => e);
    expect(err.name).toBe('TenantContextMissing');
    expect(err.message).toContain('Order.findMany');
  });

  it('does not affect models that are not tenant-scoped', async () => {
    await expect(prisma.tenant.findMany({ take: 1 })).resolves.toBeDefined();
  });

  it('withoutTenant returns the result of fn', async () => {
    await expect(withoutTenant('test', async () => 42)).resolves.toBe(42);
  });
});
