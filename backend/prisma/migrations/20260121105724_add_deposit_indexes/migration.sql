-- Data Backfill Safeguards for existing records (if any)
UPDATE "agent_deposits" SET "deposit_method" = 'bank_transfer' WHERE "deposit_method" IS NULL;
UPDATE "agent_deposits" SET "reference_number" = 'LEGACY-' || id::text WHERE "reference_number" IS NULL;

-- CreateIndex
CREATE INDEX "agent_deposits_deposit_date_idx" ON "agent_deposits"("deposit_date");

-- CreateIndex
CREATE INDEX "agent_deposits_agent_id_deposit_date_idx" ON "agent_deposits"("agent_id", "deposit_date");
