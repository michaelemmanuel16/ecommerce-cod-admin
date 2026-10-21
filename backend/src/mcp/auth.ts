import { createHash } from 'crypto';
import { PrismaClient, UserKind } from '@prisma/client';
import type { AccessFacts } from '../services/toolAccessService';
import { MCP_CONFIG } from './config';

/**
 * Who an MCP key acts as: the tenant, the key's user (the actor) and the key's role. `access` holds the user's base
 * role and the role's tool list, read with the key, so the access check needs no further lookup.
 */
export interface McpPrincipal {
  tenantId: string;
  keyId: string;
  userId: number;
  actorKind: UserKind;
  roleId: number | null;
  access: AccessFacts;
}

/** One entry per key (by key hash), valid until `expires`. At AUTH_CACHE_MAX entries the whole cache is dropped. */
const authCache = new Map<string, { principal: McpPrincipal; expires: number }>();
const AUTH_CACHE_MAX = 500;

let mcpPrisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!mcpPrisma) {
    // Separate Prisma client with small connection pool for MCP server
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    const separator = url.includes('?') ? '&' : '?';
    mcpPrisma = new PrismaClient({
      datasources: {
        db: {
          url: `${url}${separator}connection_limit=${MCP_CONFIG.connectionPool.limit}`,
        },
      },
      log: [{ emit: 'event', level: 'error' }],
    });
  }
  return mcpPrisma;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key and resolve who it acts as.
 * Uses un-extended PrismaClient (no tenant context needed for key lookup).
 * The result (with the user's base role and the role's tool list) is cached per key for 60 seconds, so a revoked or expired key, or a deactivated user, stops
 * working within 60 seconds. A key with no user (made before every key had one) is refused.
 */
export async function validateKey(apiKey: string): Promise<McpPrincipal> {
  const keyHash = hashApiKey(apiKey);
  const now = Date.now();

  // Cache is keyed on the hash, so a changed key never gets another key's tenant.
  const cached = authCache.get(keyHash);
  if (cached && now < cached.expires) return cached.principal;

  const prisma = getPrisma();

  const mcpKey = await prisma.mcpApiKey.findUnique({
    where: { keyHash },
    include: {
      user: { select: { id: true, kind: true, isActive: true, tenantId: true, role: true } },
      role: { select: { tools: true } },
    },
  });

  if (!mcpKey) {
    throw new Error('Invalid API key');
  }

  if (mcpKey.revokedAt) {
    throw new Error('API key has been revoked');
  }

  if (mcpKey.expiresAt && mcpKey.expiresAt < new Date()) {
    throw new Error('API key has expired');
  }

  if (!mcpKey.tenantId) {
    throw new Error('API key is not linked to a tenant');
  }

  if (!mcpKey.user || mcpKey.user.tenantId !== mcpKey.tenantId) {
    throw new Error('API key is not linked to a user. Ask the owner to issue a new key.');
  }

  if (!mcpKey.user.isActive) {
    throw new Error('The user of this API key is deactivated');
  }

  // Update lastUsedAt (fire-and-forget, don't block the tool call)
  prisma.mcpApiKey.update({
    where: { id: mcpKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {
    // Swallow update errors — lastUsedAt is non-critical
  });

  const principal: McpPrincipal = {
    tenantId: mcpKey.tenantId,
    keyId: mcpKey.id,
    userId: mcpKey.user.id,
    actorKind: mcpKey.user.kind,
    roleId: mcpKey.roleId,
    access: {
      baseRole: mcpKey.user.role,
      roleTools: mcpKey.roleId === null ? null : Array.isArray(mcpKey.role?.tools) ? (mcpKey.role!.tools as string[]) : [],
    },
  };
  if (authCache.size >= AUTH_CACHE_MAX) authCache.clear();
  authCache.set(keyHash, { principal, expires: now + MCP_CONFIG.auth.cacheTtlMs });

  return principal;
}

/**
 * Clear the auth cache (useful for testing or when key is revoked).
 */
export function clearAuthCache(): void {
  authCache.clear();
}

/**
 * Disconnect the MCP Prisma client. Call on shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
  if (mcpPrisma) {
    await mcpPrisma.$disconnect();
    mcpPrisma = null;
  }
}
