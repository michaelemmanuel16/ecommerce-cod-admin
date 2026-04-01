-- Add tenantId to JournalEntry
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
CREATE INDEX IF NOT EXISTS "journal_entries_tenant_id_idx" ON "journal_entries"("tenant_id");

-- Add tenantId to Account
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
CREATE INDEX IF NOT EXISTS "accounts_tenant_id_idx" ON "accounts"("tenant_id");
