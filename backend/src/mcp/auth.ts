import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { MCP_CONFIG } from './config';

interface CachedAuth {
  keyHash: string;
  tenantId: string;
  validatedAt: number;
}

let authCache: CachedAuth | null = null;
let mcpPrisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!mcpPrisma) {
    // Separate Prisma client with small connection pool for MCP server
    const url = process.env.DATABASE_URL;
    const separator = url?.includes('?') ? '&' : '?';
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
 * Validate an API key and resolve its tenantId.
 * Uses un-extended PrismaClient (no tenant context needed for key lookup).
 * Results are cached for 60 seconds to reduce DB lookups.
 */
export async function validateKey(apiKey: string): Promise<string> {
  const keyHash = hashApiKey(apiKey);

  // Check cache — keyed on hash to prevent stale tenant if key changes
  if (authCache && authCache.keyHash === keyHash && Date.now() - authCache.validatedAt < MCP_CONFIG.auth.cacheTtlMs) {
    return authCache.tenantId;
  }

  const prisma = getPrisma();

  const mcpKey = await prisma.mcpApiKey.findUnique({
    where: { keyHash },
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

  // Update lastUsedAt (fire-and-forget, don't block the tool call)
  prisma.mcpApiKey.update({
    where: { id: mcpKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {
    // Swallow update errors — lastUsedAt is non-critical
  });

  // Cache the result — keyed on hash
  authCache = {
    keyHash,
    tenantId: mcpKey.tenantId,
    validatedAt: Date.now(),
  };

  return mcpKey.tenantId;
}

/**
 * Clear the auth cache (useful for testing or when key is revoked).
 */
export function clearAuthCache(): void {
  authCache = null;
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
