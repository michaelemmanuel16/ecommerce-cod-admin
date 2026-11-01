import prisma, { TransactionClient } from '../utils/prisma';
import logger from '../utils/logger';
import { runInTenant } from '../utils/tenantContext';
import { DEFAULT_GL_ACCOUNTS, RETIRED_GL_CODES } from '../config/glAccounts';
import { ROLE_NAME_BY_USER_ROLE, defaultRoleRows } from '../config/defaultRoles';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { seedDefaultEmailTemplates } from './emailTemplateService';
import { ensureSystemUser } from './systemUserService';

type GrantResult = 'granted' | 'already there' | 'no stored list';

/**
 * A tenant that saved its role permissions before a cell was granted to admin keeps the old list (stored cells replace
 * the defaults). Add `action` to the stored admin `resource` list when it is missing; nothing is ever removed; no row or
 * no stored list changes nothing. `dryRun` only reports. Run once from a backfill or migration script, not on every seed,
 * so an owner who later removes the cell keeps it removed.
 */
async function grantAdminCell(
  tenantId: string,
  resource: string,
  action: string,
  db: Pick<TransactionClient, 'systemConfig'> = prisma,
  dryRun = false,
): Promise<GrantResult> {
  return runInTenant(tenantId, async () => {
    const config = await db.systemConfig.findFirst();
    const stored = config?.rolePermissions as Record<string, Record<string, string[]>> | null | undefined;
    const cells = stored?.admin?.[resource];
    if (!config || !Array.isArray(cells)) return 'no stored list';
    if (cells.includes(action)) return 'already there';
    if (!dryRun) {
      await db.systemConfig.update({
        where: { id: config.id },
        data: { rolePermissions: { ...stored, admin: { ...stored!.admin, [resource]: [...cells, action] } } },
      });
    }
    return 'granted';
  });
}

/** M2: `orders:update_status` for admin. */
export async function grantAdminUpdateStatus(tenantId: string): Promise<void> {
  await grantAdminCell(tenantId, 'orders', 'update_status');
}

/** M4: `products:update_stock` for admin (F-654). Called by the stock migration script, with its transaction. */
export const grantAdminUpdateStock = (tenantId: string, db?: Pick<TransactionClient, 'systemConfig'>, dryRun?: boolean): Promise<GrantResult> =>
  grantAdminCell(tenantId, 'products', 'update_stock', db, dryRun);

/** The oldest active super_admin person, when the Owner role has no current holder; else null. Call inside the tenant context. */
async function oldestOwnerCandidate(ownerRoleId: number): Promise<number | null> {
  if (await prisma.roleAssignment.count({ where: { roleId: ownerRoleId, toDate: null } }) > 0) return null;
  const user = await prisma.user.findFirst({ where: { role: 'super_admin', kind: 'person', isActive: true }, orderBy: { id: 'asc' }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * Create what a tenant is missing: the chart of accounts, the default email
 * templates, the default roles (with preset and permission grid) and the system user. Idempotent: re-running never creates duplicates (unique
 * `(tenantId, code)` on accounts, `(name, tenantId)` on email templates and
 * `(tenantId, name)` on roles; the system user is found by kind first).
 * Runs inside the tenant context so the Prisma extension stamps the tenantId.
 *
 * `ownerUserId` (signup): the tenant's first user, who gets the Owner role in the same call, right after the roles exist. Skipped
 * if they already hold it. Without it (the start-up seed, a backfill), an Owner role with no current holder is given to the
 * tenant's oldest active super_admin.
 *
 * SMS templates are not seeded: no default SMS content exists in the code.
 */
export async function seedTenantDefaults(tenantId: string, ownerUserId?: number): Promise<{ accounts: number; emailTemplates: number; roles: number; systemUser: number }> {
  const [accounts, emailTemplates, roles, systemUser] = await Promise.all([
    runInTenant(tenantId, async () => {
      const result = await prisma.account.createMany({
        data: DEFAULT_GL_ACCOUNTS.map((a) => ({
          ...a,
          description: `Default account: ${a.name}`,
          isActive: !RETIRED_GL_CODES.includes(a.code),
        })),
        skipDuplicates: true,
      });
      return result.count;
    }),
    seedDefaultEmailTemplates(tenantId),
    runInTenant(tenantId, async () => {
      // Rows are only inserted here, never updated: this runs at every server boot. Existing tenants get the preset and grid
      // from scripts/migrate-users-to-roles.ts.
      const config = await prisma.systemConfig.findFirst({ select: { rolePermissions: true } });
      const result = await prisma.role.createMany({
        data: defaultRoleRows(config?.rolePermissions).map((r) => ({ ...r, tenantId })),
        skipDuplicates: true,
      });
      const owner = await prisma.role.findFirstOrThrow({ where: { name: ROLE_NAME_BY_USER_ROLE.super_admin }, select: { id: true } });
      // Signup names the owner. Any other run fills an Owner role that has no holder, so a signup whose seed failed gets its role
      // at the next start.
      const holderId = ownerUserId ?? await oldestOwnerCandidate(owner.id);
      const alreadyHolds = ownerUserId !== undefined
        && await prisma.roleAssignment.count({ where: { roleId: owner.id, holderId: ownerUserId, toDate: null } }) > 0;
      if (holderId !== null && !alreadyHolds) {
        await prisma.roleAssignment.create({ data: { tenantId, roleId: owner.id, holderId, fromDate: startOfUtcDay() } });
      }
      return result.count;
    }),
    ensureSystemUser(tenantId).then(({ created }) => (created ? 1 : 0)),
  ]);
  if (accounts > 0 || emailTemplates > 0 || roles > 0 || systemUser > 0) {
    logger.info(`Seeded tenant defaults for ${tenantId}: ${accounts} accounts, ${emailTemplates} email templates, ${roles} roles, ${systemUser} system user`);
  }
  return { accounts, emailTemplates, roles, systemUser };
}
