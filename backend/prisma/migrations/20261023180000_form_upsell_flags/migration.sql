-- COD-35: an upsell's on/off switch and popular flag are real columns (they were kept in the items JSON).
-- Undo: ALTER TABLE form_upsells DROP COLUMN is_active, DROP COLUMN is_popular;
ALTER TABLE "form_upsells" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "form_upsells" ADD COLUMN "is_popular" BOOLEAN NOT NULL DEFAULT false;

-- Rows saved with the flags inside items keep their meaning; the two keys are then dropped from items.
UPDATE "form_upsells"
SET "is_active" = NOT COALESCE(("items"->>'off')::boolean, false),
    "is_popular" = COALESCE(("items"->>'popular')::boolean, false),
    "items" = "items" - 'off' - 'popular'
WHERE "items" ? 'off' OR "items" ? 'popular';
