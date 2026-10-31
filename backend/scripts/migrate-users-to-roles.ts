import prisma, { prismaBase } from '../src/utils/prisma';
import { runInTenant } from '../src/utils/tenantContext';
import { assignUsersToPositionRoles, seedSystemRoles, SystemRoleResult, UserMigrationResult } from '../src/services/systemRoleService';
import { runPerTenant } from './lib/scriptArgs';
// M6-T02 (COD-56, F-1155). Seeds the system roles (Admin, Manager, presets and permission grids) and gives every person and
// company user a RoleAssignment to the role mapped from their UserRole. The tenant's saved permission matrix is copied to the
// roles, not reset. Per tenant, inside the tenant context and one transaction. Idempotent: a second run changes nothing.
// Flags: --dry-run, --tenant <id>, --allow-production. The flag is what makes the counts: the service functions skip every write.
// SET TRANSACTION READ ONLY is the safety net: if a write slipped into a dry run, the database would refuse it.
//
// Tenant scope: the tenant extension hides rows whose tenant_id is NULL, so users with no tenant are never migrated.
// They are counted below with the base client (read only) so the report shows them.
interface TenantReport {
  tenantId: string;
  roles: SystemRoleResult;
  users: UserMigrationResult;
}

export async function migrateTenant(tenantId: string, opts: { dryRun: boolean }): Promise<TenantReport> {
  return runInTenant(tenantId, () =>
    prisma.$transaction(async (tx) => {
      if (opts.dryRun) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const roles = await seedSystemRoles(tenantId, tx, opts.dryRun);
      const users = await assignUsersToPositionRoles(tenantId, tx, opts.dryRun);
      return { tenantId, roles, users };
    }),
  );
}

function printReport(r: TenantReport, dryRun: boolean): void {
  const assigned = Object.entries(r.users.assigned).map(([role, n]) => `${role} ${n}`).join(', ') || 'none';
  const verb = dryRun ? 'would' : 'did';
  console.log(`Tenant ${r.tenantId}: ${verb} create ${r.roles.created} role(s), fill ${r.roles.filled} role(s); ${verb} assign ${assigned}; already held ${r.users.alreadyHeld}`);
}

if (require.main === module) {
  void (async () => {
    const noTenant = await prismaBase.user.count({ where: { tenantId: null } });
    if (noTenant) console.log(`Users with no tenant (not migrated): ${noTenant}`);
    await runPerTenant(async (tenantId, dryRun) => printReport(await migrateTenant(tenantId, { dryRun }), dryRun));
  })();
}
