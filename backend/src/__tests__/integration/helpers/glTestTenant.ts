import { jest } from '@jest/globals';
import prisma from '../../../utils/prisma';
import * as tenantContext from '../../../utils/tenantContext';
import { stubTenantStore } from '../../mocks/tenant.mock';

/**
 * GL writes now require a resolvable tenant (account_transactions.tenant_id is
 * NOT NULL and the GL service throws rather than orphan rows). Integration
 * fixtures predate multi-tenancy, so they must establish tenant context exactly
 * like a real authenticated request does.
 *
 * This seeds a stable tenant, puts it in context, runs the suite's cleanup scoped to that
 * tenant, so the Prisma extension auto-tags every subsequent fixture and GL row. Returns the tenant id.
 *
 * Fixtures here insert accounts with explicit ids equal to their code (1010, 4010...):
 * GLAutomationService reads them back by id. Those rows outlive the suite. If accounts_id_seq
 * later reaches one of those ids, createMany(skipDuplicates) in seedTenantDefaults silently
 * drops the default account that drew it, and a later suite fails with a missing 1010/4010
 * (COD-130). So the sequence is moved above the code range (max code 5999) before any suite
 * inserts its explicit ids.
 */
export async function withGlTestTenant(cleanup: () => Promise<void>): Promise<string> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'gl-integration-test' },
    update: {},
    create: { name: 'GL Integration Test', slug: 'gl-integration-test' },
  });
  // Cleanup runs inside the suite's own tenant, so the Prisma extension scopes every
  // `deleteMany({})` on a tenant model to this tenant's rows and never wipes another tenant's.
  jest.spyOn(tenantContext, 'getTenantId').mockReturnValue(tenant.id);
  stubTenantStore({ tenantId: tenant.id });
  await cleanup();
  await prisma.$executeRaw`SELECT setval('accounts_id_seq', GREATEST(6000, (SELECT last_value FROM accounts_id_seq)))`;
  return tenant.id;
}
