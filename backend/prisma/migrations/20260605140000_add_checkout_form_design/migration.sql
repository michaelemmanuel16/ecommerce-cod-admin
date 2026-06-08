-- Add design Json? column to CheckoutForm and backfill from styling.
-- Mapping: styling.buttonColor → design.colors.cta
--          styling.accentColor → design.colors.surface
-- Non-palette hex values are copied as-is; admin Save normalizes via Zod
-- (nearestPaletteHex) on next edit. See plan E4 + R1.
ALTER TABLE "checkout_forms" ADD COLUMN "design" JSONB;

UPDATE "checkout_forms"
SET "design" = jsonb_build_object(
  'colors', jsonb_strip_nulls(jsonb_build_object(
    'cta', NULLIF(styling->>'buttonColor', ''),
    'surface', NULLIF(styling->>'accentColor', '')
  ))
)
WHERE "design" IS NULL
  AND (
    NULLIF(styling->>'buttonColor', '') IS NOT NULL
    OR NULLIF(styling->>'accentColor', '') IS NOT NULL
  );
