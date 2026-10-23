-- COD-32 review: the Paystack payout reference is a real column, and the sweep gets an index.
-- Undo: DROP INDEX journal_entries_tenant_id_source_type_external_ref_key; ALTER TABLE journal_entries DROP COLUMN external_ref;
--       DROP INDEX pending_checkouts_tenant_id_status_created_at_idx;
ALTER TABLE "journal_entries" ADD COLUMN "external_ref" TEXT;

-- Payout entries written before this column keep their reference in the description: "Paystack payout [REF]".
UPDATE "journal_entries"
SET "external_ref" = substring("description" from '^Paystack payout \[(.*?)\]')
WHERE "source_type" = 'paystack_payout' AND "description" ~ '^Paystack payout \[';

CREATE UNIQUE INDEX "journal_entries_tenant_id_source_type_external_ref_key" ON "journal_entries"("tenant_id", "source_type", "external_ref");

CREATE INDEX "pending_checkouts_tenant_id_status_created_at_idx" ON "pending_checkouts"("tenant_id", "status", "created_at");
