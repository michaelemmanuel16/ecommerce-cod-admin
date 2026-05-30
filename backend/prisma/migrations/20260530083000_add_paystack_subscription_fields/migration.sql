ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "paystack_authorization_code" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "paystack_customer_code" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "paystack_subscription_code" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "paystack_subscription_token" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_renews_at" TIMESTAMP(3);

