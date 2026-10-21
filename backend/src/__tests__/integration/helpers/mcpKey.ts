import { randomBytes } from 'crypto';
import { prismaBase } from '../../../utils/prisma';
import { hashApiKey } from '../../../mcp/auth';

/**
 * An MCP key for a tenant: an ai_agent user (made here, unless `userId` is given, null for a key with no user), an optional
 * role by name and the key. Returns the raw key. `slug` keeps the user's email unique within the run.
 */
export async function makeMcpKey(
  tenantId: string,
  opts: { slug: string; userRole?: 'admin' | 'sales_rep' | 'super_admin'; roleName?: string | null; userId?: number | null },
) {
  const { slug, userRole = 'super_admin', roleName = null } = opts;
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
  const role = roleName ? await prismaBase.role.findFirstOrThrow({ where: { tenantId, name: roleName } }) : null;
  const key = `mcp_${randomBytes(16).toString('hex')}`;
  const row = await prismaBase.mcpApiKey.create({
    data: { tenantId, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 8), label: slug, userId, roleId: role?.id ?? null },
  });
  return { key, keyId: row.id, userId, roleId: role?.id ?? null };
}
