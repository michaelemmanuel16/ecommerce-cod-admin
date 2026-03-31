-- CreateTable
CREATE TABLE IF NOT EXISTS "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");

-- AlterTable: add tenant_id to all tenant-scoped models (nullable, safe for tables that may not exist yet)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "users_tenant_id_idx" ON "users"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
    ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "customers_tenant_id_idx" ON "customers"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
    ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "products_tenant_id_idx" ON "products"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "orders_tenant_id_idx" ON "orders"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'deliveries') THEN
    ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "deliveries_tenant_id_idx" ON "deliveries"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_proofs') THEN
    ALTER TABLE "delivery_proofs" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "delivery_proofs_tenant_id_idx" ON "delivery_proofs"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'checkout_forms') THEN
    ALTER TABLE "checkout_forms" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "checkout_forms_tenant_id_idx" ON "checkout_forms"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflows') THEN
    ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "workflows_tenant_id_idx" ON "workflows"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_executions') THEN
    ALTER TABLE "workflow_executions" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "workflow_executions_tenant_id_idx" ON "workflow_executions"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'webhooks') THEN
    ALTER TABLE "webhooks" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "webhooks_tenant_id_idx" ON "webhooks"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "notifications_tenant_id_idx" ON "notifications"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'digital_delivery_tokens') THEN
    ALTER TABLE "digital_delivery_tokens" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "digital_delivery_tokens_tenant_id_idx" ON "digital_delivery_tokens"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_entries') THEN
    ALTER TABLE "gl_entries" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "gl_entries_tenant_id_idx" ON "gl_entries"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'accounts') THEN
    ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "accounts_tenant_id_idx" ON "accounts"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_inventory') THEN
    ALTER TABLE "agent_inventory" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "agent_inventory_tenant_id_idx" ON "agent_inventory"("tenant_id");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_shipments') THEN
    ALTER TABLE "inventory_shipments" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
    CREATE INDEX IF NOT EXISTS "inventory_shipments_tenant_id_idx" ON "inventory_shipments"("tenant_id");
  END IF;
END $$;
