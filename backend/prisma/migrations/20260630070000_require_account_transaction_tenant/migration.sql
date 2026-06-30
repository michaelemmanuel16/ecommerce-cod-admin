-- Repair + lock tenant_id on account_transactions.
--
-- Root cause: the Prisma tenant extension injects tenant_id only into the
-- top-level create, never the nested transactions.create. Background GL writers
-- (reconciliation cron / setImmediate) ran without AsyncLocalStorage context, so
-- their account_transactions were written tenant_id = NULL and vanished from
-- tenant-scoped financial reporting (June revenue read ~$200 instead of ~GHS 71k).
--
-- This migration is the historical repair AND the guardrail. Ordering matters:
-- the backfill MUST clear every NULL before the column can be locked NOT NULL,
-- so a dirty database can never silently pass this migration.

-- Step 1: Backfill orphaned rows from their parent journal entry's tenant.
-- The parent journal_entries are correctly tagged (verified: 100% coverage,
-- single tenant), making this deterministic. Covers ALL source types
-- (order_delivery, agent_collection, manual, etc.), not just revenue.
UPDATE "account_transactions" AS at
SET "tenant_id" = je."tenant_id"
FROM "journal_entries" AS je
WHERE at."journal_entry_id" = je."id"
  AND at."tenant_id" IS NULL
  AND je."tenant_id" IS NOT NULL;

-- Step 2: Lock the column. Fails loudly (rolls back the whole migration) if any
-- NULL remains — by design: a financial row with no tenant must never persist.
ALTER TABLE "account_transactions" ALTER COLUMN "tenant_id" SET NOT NULL;
