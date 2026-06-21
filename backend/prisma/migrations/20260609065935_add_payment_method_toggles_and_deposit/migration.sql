-- MAN-58: per-form payment-method matrix (COD / Paystack deposit / Paystack full)
-- and order-level deposit accounting. Columns are additive; existing forms keep
-- COD-only behavior via the codEnabled default.
ALTER TABLE "checkout_forms"
  ADD COLUMN IF NOT EXISTS "cod_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "paystack_deposit_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "paystack_full_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deposit_percent" INTEGER;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "deposit_paid" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "balance_due" INTEGER NOT NULL DEFAULT 0;
