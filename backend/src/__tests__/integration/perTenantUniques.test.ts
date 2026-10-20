/**
 * M0-T11 (COD-4): account code, journal entry number, product SKU and SMS template
 * name are unique per tenant, not globally.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import prisma, { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { runInTenant } from '../../utils/tenantContext';
import glService from '../../services/glService';
import { GLAccountService } from '../../services/glAccountService';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();
let tenantAId: string;
let tenantBId: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    createTenant('Unique A'),
    createTenant('Unique B'),
  ]);
  tenantAId = a.id;
  tenantBId = b.id;
});

afterAll(async () => {
  GLAccountService.clearCache();
  await deleteTenantRows([tenantAId, tenantBId]);
  await prismaBase.$disconnect();
});

describe('per-tenant uniques', () => {
  it('lets two tenants both create account 1010', async () => {
    for (const tenantId of [tenantAId, tenantBId]) {
      await runInTenant(tenantId, () =>
        prisma.account.create({
          data: { code: '1010', name: 'Cash in Hand', accountType: 'asset', normalBalance: 'debit' } as any,
        })
      );
    }
    const rows = await prismaBase.account.findMany({ where: { code: '1010', tenantId: { in: [tenantAId, tenantBId] } } });
    expect(rows).toHaveLength(2);
  });

  it('still rejects a second account 1010 inside one tenant', async () => {
    await expect(
      runInTenant(tenantAId, () =>
        prisma.account.create({
          data: { code: '1010', name: 'Duplicate', accountType: 'asset', normalBalance: 'debit' } as any,
        })
      )
    ).rejects.toThrow();
  });

  it('lets two tenants both create product SKU MG-1', async () => {
    for (const tenantId of [tenantAId, tenantBId]) {
      await runInTenant(tenantId, () =>
        prisma.product.create({
          data: { name: 'Magic Groove', sku: 'MG-1', price: 10, stockQuantity: 5, category: 'Education' } as any,
        })
      );
    }
    const rows = await prismaBase.product.findMany({ where: { sku: 'MG-1', tenantId: { in: [tenantAId, tenantBId] } } });
    expect(rows).toHaveLength(2);
  });

  it('lets two tenants both create SMS template "welcome"', async () => {
    for (const tenantId of [tenantAId, tenantBId]) {
      await runInTenant(tenantId, () =>
        prisma.smsTemplate.create({ data: { name: 'welcome', body: 'Hello', tenantId } })
      );
    }
    const rows = await prismaBase.smsTemplate.findMany({ where: { name: 'welcome', tenantId: { in: [tenantAId, tenantBId] } } });
    expect(rows).toHaveLength(2);
  });

  it('gives both tenants JE-YYYYMMDD-00001 for the first entry posted on the same day', async () => {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const numbers: string[] = [];

    for (const tenantId of [tenantAId, tenantBId]) {
      const user = await prismaBase.user.create({
        data: {
          email: `unique-${tenantId}@test.com`, password: 'hashed', firstName: 'U', lastName: 'T',
          role: 'accountant', tenantId,
        },
      });
      const entry = await runInTenant(tenantId, async () => {
        const cash = await prisma.account.findUnique({ where: { tenantId_code: { tenantId, code: '1010' } } });
        const revenue = await prisma.account.create({
          data: { code: '4010', name: 'Revenue', accountType: 'revenue', normalBalance: 'credit' } as any,
        });
        return glService.createJournalEntry({
          entryDate: new Date(),
          description: 'Per-tenant number test',
          sourceType: 'manual' as any,
          transactions: [
            { accountId: cash!.id, debitAmount: 100, creditAmount: 0, description: 'debit' },
            { accountId: revenue.id, debitAmount: 0, creditAmount: 100, description: 'credit' },
          ],
        }, { id: user.id, role: 'accountant' } as any);
      });
      numbers.push(entry.entryNumber);
    }

    expect(numbers).toEqual([`JE-${dateStr}-00001`, `JE-${dateStr}-00001`]);
  });

  it('keeps the GL account id cache apart per tenant', async () => {
    GLAccountService.clearCache();
    const idA = await runInTenant(tenantAId, () => GLAccountService.getAccountIdByCode('1010'));
    const idB = await runInTenant(tenantBId, () => GLAccountService.getAccountIdByCode('1010'));
    expect(idA).not.toBe(idB);
    const rowA = await prismaBase.account.findUnique({ where: { id: idA } });
    expect(rowA?.tenantId).toBe(tenantAId);
  });
});
