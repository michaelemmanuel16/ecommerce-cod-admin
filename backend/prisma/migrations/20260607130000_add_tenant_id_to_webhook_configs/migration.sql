-- Add the missing tenant_id column to webhook_configs.
-- The schema declared WebhookConfig.tenantId during the April multi-tenancy
-- work, but no migration ever created the column — every "add tenant_id"
-- migration skipped this table, and 20260401050000_add_tenant_id_foreign_keys
-- only attached the FK "IF EXISTS" the column (which it didn't). Result:
-- Prisma selects webhook_configs.tenant_id, Postgres rejects it, and every
-- webhook query (admin page + WPForms order intake) errors out.

ALTER TABLE "webhook_configs" ADD COLUMN "tenant_id" TEXT;

-- Index for tenant-scoped queries (matches sibling tables).
CREATE INDEX "webhook_configs_tenant_id_idx" ON "webhook_configs"("tenant_id");

-- Foreign key to tenants (mirrors the constraint 20260401050000 was prepared
-- to add once the column existed).
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- Backfill existing rows so tenant isolation doesn't hide them.
-- Step 1: inherit the tenant from the linked product where one is configured.
UPDATE "webhook_configs" wc
SET "tenant_id" = p."tenant_id"
FROM "products" p
WHERE wc."tenant_id" IS NULL
  AND wc."product_id" = p."id"
  AND p."tenant_id" IS NOT NULL;

-- Step 2: for any remaining rows, if this is a single-tenant deploy assign the
-- sole tenant. Multi-tenant deploys leave them NULL for manual assignment.
UPDATE "webhook_configs"
SET "tenant_id" = (SELECT "id" FROM "tenants" LIMIT 1)
WHERE "tenant_id" IS NULL
  AND (SELECT COUNT(*) FROM "tenants") = 1;
