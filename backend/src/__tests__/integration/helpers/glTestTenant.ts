import { jest } from '@jest/globals';
import prisma from '../../../utils/prisma';
import * as tenantContext from '../../../utils/tenantContext';

/**
 * GL writes now require a resolvable tenant (account_transactions.tenant_id is
 * NOT NULL and the GL service throws rather than orphan rows). Integration
 * fixtures predate multi-tenancy, so they must establish tenant context exactly
 * like a real authenticated request does.
 *
 * This runs the suite's cleanup with NO context (so deleteMany is unscoped and
 * wipes legacy NULL-tenant rows from older runs), then seeds a stable tenant and
 * puts it in context so the Prisma extension auto-tags every subsequent fixture
 * and GL row. Returns the tenant id.
 */
export async function withGlTestTenant(cleanup: () => Promise<void>): Promise<string> {
  jest.spyOn(tenantContext, 'getTenantId').mockReturnValue(null);
  await cleanup();

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'gl-integration-test' },
    update: {},
    create: { name: 'GL Integration Test', slug: 'gl-integration-test' },
  });
  jest.spyOn(tenantContext, 'getTenantId').mockReturnValue(tenant.id);
  return tenant.id;
}
