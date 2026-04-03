-- Backfill tenant_id for existing system_config rows that have NULL tenant_id.
-- For single-tenant deployments: assign to the only tenant.
-- For multi-tenant: match by business_name = tenant.name, or assign to first tenant as fallback.

-- Match by business name where possible
UPDATE system_config sc
SET tenant_id = t.id
FROM tenants t
WHERE sc.tenant_id IS NULL
  AND sc.business_name IS NOT NULL
  AND sc.business_name = t.name;

-- For remaining unmatched rows (no business_name or name didn't match),
-- assign to the single tenant if only one exists
UPDATE system_config
SET tenant_id = (SELECT id FROM tenants LIMIT 1)
WHERE tenant_id IS NULL
  AND (SELECT COUNT(*) FROM tenants) = 1;

-- Delete orphaned rows that couldn't be matched to any tenant
-- (multi-tenant with no business_name match — these are stale)
DELETE FROM system_config WHERE tenant_id IS NULL;
