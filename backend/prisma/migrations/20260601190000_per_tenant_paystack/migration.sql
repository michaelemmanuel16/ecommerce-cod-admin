-- MAN-66 Phase 1.5: per-tenant Paystack
-- - SystemConfig.tenant_id becomes unique so one config per tenant.
-- - webhook_events unique flips to tenant-scoped so two tenants can share a
--   Paystack reference without colliding.

-- Step 1: dedupe duplicate SystemConfig rows per tenant (keep newest id)
DELETE FROM "system_config" a
USING "system_config" b
WHERE a.id < b.id
  AND a.tenant_id IS NOT NULL
  AND a.tenant_id = b.tenant_id;

-- Step 2: enforce one SystemConfig per tenant.
-- Postgres treats multiple NULL tenant_id as distinct, so legacy/global rows
-- coexist without breaking the constraint.
CREATE UNIQUE INDEX "system_config_tenant_id_key" ON "system_config"("tenant_id");

-- Step 3: tenant-scoped webhook idempotency
DROP INDEX IF EXISTS "webhook_events_provider_event_type_reference_key";

CREATE UNIQUE INDEX "webhook_events_tenant_id_provider_event_type_reference_key"
  ON "webhook_events"("tenant_id", "provider", "event_type", "reference");
