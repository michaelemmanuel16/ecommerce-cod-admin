import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { runInTenant } from '../utils/tenantContext';
import { DEFAULT_GL_ACCOUNTS } from '../config/glAccounts';
import { DEFAULT_ROLES } from '../config/defaultRoles';
import { seedDefaultEmailTemplates } from './emailTemplateService';
import { ensureSystemUser } from './systemUserService';

/**
 * M2: a tenant that saved its role permissions before `orders:update_status` was granted to admin keeps the old
 * list (stored cells replace the defaults). Add the cell when it is missing; nothing is ever removed.
 * Run once from the backfill script, not on every seed, so an owner who later removes the cell keeps it removed.
 */
export async function grantAdminUpdateStatus(tenantId: string): Promise<void> {
  await runInTenant(tenantId, async () => {
    const config = await prisma.systemConfig.findFirst();
    const stored = config?.rolePermissions as Record<string, Record<string, string[]>> | null | undefined;
    const orders = stored?.admin?.orders;
    if (!config || !Array.isArray(orders) || orders.includes('update_status')) return;
    await prisma.systemConfig.update({
      where: { id: config.id },
      data: { rolePermissions: { ...stored, admin: { ...stored!.admin, orders: [...orders, 'update_status'] } } },
    });
  });
}

/**
 * Create what a tenant is missing: the chart of accounts, the default email
 * templates, the 7 default roles and the system user. Idempotent: re-running never creates duplicates (unique
 * `(tenantId, code)` on accounts, `(name, tenantId)` on email templates and
 * `(tenantId, name)` on roles; the system user is found by kind first).
 * Runs inside the tenant context so the Prisma extension stamps the tenantId.
 *
 * SMS templates are not seeded: no default SMS content exists in the code.
 */
export async function seedTenantDefaults(tenantId: string): Promise<{ accounts: number; emailTemplates: number; roles: number; systemUser: number }> {
  const [accounts, emailTemplates, roles, systemUser] = await Promise.all([
    runInTenant(tenantId, async () => {
      const result = await prisma.account.createMany({
        data: DEFAULT_GL_ACCOUNTS.map((a) => ({
          ...a,
          description: `Default account: ${a.name}`,
          isActive: true,
        })),
        skipDuplicates: true,
      });
      return result.count;
    }),
    seedDefaultEmailTemplates(tenantId),
    runInTenant(tenantId, async () => {
      const result = await prisma.role.createMany({
        data: DEFAULT_ROLES.map((r) => ({ ...r, tenantId, kpis: [] })),
        skipDuplicates: true,
      });
      return result.count;
    }),
    ensureSystemUser(tenantId).then(({ created }) => (created ? 1 : 0)),
  ]);
  if (accounts > 0 || emailTemplates > 0 || roles > 0 || systemUser > 0) {
    logger.info(`Seeded tenant defaults for ${tenantId}: ${accounts} accounts, ${emailTemplates} email templates, ${roles} roles, ${systemUser} system user`);
  }
  return { accounts, emailTemplates, roles, systemUser };
}
