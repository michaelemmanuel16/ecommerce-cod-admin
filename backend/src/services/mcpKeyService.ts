import { randomBytes } from 'crypto';
import path from 'path';
import { Prisma, UserRole } from '@prisma/client';
import { prismaBase } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { registryToolsOfRole } from '../config/roleToolRules';
import { getTenantMatrix } from './permissionService';
import { evictKey, generateMcpKey, hashApiKey } from '../mcp/auth';
import { createAiAgentUser } from './systemUserService';
import { holderSelect } from './roleService';

export const MAX_KEYS_PER_TENANT = 5;
const DEFAULT_EXPIRY_DAYS = 90;

type KeyParams = { tenantId: string; label: string; roleId: number; userId?: number; expiresInDays?: number };
type KeyRole = { id: number; name: string; tools: unknown; isSystem: boolean; permissions: unknown; presetRole: UserRole | null };

/**
 * Make an MCP key for a tenant, inside the caller's transaction `tx` (an un-extended client, so every lookup names the tenant).
 * The role must be the tenant's; `userId`, when given, must be one of its ai_agent users, otherwise the key gets a new ai_agent
 * user named after it. A caller that has read the role passes it as `role` (it must be the tenant's). Returns the raw key
 * (it exists only here) and the agent user the key acts as.
 */
export async function createKeyIn(tx: Prisma.TransactionClient, p: KeyParams, loaded?: KeyRole) {
  const { tenantId, label } = p;
  const rawKey = generateMcpKey();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (p.expiresInDays ?? DEFAULT_EXPIRY_DAYS));

  const role = loaded ?? await tx.role.findFirst({ where: { id: p.roleId, tenantId }, select: { id: true, name: true, tools: true, isSystem: true, permissions: true, presetRole: true } });
  if (!role) throw new AppError('Role not found', 400);

  let agent = p.userId === undefined
    ? undefined
    : await tx.user.findFirst({ where: { id: p.userId, tenantId, kind: 'ai_agent' }, select: holderSelect });
  if (p.userId !== undefined && !agent) throw new AppError('userId must be an AI agent user of this tenant', 400);

  const active = await tx.mcpApiKey.count({ where: { tenantId, revokedAt: null } });
  if (active >= MAX_KEYS_PER_TENANT) throw new AppError(`Maximum ${MAX_KEYS_PER_TENANT} active API keys per tenant`, 400);

  agent ??= await createAiAgentUser(tx, {
    tenantId,
    name: label,
    email: `ai-agent+${randomBytes(8).toString('hex')}@mcp.codadmin.internal`,
  });

  const key = await tx.mcpApiKey.create({
    data: { tenantId, keyHash: hashApiKey(rawKey), keyPrefix: rawKey.substring(0, 12), label, expiresAt, userId: agent.id, roleId: role.id },
  });
  return { key, rawKey, agent, roleName: role.name, toolCount: registryToolsOfRole(role, await getTenantMatrix(tenantId)).length };
}

/** Make an MCP key for a tenant (see createKeyIn); the checks, the key limit and the writes share one transaction. */
export const createKey = (p: KeyParams) => prismaBase.$transaction((tx) => createKeyIn(tx, p));

/** The client config shown once next to a new key. FRONTEND_URL doubles as the public base URL (nginx fronts frontend and backend). */
export function buildMcpConfig(rawKey: string, baseUrl: string) {
  return {
    remote: {
      mcpServers: {
        'cod-admin': {
          type: 'http',
          url: `${baseUrl}/mcp`,
          headers: { Authorization: `Bearer ${rawKey}` },
        },
      },
    },
    local: {
      mcpServers: {
        'cod-admin': {
          command: 'node',
          args: [path.resolve(__dirname, '..', 'mcp', 'server.js')],
          env: { COD_ADMIN_API_KEY: rawKey },
        },
      },
    },
  };
}

/**
 * Revoke the active keys that match `where` (the rows stay), inside the caller's transaction. Returns the revoked rows. Call
 * `evictKeys` with them once the transaction has committed, so a revoked key stops working at once.
 */
export async function revokeKeysIn(tx: Prisma.TransactionClient, where: Prisma.McpApiKeyWhereInput) {
  const active = { ...where, revokedAt: null };
  const keys = await tx.mcpApiKey.findMany({ where: active });
  if (keys.length) await tx.mcpApiKey.updateMany({ where: { id: { in: keys.map((k) => k.id) } }, data: { revokedAt: new Date() } });
  return keys;
}

export const evictKeys = (keys: Array<{ keyHash: string }>): void => keys.forEach((k) => evictKey(k.keyHash));

/** Revoke a tenant's key (the row stays). Null when there is no such active key. */
export async function revokeKey(tenantId: string, id: string) {
  const [key] = await prismaBase.$transaction((tx) => revokeKeysIn(tx, { id, tenantId }));
  if (key) evictKeys([key]);
  return key ?? null;
}
