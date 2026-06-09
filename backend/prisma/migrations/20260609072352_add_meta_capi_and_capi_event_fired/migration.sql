-- MAN-59: Meta Conversion API config on the form + per-order fire flag.
-- metaCapiAccessToken is encrypted at rest (enc:v1: prefix) by the app layer.
ALTER TABLE "checkout_forms"
  ADD COLUMN IF NOT EXISTS "meta_capi_access_token" TEXT,
  ADD COLUMN IF NOT EXISTS "meta_capi_test_event_code" TEXT;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "capi_event_fired" BOOLEAN NOT NULL DEFAULT false;
