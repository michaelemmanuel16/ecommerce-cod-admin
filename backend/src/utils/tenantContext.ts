import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  tenantId: string | null;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getTenantId(): string | null {
  return tenantStorage.getStore()?.tenantId ?? null;
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
