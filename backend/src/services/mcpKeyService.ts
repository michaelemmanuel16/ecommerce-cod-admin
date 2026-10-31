import { randomBytes } from 'crypto';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prismaBase } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { roleToolList } from '../config/defaultRoles';
import { evictKey, generateMcpKey, hashApiKey } from '../mcp/auth';
import { createAiAgentUser } from './systemUserService';

export const MAX_KEYS_PER_TENANT = 5;
const DEFAULT_EXPIRY_DAYS = 90;

type KeyParams = { tenantId: string; label: string; roleId: number; userId?: number; expiresInDays?: number };

/**
 * Make an MCP key for a tenant, inside the caller's transaction `tx` (an un-extended client, so every lookup names the tenant).
 * The role must be the tenant's; `userId`, when given, must be one of its ai_agent users, otherwise the key gets a new ai_agent
 * user named after it. Returns the raw key: it exists only here.
 */
export async function createKeyIn(tx: Prisma.TransactionClient, p: KeyParams) {
  const { tenantId, label } = p;
  const rawKey = generateMcpKey();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (p.expiresInDays ?? DEFAULT_EXPIRY_DAYS));

  const role = await tx.role.findFirst({ where: { id: p.roleId, tenantId }, select: { id: true, name: true, tools: true } });
  if (!role) throw new AppError('Role not found', 400);

  if (p.userId !== undefined) {
    const agent = await tx.user.findFirst({ where: { id: p.userId, tenantId, kind: 'ai_agent' }, select: { id: true } });
    if (!agent) throw new AppError('userId must be an AI agent user of this tenant', 400);
  }

  const active = await tx.mcpApiKey.count({ where: { tenantId, revokedAt: null } });
  if (active >= MAX_KEYS_PER_TENANT) throw new AppError(`Maximum ${MAX_KEYS_PER_TENANT} active API keys per tenant`, 400);

  const userId = p.userId ?? (await createAiAgentUser(tx, {
    tenantId,
    name: label,
    email: `ai-agent+${randomBytes(8).toString('hex')}@mcp.codadmin.internal`,
  })).id;

  const key = await tx.mcpApiKey.create({
    data: { tenantId, keyHash: hashApiKey(rawKey), keyPrefix: rawKey.substring(0, 12), label, expiresAt, userId, roleId: role.id },
  });
  return { key, rawKey, roleName: role.name, toolCount: roleToolList(role.tools).length };
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

/** Revoke a tenant's key (the row stays). Null when there is no such active key. */
export async function revokeKey(tenantId: string, id: string) {
  return prismaBase.$transaction(async (tx) => {
    const key = await tx.mcpApiKey.findFirst({ where: { id, tenantId, revokedAt: null } });
    if (!key) return null;
    return tx.mcpApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }).then((key) => {
    if (key) evictKey(key.keyHash);
    return key;
  });
}
