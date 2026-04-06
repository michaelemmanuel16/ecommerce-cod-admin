-- Change customer phone_number unique constraint from global to per-tenant
DROP INDEX IF EXISTS "customers_phone_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_number_tenant_key" ON "customers" ("phone_number", "tenant_id");
