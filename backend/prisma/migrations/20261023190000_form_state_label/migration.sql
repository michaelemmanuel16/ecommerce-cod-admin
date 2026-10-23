-- COD-36: the buyer's form calls the region field "State" (owner decision 2026-10-23, F-413).
-- Stored forms whose label is "Region" or "Region/State" (any case, spaces ignored) get the label "State".
-- Other labels (for example "County") are left as the owner typed them. Field order and every other key stay as they were.
-- Undo: there is no automatic undo (the old label is not kept). To go back, set the label of the field with "standardKey" = 'region' to "Region".
UPDATE "checkout_forms"
SET "fields" = (
  SELECT jsonb_agg(
    CASE
      WHEN jsonb_typeof(f.elem) = 'object' AND lower(btrim(f.elem->>'label')) ~ '^region(\s*/\s*state)?$'
        THEN jsonb_set(f.elem, '{label}', '"State"')
      ELSE f.elem
    END
    ORDER BY f.ord
  )
  FROM jsonb_array_elements("fields"::jsonb) WITH ORDINALITY AS f(elem, ord)
)
WHERE jsonb_typeof("fields"::jsonb) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("fields"::jsonb) AS e(elem)
    WHERE jsonb_typeof(e.elem) = 'object' AND lower(btrim(e.elem->>'label')) ~ '^region(\s*/\s*state)?$'
  );
