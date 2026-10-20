-- M1 (COD-14, M1-T31): one store currency, in tenants.currency. Orders keep their own currency (decision O6, PRD 5.7).
-- Order of steps matters: copy first, then drop.
--   1. Copy system_config.currency into tenants.currency, only where it is set and differs from the old default (USD).
--   2. Add orders.currency (nullable), backfill it from the tenant, and fill it on insert with a trigger
--      so every write path (app, scripts, raw SQL) stores the currency the amount was entered in.
--   3. Drop system_config.currency. This is the one non-additive step of the migration.
-- Undo: ALTER TABLE system_config ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
--       UPDATE system_config sc SET currency = t.currency FROM tenants t WHERE t.id = sc.tenant_id;
--       DROP TRIGGER orders_set_currency ON orders; DROP FUNCTION orders_set_currency(); ALTER TABLE orders DROP COLUMN currency;

UPDATE "tenants" t
SET "currency" = sc."currency"
FROM "system_config" sc
WHERE sc."tenant_id" = t."id"
  AND sc."currency" IS NOT NULL
  AND sc."currency" <> ''
  AND sc."currency" <> 'USD';

ALTER TABLE "orders" ADD COLUMN "currency" VARCHAR(3);

UPDATE "orders" o
SET "currency" = t."currency"
FROM "tenants" t
WHERE t."id" = o."tenant_id" AND o."currency" IS NULL;

CREATE OR REPLACE FUNCTION orders_set_currency() RETURNS trigger AS $$
BEGIN
  IF NEW.currency IS NULL THEN
    SELECT t.currency INTO NEW.currency FROM tenants t WHERE t.id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_set_currency
  BEFORE INSERT ON "orders"
  FOR EACH ROW
  EXECUTE FUNCTION orders_set_currency();

ALTER TABLE "system_config" DROP COLUMN "currency";
