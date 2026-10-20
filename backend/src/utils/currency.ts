import prisma from './prisma';
import { getTenantId } from './tenantContext';

const TTL_MS = 60_000;
const cache = new Map<string, { code: string; at: number }>();

/** Drop cached currency codes. Call after system config is saved. */
export function clearCurrencyCache(): void {
  cache.clear();
}

/**
 * Currency code of the current tenant (tenant-scoped through the Prisma extension), GHS by default.
 * Cached for 60 seconds per tenant: it is read on every email and MCP tool call.
 */
export async function getCurrency(): Promise<string> {
  const key = getTenantId() ?? '';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.code;
  try {
    const config = await prisma.systemConfig.findFirst({ select: { currency: true } });
    const code = config?.currency || 'GHS';
    cache.set(key, { code, at: Date.now() });
    return code;
  } catch {
    return 'GHS';
  }
}
