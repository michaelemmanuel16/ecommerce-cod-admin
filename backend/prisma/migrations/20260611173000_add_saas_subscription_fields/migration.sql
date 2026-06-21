-- MAN-61: SaaS subscription billing fields.
-- CodAdmin charges its own tenants a recurring fee on CodAdmin's platform Paystack
-- account (inverse of the per-tenant buyer checkout). All columns are additive and
-- nullable so existing tenants/plans are unaffected until a subscription is bound.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "paystack_authorization_code" TEXT,
  ADD COLUMN IF NOT EXISTS "paystack_customer_code" TEXT,
  ADD COLUMN IF NOT EXISTS "paystack_subscription_code" TEXT,
  ADD COLUMN IF NOT EXISTS "subscription_renews_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_failed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paystack_card_last4" TEXT,
  ADD COLUMN IF NOT EXISTS "free_access_expires_at" TIMESTAMP(3);

-- Indexes for webhook tenant resolution (events arrive keyed by customer/subscription code).
CREATE INDEX IF NOT EXISTS "tenants_paystack_customer_code_idx" ON "tenants"("paystack_customer_code");
CREATE INDEX IF NOT EXISTS "tenants_paystack_subscription_code_idx" ON "tenants"("paystack_subscription_code");

-- NGN pricing for SaaS plans (priceGHS retained for back-compat).
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "price_ngn" DECIMAL(10,2);
