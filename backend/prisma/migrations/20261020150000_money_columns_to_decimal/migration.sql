-- M0 (COD-5, M0-T21): money columns from Float / Integer to Decimal(19,4).
-- Source: docs/plan/M0-money-units.md. Every column holds major units, so nothing is divided by 100.
-- No stored value has more than 2 decimals, so round(x, 4) keeps every value exactly.
-- Not converted: users.delivery_rate (removed, F1), products.weight (not money),
-- pending_checkouts.paystack_charge_minor (minor units by name).
-- form_packages.discount_value and form_upsells.discount_value hold money OR a percent.
-- They convert as they are. Code must read discount_type before it treats the value as money.
-- Undo: scripts/rollback-money-decimal.sql

ALTER TABLE "tenants"
  ALTER COLUMN "default_delivery_fee" SET DATA TYPE DECIMAL(19,4) USING round("default_delivery_fee"::numeric, 4);

ALTER TABLE "users"
  ALTER COLUMN "commission_amount" SET DATA TYPE DECIMAL(19,4) USING round("commission_amount"::numeric, 4),
  ALTER COLUMN "total_earnings" SET DATA TYPE DECIMAL(19,4) USING round("total_earnings"::numeric, 4);

ALTER TABLE "customers"
  ALTER COLUMN "total_spent" SET DATA TYPE DECIMAL(19,4) USING round("total_spent"::numeric, 4);

ALTER TABLE "products"
  ALTER COLUMN "price" SET DATA TYPE DECIMAL(19,4) USING round("price"::numeric, 4);

ALTER TABLE "orders"
  ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(19,4) USING round("subtotal"::numeric, 4),
  ALTER COLUMN "shipping_cost" SET DATA TYPE DECIMAL(19,4) USING round("shipping_cost"::numeric, 4),
  ALTER COLUMN "discount" SET DATA TYPE DECIMAL(19,4) USING round("discount"::numeric, 4),
  ALTER COLUMN "total_amount" SET DATA TYPE DECIMAL(19,4) USING round("total_amount"::numeric, 4),
  ALTER COLUMN "cod_amount" SET DATA TYPE DECIMAL(19,4) USING round("cod_amount"::numeric, 4),
  ALTER COLUMN "deposit_paid" SET DATA TYPE DECIMAL(19,4) USING round("deposit_paid"::numeric, 4),
  ALTER COLUMN "balance_due" SET DATA TYPE DECIMAL(19,4) USING round("balance_due"::numeric, 4);

ALTER TABLE "order_items"
  ALTER COLUMN "unit_price" SET DATA TYPE DECIMAL(19,4) USING round("unit_price"::numeric, 4),
  ALTER COLUMN "total_price" SET DATA TYPE DECIMAL(19,4) USING round("total_price"::numeric, 4);

ALTER TABLE "transactions"
  ALTER COLUMN "amount" SET DATA TYPE DECIMAL(19,4) USING round("amount"::numeric, 4);

ALTER TABLE "expenses"
  ALTER COLUMN "amount" SET DATA TYPE DECIMAL(19,4) USING round("amount"::numeric, 4);

ALTER TABLE "form_packages"
  ALTER COLUMN "price" SET DATA TYPE DECIMAL(19,4) USING round("price"::numeric, 4),
  ALTER COLUMN "discount_value" SET DATA TYPE DECIMAL(19,4) USING round("discount_value"::numeric, 4),
  ALTER COLUMN "original_price" SET DATA TYPE DECIMAL(19,4) USING round("original_price"::numeric, 4);

ALTER TABLE "form_upsells"
  ALTER COLUMN "price" SET DATA TYPE DECIMAL(19,4) USING round("price"::numeric, 4),
  ALTER COLUMN "discount_value" SET DATA TYPE DECIMAL(19,4) USING round("discount_value"::numeric, 4),
  ALTER COLUMN "original_price" SET DATA TYPE DECIMAL(19,4) USING round("original_price"::numeric, 4);

ALTER TABLE "form_submissions"
  ALTER COLUMN "total_amount" SET DATA TYPE DECIMAL(19,4) USING round("total_amount"::numeric, 4);

ALTER TABLE "pending_checkouts"
  ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(19,4) USING round("subtotal"::numeric, 4),
  ALTER COLUMN "shipping_cost" SET DATA TYPE DECIMAL(19,4) USING round("shipping_cost"::numeric, 4),
  ALTER COLUMN "discount" SET DATA TYPE DECIMAL(19,4) USING round("discount"::numeric, 4),
  ALTER COLUMN "total_amount" SET DATA TYPE DECIMAL(19,4) USING round("total_amount"::numeric, 4),
  ALTER COLUMN "cod_amount" SET DATA TYPE DECIMAL(19,4) USING round("cod_amount"::numeric, 4),
  ALTER COLUMN "balance_due" SET DATA TYPE DECIMAL(19,4) USING round("balance_due"::numeric, 4);

ALTER TABLE "payouts"
  ALTER COLUMN "amount" SET DATA TYPE DECIMAL(19,4) USING round("amount"::numeric, 4);

ALTER TABLE "product_cost_entries"
  ALTER COLUMN "amount" SET DATA TYPE DECIMAL(19,4) USING round("amount"::numeric, 4);
