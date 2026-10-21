import { prismaBase } from '../../../utils/prisma';
import { generateMcpKey, hashApiKey } from '../../../mcp/auth';

/**
 * An MCP key for a tenant: an ai_agent user (made here, unless `userId` is given, null for a key with no user), an optional
 * role (by name or id) and the key. Returns the raw key. `slug` keeps the user's email unique within the run.
 */
export async function makeMcpKey(
  tenantId: string,
  opts: { slug: string; userRole?: 'admin' | 'sales_rep' | 'super_admin'; roleName?: string | null; roleId?: number | null; userId?: number | null; revokedAt?: Date },
) {
  const { slug, userRole = 'admin', roleName = null } = opts;
  let userId: number | null;
  if ('userId' in opts) {
    userId = opts.userId ?? null;
  } else {
    userId = (await prismaBase.user.create({
      data: {
        email: `${slug}-${tenantId}@codadmin.test`, password: 'x', firstName: slug, lastName: 'Agent',
        role: userRole, kind: 'ai_agent', tenantId,
      },
    })).id;
  }
  const roleId = opts.roleId ?? (roleName ? (await prismaBase.role.findFirstOrThrow({ where: { tenantId, name: roleName } })).id : null);
  const key = generateMcpKey();
  const row = await prismaBase.mcpApiKey.create({
    data: { tenantId, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 8), label: slug, userId, roleId, revokedAt: opts.revokedAt },
  });
  return { key, keyId: row.id, userId, roleId };
}
