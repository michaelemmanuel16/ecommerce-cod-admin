-- Add missing tenant_id column to agent_stock
ALTER TABLE "agent_stock" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

-- Add index for tenant scoping
CREATE INDEX IF NOT EXISTS "agent_stock_tenant_id_idx" ON "agent_stock"("tenant_id");

-- Add FK constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'agent_stock_tenant_id_fkey'
  ) THEN
    ALTER TABLE "agent_stock" ADD CONSTRAINT "agent_stock_tenant_id_fkey" 
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
  END IF;
END $$;
