import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES, LEGACY_MCP_ROLE_NAME } from '../src/config/defaultRoles';
import { createAiAgentUser } from '../src/services/systemUserService';
import { assertNotProduction, groupByTenant, hasFlag } from './lib/scriptArgs';

// Gives every old MCP key a user and a role, so the key keeps working now that a key needs both.
// For each tenant and each key that is not revoked and has no user or no role:
//   - the tenant gets the "Legacy MCP (14 tools)" role if it has none (all 14 tools),
//   - a key with no user gets an ai_agent user "<label> (legacy)",
//   - the key gets that user and that role.
// Creates and updates only, never deletes. Idempotent: a key that has both is skipped, and an existing role is reused.
// Dry run by default (prints the plan, writes nothing); pass --apply to write.
// Plain PrismaClient on purpose: no tenant extension, so every tenant is visible; rows are grouped by tenant_id.
// Refuses to run when NODE_ENV=production unless --allow-production.
const prisma = new PrismaClient();
const apply = hasFlag('--apply');

const legacyRoleDef = DEFAULT_ROLES.find((r) => r.name === LEGACY_MCP_ROLE_NAME)!;

async function main() {
  if (!assertNotProduction()) return;
  console.log(apply ? 'MODE: apply (writes)' : 'MODE: dry run (no writes; pass --apply to write)');

  const keys = await prisma.mcpApiKey.findMany({
    where: { revokedAt: null, OR: [{ userId: null }, { roleId: null }] },
    select: { id: true, tenantId: true, keyPrefix: true, label: true, userId: true, roleId: true },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  });

  const report: Array<Record<string, string | number>> = [];
  for (const [tenantId, tenantKeys] of groupByTenant(keys)) {
    if (!tenantId) continue; // a key with no tenant cannot be placed
    let role = await prisma.role.findUnique({ where: { tenantId_name: { tenantId, name: LEGACY_MCP_ROLE_NAME } }, select: { id: true } });
    if (!role && apply) {
      role = await prisma.role.create({
        data: { ...legacyRoleDef, tenantId, kpis: [] },
        select: { id: true },
      });
    }
    for (const key of tenantKeys) {
      let userId = key.userId;
      if (apply) {
        // User and key update in one transaction, so a failure leaves nothing half done and a rerun starts clean.
        userId = await prisma.$transaction(async (tx) => {
          const id = key.userId ?? (await createAiAgentUser(tx, {
            tenantId,
            name: `${key.label} (legacy)`,
            email: `ai-agent+legacy-${key.id}@mcp.codadmin.internal`,
          })).id;
          await tx.mcpApiKey.update({ where: { id: key.id }, data: { userId: id, roleId: key.roleId ?? role!.id } });
          return id;
        });
      }
      report.push({
        tenant: tenantId,
        key: key.keyPrefix,
        label: key.label,
        user: userId ?? `new: ${key.label} (legacy)`,
        role: key.roleId !== null ? `kept (id ${key.roleId})` : role ? `${LEGACY_MCP_ROLE_NAME} (id ${role.id})` : `new: ${LEGACY_MCP_ROLE_NAME}`,
      });
    }
  }

  if (report.length === 0) console.log('No keys need migrating.');
  else console.table(report);
  console.log(`${apply ? 'Migrated' : 'Would migrate'} ${report.length} key(s).`);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
