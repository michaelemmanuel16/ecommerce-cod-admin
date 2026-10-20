/**
 * Account codes and SKUs are unique per tenant: a script must say which tenant to
 * work on. Reads TENANT_ID or exits with usage.
 */
export function requireTenantIdEnv(): string {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    console.error('Set TENANT_ID to the tenant id, for example: TENANT_ID=<uuid> ...');
    process.exit(1);
  }
  return tenantId;
}
