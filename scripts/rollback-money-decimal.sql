-- M0-T26: undo the money Decimal migration (20261020150000_money_columns_to_decimal).
-- Decimal(19,4) goes back to double precision. orders.deposit_paid, orders.balance_due and
-- pending_checkouts.balance_due go back to integer (they were integer before; all values were 0).
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/rollback-money-decimal.sql
-- After it, mark the migration: npx prisma migrate resolve --rolled-back 20261020150000_money_columns_to_decimal
-- and restore the old schema.prisma (git revert of the T21 commit).
-- A value with more than 2 decimals that was written after the migration may lose digits (float) or be rounded (integer).

BEGIN;

ALTER TABLE "tenants"
  ALTER COLUMN "default_delivery_fee" SET DATA TYPE DOUBLE PRECISION USING "default_delivery_fee"::double precision;

ALTER TABLE "users"
  ALTER COLUMN "commission_amount" SET DATA TYPE DOUBLE PRECISION USING "commission_amount"::double precision,
  ALTER COLUMN "total_earnings" SET DATA TYPE DOUBLE PRECISION USING "total_earnings"::double precision;

ALTER TABLE "customers"
  ALTER COLUMN "total_spent" SET DATA TYPE DOUBLE PRECISION USING "total_spent"::double precision;

ALTER TABLE "products"
  ALTER COLUMN "price" SET DATA TYPE DOUBLE PRECISION USING "price"::double precision;

ALTER TABLE "orders"
  ALTER COLUMN "subtotal" SET DATA TYPE DOUBLE PRECISION USING "subtotal"::double precision,
  ALTER COLUMN "shipping_cost" SET DATA TYPE DOUBLE PRECISION USING "shipping_cost"::double precision,
  ALTER COLUMN "discount" SET DATA TYPE DOUBLE PRECISION USING "discount"::double precision,
  ALTER COLUMN "total_amount" SET DATA TYPE DOUBLE PRECISION USING "total_amount"::double precision,
  ALTER COLUMN "cod_amount" SET DATA TYPE DOUBLE PRECISION USING "cod_amount"::double precision,
  ALTER COLUMN "deposit_paid" SET DATA TYPE INTEGER USING round("deposit_paid")::integer,
  ALTER COLUMN "balance_due" SET DATA TYPE INTEGER USING round("balance_due")::integer;

ALTER TABLE "order_items"
  ALTER COLUMN "unit_price" SET DATA TYPE DOUBLE PRECISION USING "unit_price"::double precision,
  ALTER COLUMN "total_price" SET DATA TYPE DOUBLE PRECISION USING "total_price"::double precision;

ALTER TABLE "transactions"
  ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION USING "amount"::double precision;

ALTER TABLE "expenses"
  ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION USING "amount"::double precision;

ALTER TABLE "form_packages"
  ALTER COLUMN "price" SET DATA TYPE DOUBLE PRECISION USING "price"::double precision,
  ALTER COLUMN "discount_value" SET DATA TYPE DOUBLE PRECISION USING "discount_value"::double precision,
  ALTER COLUMN "original_price" SET DATA TYPE DOUBLE PRECISION USING "original_price"::double precision;

ALTER TABLE "form_upsells"
  ALTER COLUMN "price" SET DATA TYPE DOUBLE PRECISION USING "price"::double precision,
  ALTER COLUMN "discount_value" SET DATA TYPE DOUBLE PRECISION USING "discount_value"::double precision,
  ALTER COLUMN "original_price" SET DATA TYPE DOUBLE PRECISION USING "original_price"::double precision;

ALTER TABLE "form_submissions"
  ALTER COLUMN "total_amount" SET DATA TYPE DOUBLE PRECISION USING "total_amount"::double precision;

ALTER TABLE "pending_checkouts"
  ALTER COLUMN "subtotal" SET DATA TYPE DOUBLE PRECISION USING "subtotal"::double precision,
  ALTER COLUMN "shipping_cost" SET DATA TYPE DOUBLE PRECISION USING "shipping_cost"::double precision,
  ALTER COLUMN "discount" SET DATA TYPE DOUBLE PRECISION USING "discount"::double precision,
  ALTER COLUMN "total_amount" SET DATA TYPE DOUBLE PRECISION USING "total_amount"::double precision,
  ALTER COLUMN "cod_amount" SET DATA TYPE DOUBLE PRECISION USING "cod_amount"::double precision,
  ALTER COLUMN "balance_due" SET DATA TYPE INTEGER USING round("balance_due")::integer;

ALTER TABLE "payouts"
  ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION USING "amount"::double precision;

ALTER TABLE "product_cost_entries"
  ALTER COLUMN "amount" SET DATA TYPE DOUBLE PRECISION USING "amount"::double precision;

COMMIT;
