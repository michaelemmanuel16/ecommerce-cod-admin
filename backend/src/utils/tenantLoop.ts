import prisma from './prisma';
import logger from './logger';
import { runInTenant, withoutTenant } from './tenantContext';

/**
 * Run `fn` once per tenant, each inside runInTenant(tenantId).
 * The tenant list is read inside withoutTenant('tenant-loop'). One tenant failing
 * does not stop the others; after the loop an aggregate error is thrown so the
 * job is marked failed.
 */
export async function forEachTenant(
  jobName: string,
  fn: (tenantId: string) => Promise<void>
): Promise<void> {
  const tenants = await withoutTenant('tenant-loop', () =>
    prisma.tenant.findMany({ select: { id: true } })
  );

  const failed: string[] = [];
  for (const { id } of tenants) {
    try {
      await runInTenant(id, () => fn(id));
    } catch (error: any) {
      failed.push(id);
      logger.error(`${jobName} failed for tenant ${id}:`, error?.message ?? error);
    }
  }

  if (failed.length > 0) {
    throw new Error(`${jobName} failed for ${failed.length}/${tenants.length} tenants: ${failed.join(', ')}`);
  }
}
