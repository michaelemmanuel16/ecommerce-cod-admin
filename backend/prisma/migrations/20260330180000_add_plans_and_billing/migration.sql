-- Create plans table
CREATE TABLE "plans" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "max_orders" INTEGER,
  "max_users" INTEGER,
  "price_ghs" DECIMAL(10,2) NOT NULL,
  "paystack_plan_code" TEXT,
  "features" JSONB NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- Add billing fields to tenants
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "current_plan_id" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3);

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_current_plan_id_fkey"
  FOREIGN KEY ("current_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the 3 default plans
INSERT INTO "plans" ("id", "name", "display_name", "max_orders", "max_users", "price_ghs", "features") VALUES
  (gen_random_uuid(), 'free', 'Free', 100, 3, 0.00, '{"analytics": false, "api_access": false, "custom_webhooks": false, "priority_support": false}'),
  (gen_random_uuid(), 'starter', 'Starter', 1000, 10, 299.00, '{"analytics": true, "api_access": false, "custom_webhooks": true, "priority_support": false}'),
  (gen_random_uuid(), 'pro', 'Pro', NULL, NULL, 799.00, '{"analytics": true, "api_access": true, "custom_webhooks": true, "priority_support": true}');
