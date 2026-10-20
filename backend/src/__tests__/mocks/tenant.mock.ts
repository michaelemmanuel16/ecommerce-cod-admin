import { beforeEach, jest } from '@jest/globals';
import { tenantStorage } from '../../utils/tenantContext';

export const TEST_TENANT_ID = 'tenant-test';

/**
 * Run every test in this file as if inside a tenant context (new rows require a tenant).
 * AsyncLocalStorage.enterWith does not reach the test body, so the store is stubbed.
 */
export function useTestTenant(tenantId: string = TEST_TENANT_ID): void {
  beforeEach(() => stubTenantStore({ tenantId }));
}

/** Make the tenant store read as `store` for the rest of the test (the stub useTestTenant installs). */
export function stubTenantStore(store: { tenantId: string | null; unscoped?: boolean }): void {
  jest.spyOn(tenantStorage, 'getStore').mockReturnValue(store);
}
