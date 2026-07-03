-- Meta click identifiers (fbp/fbc) captured at checkout, forwarded to the CAPI
-- Purchase event as match keys. Additive + nullable: safe on existing rows.
ALTER TABLE "orders" ADD COLUMN "fbp" TEXT;
ALTER TABLE "orders" ADD COLUMN "fbc" TEXT;

ALTER TABLE "pending_checkouts" ADD COLUMN "fbp" TEXT;
ALTER TABLE "pending_checkouts" ADD COLUMN "fbc" TEXT;
