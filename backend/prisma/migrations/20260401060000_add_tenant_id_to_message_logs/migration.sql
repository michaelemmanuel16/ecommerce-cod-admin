-- Add tenant_id to message_logs for tenant isolation
ALTER TABLE "message_logs" ADD COLUMN "tenant_id" TEXT;

-- Add index for tenant-scoped queries
CREATE INDEX "message_logs_tenant_id_idx" ON "message_logs"("tenant_id");

-- Add foreign key constraint
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
