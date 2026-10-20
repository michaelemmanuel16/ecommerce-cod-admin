import { AsyncLocalStorage } from 'async_hooks';
import logger from './logger';

interface TenantStore {
  tenantId: string | null;
  // true only inside withoutTenant(): "no tenant, on purpose"
  unscoped?: boolean;
}

/** Thrown when a query on a tenant-scoped model runs with no tenant context. */
export class TenantContextMissing extends Error {
  constructor(model: string, operation: string) {
    super(`TenantContextMissing: ${model}.${operation} ran with no tenant context. Run it inside tenantStorage.run({ tenantId }) or withoutTenant(reason, fn).`);
    this.name = 'TenantContextMissing';
  }
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getTenantId(): string | null {
  return tenantStorage.getStore()?.tenantId ?? null;
}

export function isUnscoped(): boolean {
  return tenantStorage.getStore()?.unscoped === true;
}

/**
 * Run `fn` with an explicit "no tenant, on purpose" marker: scoped models are
 * queried without a tenant filter. Use only for platform admin, seeds, and the
 * lookups that find the tenant (token, slug, provider id). Always give a reason.
 */
export function withoutTenant<T>(reason: string, fn: () => T | Promise<T>): Promise<T> {
  logger.debug(`[tenant] running without tenant context: ${reason}`);
  // async wrapper: Prisma queries are lazy (they dispatch on .then), so the store
  // must stay alive until the returned promise settles.
  return tenantStorage.run({ tenantId: null, unscoped: true }, async () => fn());
}

/**
 * Tenant for a new row in a tenant-scoped table. Prefer the parent row's tenant,
 * then the request tenant context. Throws instead of writing a row with no tenant.
 */
export function resolveTenantId(parentTenantId?: string | null): string {
  const tenantId = parentTenantId ?? getTenantId();
  if (!tenantId) {
    throw new Error('Cannot create row: no tenant on the parent row or in the tenant context');
  }
  return tenantId;
}
