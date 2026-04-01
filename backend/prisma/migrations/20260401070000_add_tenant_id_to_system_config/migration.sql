-- Add tenant_id to system_config for per-tenant integration credentials
ALTER TABLE "system_config" ADD COLUMN "tenant_id" TEXT;

CREATE INDEX "system_config_tenant_id_idx" ON "system_config"("tenant_id");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_config' AND column_name = 'tenant_id') THEN
    ALTER TABLE "system_config" ADD CONSTRAINT "system_config_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
  END IF;
END $$;
