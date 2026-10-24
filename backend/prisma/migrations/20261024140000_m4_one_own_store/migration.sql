-- One own store per tenant (F-652). Prisma cannot express a partial unique index, so it lives here only.
-- Checked before writing: no tenant on the test databases or the production-dump copy has two own stores.
CREATE UNIQUE INDEX "stock_locations_one_own_store_per_tenant" ON "stock_locations"("tenant_id") WHERE "type" = 'own_store';
