-- MAN-61: seed the limits-only SaaS tier ladder and migrate existing tenants.
--
-- Tier model (limits-only): every active tier has every feature; tiers differ ONLY
-- by numeric caps. Growth ₦10,000 (5,000 orders / 10 staff) ⭐ · Scale ₦20,000
-- (unlimited) · Enterprise (contact, no Paystack code) · Free (admin-only, unlimited).
-- The `features` JSON is retained for marketing display only and is NOT read for
-- entitlement, so all active tiers carry the same all-true map.
--
-- Additive + idempotent: new rows upsert by unique name; old GHS tiers are
-- deactivated (kept for FK/history); existing tenants are remapped to Free-forever
-- so they are never billed or locked out once the enforcement sibling lands.
-- paystack_plan_code stays NULL here and is backfilled per-environment via the
-- Membrane ops step (test code in staging, live code in prod).

-- 1. Growth ⭐ — the workhorse paid tier.
INSERT INTO "plans" ("id","name","display_name","max_orders","max_users","price_ghs","price_ngn","paystack_plan_code","features","is_active")
VALUES (gen_random_uuid()::text, 'growth', 'Growth', 5000, 10, 0, 10000, NULL,
        '{"analytics":true,"api_access":true,"custom_webhooks":true,"priority_support":true}'::jsonb, true)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "max_orders" = EXCLUDED."max_orders",
  "max_users" = EXCLUDED."max_users",
  "price_ngn" = EXCLUDED."price_ngn",
  "features" = EXCLUDED."features",
  "is_active" = true;

-- 2. Scale — Growth with the ceiling removed (all caps NULL = unlimited).
INSERT INTO "plans" ("id","name","display_name","max_orders","max_users","price_ghs","price_ngn","paystack_plan_code","features","is_active")
VALUES (gen_random_uuid()::text, 'scale', 'Scale', NULL, NULL, 0, 20000, NULL,
        '{"analytics":true,"api_access":true,"custom_webhooks":true,"priority_support":true}'::jsonb, true)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "max_orders" = NULL,
  "max_users" = NULL,
  "price_ngn" = EXCLUDED."price_ngn",
  "features" = EXCLUDED."features",
  "is_active" = true;

-- 3. Enterprise — "Contact us": no Paystack code, no NGN price, unlimited caps.
INSERT INTO "plans" ("id","name","display_name","max_orders","max_users","price_ghs","price_ngn","paystack_plan_code","features","is_active")
VALUES (gen_random_uuid()::text, 'enterprise', 'Enterprise', NULL, NULL, 0, NULL, NULL,
        '{"analytics":true,"api_access":true,"custom_webhooks":true,"priority_support":true}'::jsonb, true)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "max_orders" = NULL,
  "max_users" = NULL,
  "price_ngn" = NULL,
  "features" = EXCLUDED."features",
  "is_active" = true;

-- 4. Free — admin-only (is_active=false hides it from public pricing / self-serve),
--    Scale-level unlimited caps, all features. Reshape the existing free row in place
--    (existing tenants already point at it, so the FK target is preserved).
INSERT INTO "plans" ("id","name","display_name","max_orders","max_users","price_ghs","price_ngn","paystack_plan_code","features","is_active")
VALUES (gen_random_uuid()::text, 'free', 'Free', NULL, NULL, 0, NULL, NULL,
        '{"analytics":true,"api_access":true,"custom_webhooks":true,"priority_support":true}'::jsonb, false)
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "max_orders" = NULL,
  "max_users" = NULL,
  "price_ngn" = NULL,
  "features" = EXCLUDED."features",
  "is_active" = false;

-- 5. Deactivate the legacy GHS tiers (kept for FK integrity / history, hidden from UI).
UPDATE "plans" SET "is_active" = false WHERE "name" IN ('starter', 'pro');

-- 6. Migrate every existing tenant to Free-forever (founder/dogfood accounts).
--    NOT Growth: a paid tier with no Paystack subscription behind it would later be
--    dunned/locked out by the enforcement sibling. Free + active + no expiry = never
--    billed, never locked. Environment-independent (resolves the free row by name).
UPDATE "tenants" SET
  "current_plan_id" = (SELECT "id" FROM "plans" WHERE "name" = 'free' LIMIT 1),
  "subscription_status" = 'active',
  "free_access_expires_at" = NULL;
