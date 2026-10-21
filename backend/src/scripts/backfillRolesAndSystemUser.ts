/**
 * Backfill (M2-T02, M2-T03): seed the 7 default roles and the system user for every
 * existing tenant. Idempotent: re-running adds nothing. Also picks up tenants created
 * without seedTenantDefaults. Grants admin `orders:update_status` where stored permissions predate it.
 *
 * Run: npx ts-node src/scripts/backfillRolesAndSystemUser.ts
 */
import prisma from '../utils/prisma';
import { forEachTenant } from '../utils/tenantLoop';
import { grantAdminUpdateStatus, seedTenantDefaults } from '../services/tenantDefaultsService';

async function main() {
  console.log('Seeding default roles and the system user for every tenant...');

  let roles = 0;
  let systemUsers = 0;
  // seedTenantDefaults is idempotent: accounts and email templates already there are skipped
  await forEachTenant('Roles and system user backfill', async (tenantId) => {
    const result = await seedTenantDefaults(tenantId);
    roles += result.roles;
    systemUsers += result.systemUser;
    await grantAdminUpdateStatus(tenantId);
    console.log(`  ${tenantId}: +${result.roles} roles, +${result.systemUser} system user`);
  });

  console.log(`Done. Inserted ${roles} role(s) and ${systemUsers} system user(s).`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
