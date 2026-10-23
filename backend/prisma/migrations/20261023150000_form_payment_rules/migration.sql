-- M3b-T05 (COD-31): tenant feature switches (features.prepaidPhysical, F-402) and the unused Tenant.defaultDeliveryFee (F-423).
-- default_delivery_fee had no reader in the code and was empty on dev, the production-dump copy and the test database.
ALTER TABLE "system_config" ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "tenants" DROP COLUMN "default_delivery_fee";
