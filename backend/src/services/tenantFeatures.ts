import prisma, { TransactionClient } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import type { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

/** Tenant feature switches stored in SystemConfig.features, with their defaults. */
export const FEATURE_DEFAULTS = {
  /** Physical forms may take online payment (F-402). */
  prepaidPhysical: false,
};

export type TenantFeatures = typeof FEATURE_DEFAULTS;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { data: TenantFeatures; fetchedAt: number }>();

export function clearTenantFeaturesCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** The tenant's feature switches (cached 60 s). Must run inside the tenant's context. */
export async function getTenantFeatures(tenantId: string | null | undefined): Promise<TenantFeatures> {
  if (!tenantId) return { ...FEATURE_DEFAULTS };
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data;

  const config = await prisma.systemConfig.findUnique({ where: { tenantId }, select: { features: true } });
  const stored = (config?.features ?? {}) as Record<string, unknown>;
  const data = { ...FEATURE_DEFAULTS, prepaidPhysical: stored.prepaidPhysical === true };
  cache.set(tenantId, { data, fetchedAt: Date.now() });
  return data;
}

/** The features object to save: the stored one with the known boolean keys of the request merged in. Anything else is refused. */
export function parseFeaturePatch(stored: unknown, sent: unknown): Record<string, unknown> {
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) {
    throw new AppError('features must be an object', 400, 'INVALID_FEATURES');
  }
  const patch: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURE_DEFAULTS)) {
    const value = (sent as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new AppError(`features.${key} must be true or false`, 400, 'INVALID_FEATURES');
    patch[key] = value;
  }
  return { ...((stored ?? {}) as Record<string, unknown>), ...patch };
}

/** What the Rewards settings keep in `features.rewards` (M6-T09). Money and percent are 2-decimal strings. */
export interface RewardFeatures { baseCommission?: string; upsellPercent?: string; badgesDisplay?: boolean }

/** The tenant's stored reward settings; empty fields mean "not set yet" (the service applies its defaults). Inside the tenant's context. */
export async function getRewardFeatures(): Promise<RewardFeatures> {
  const config = await prisma.systemConfig.findFirst({ select: { features: true } });
  return ((config?.features ?? {}) as { rewards?: RewardFeatures }).rewards ?? {};
}

/**
 * Save one key of `SystemConfig.features` for the current tenant, inside the caller's transaction, leaving every other key as
 * it is. Creates the config row when there is none. Call `clearTenantFeaturesCache` after the transaction commits.
 */
export async function mergeFeatureKey(tx: TransactionClient, key: string, value: Prisma.InputJsonValue): Promise<void> {
  const tenantId = resolveTenantId();
  const config = await tx.systemConfig.findUnique({ where: { tenantId }, select: { features: true } });
  const features = { ...((config?.features ?? {}) as Record<string, Prisma.InputJsonValue>), [key]: value };
  await tx.systemConfig.upsert({ where: { tenantId }, create: { tenantId, features }, update: { features } });
}
