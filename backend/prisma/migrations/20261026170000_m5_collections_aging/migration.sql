-- M5-T13, M5-T14 (COD-50): the collection path is draft to reconciled; the aging cache table goes.
-- Safe to run twice: after the first run no verified or approved row is left, and the DROP and ADD VALUE use IF [NOT] EXISTS.

-- 1. Old verified and approved collections whose verify step already posted cash (an agent_collection journal entry)
--    are settled: they become reconciled and their orders paid. Their order rows first, while the collection status still tells which.
UPDATE "orders" AS o SET "payment_status" = 'reconciled'
FROM "agent_collections" AS c
WHERE c."order_id" = o."id"
  AND c."status"::text IN ('verified', 'approved')
  AND EXISTS (
    SELECT 1 FROM "journal_entries" AS j
    WHERE j."source_type"::text = 'agent_collection' AND j."source_id" = c."id" AND j."is_voided" = false AND j."tenant_id" = c."tenant_id"
  );

UPDATE "agent_collections" AS c
SET "status" = 'reconciled', "approved_at" = COALESCE(c."approved_at", c."verified_at", now()), "updated_at" = now()
WHERE c."status"::text IN ('verified', 'approved')
  AND EXISTS (
    SELECT 1 FROM "journal_entries" AS j
    WHERE j."source_type"::text = 'agent_collection' AND j."source_id" = c."id" AND j."is_voided" = false AND j."tenant_id" = c."tenant_id"
  );

-- 2. The rest never moved cash: the partner still holds it, so they go back to draft (open for a deposit or a settlement).
UPDATE "agent_collections" SET "status" = 'draft', "updated_at" = now()
WHERE "status"::text IN ('verified', 'approved');

-- 3. The aging cache table has no reader left: the card, the partner table and the Orders tab read live from the collections.
DROP TABLE IF EXISTS "agent_aging_buckets";

-- 4. A verify refused because it would take a partner below zero opens its own Finding type.
ALTER TYPE "FindingType" ADD VALUE IF NOT EXISTS 'verify_exceeds_cash_held';
